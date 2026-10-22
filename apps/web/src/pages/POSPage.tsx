import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { PauseCircle, Settings, ShoppingCart, X, Search, ScanBarcode, ArrowUpRight, CarFront, CheckCircle2 } from "lucide-react";
import { createCustomer, getCustomers, getMenu, getProductUnits, getRecipes, getStoreSetting } from "../api";
import type { Customer, DiscountRule, MenuItem, PaymentMethod, ProductUnit, StoreSetting, Order } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { useCart } from "../contexts/CartContext";
import { useShift } from "../contexts/ShiftContext";
import { useToast } from "../contexts/ToastContext";
import { CashDrawerModal, printReceipt } from "../components/ReceiptPrinter";
import { getAutoPrint, getPrinterMode } from "../utils/printerSettings";
import { useDialogFocus } from "../utils/useDialogFocus";
import ProductGrid from "../components/pos/ProductGrid";
import CartPanel from "../components/pos/CartPanel";
import ModifierModal from "../components/pos/ModifierModal";
import CupStockStrip, { useCupStock } from "../components/pos/CupStockStrip";
import { businessProfile } from "../utils/business";
import { drinkAddOns, shouldUseModifierModal } from "../utils/menuRules";
import { displayCategoryLabel } from "../utils/categoryLabel";

const moneyFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0, maximumFractionDigits: 2
});
const paymentLabels: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  QR: "QR",
  CARD: "บัตรเครดิต",
  EWALLET: "E-Wallet"
};
const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "QR", "CARD", "EWALLET"];
const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = ["CASH", "QR", "CARD"];
const ROLE_LEVEL: Record<string, number> = { cashier: 1, manager: 2, admin: 3 };

// Tracks a CSS media query in React so we can switch the POS between the
// side-by-side layout (large screens) and the compact products-only layout with
// a floating cart button (small tablets/phones).
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getPayableTotal(totalBeforeTax: number, setting: StoreSetting | null) {
  const rate = setting?.vatRate && setting.vatRate > 0 ? setting.vatRate : 0;
  if (setting?.vatMode === "EXCLUSIVE" && rate > 0) {
    return roundMoney(totalBeforeTax + (totalBeforeTax * rate / 100));
  }
  return totalBeforeTax;
}

function getRoleLevel(role?: string | null) {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "admin" || normalized.includes("ผู้ดูแล")) return 3;
  if (normalized === "manager" || normalized.includes("ผู้จัดการ")) return 2;
  if (normalized === "cashier" || normalized.includes("แคชเชียร์") || normalized.includes("บาริสต้า")) return 1;
  return ROLE_LEVEL[normalized] ?? 0;
}

function makeRuleId() {
  return `DISC-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default function POSPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuState, setMenuState] = useState<"loading" | "ready" | "error">("loading");
  const [productUnits, setProductUnits] = useState<ProductUnit[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [memberQuery, setMemberQuery] = useState("");
  const [newMember, setNewMember] = useState({ name: "", phone: "" });
  const [discountDraft, setDiscountDraft] = useState({
    type: "ORDER_PERCENT" as DiscountRule["type"],
    value: "10",
    category: "กาแฟ",
    buyQty: "2",
    getQty: "1",
    maxDiscount: ""
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCashDrawer, setShowCashDrawer] = useState(false);
  const [pendingPaymentConfirm, setPendingPaymentConfirm] = useState<PaymentMethod | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // Keep a side cart on landscape tablets; narrower screens use the payment sheet.
  const isCompact = useMediaQuery("(max-width: 999px)");
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [modifierProduct, setModifierProduct] = useState<MenuItem | null>(null);
  const [recipeCount, setRecipeCount] = useState<number | null>(null);
  const [storeSetting, setStoreSetting] = useState<StoreSetting | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { activeBranch } = useBranch();
  const { activeShift, loaded: shiftLoaded } = useShift();
  const profile = businessProfile(activeBranch?.branchType);
  const addOnOptions = useMemo(() => drinkAddOns(menu), [menu]);
  const cupStock = useCupStock(profile.type === "coffee" ? activeBranch?.id : undefined, lastOrder?.id);
  const BusinessIcon = profile.icon;
  const { user } = useAuth();
  const toast = useToast();
  const {
    cart,
    orderNote, setOrderNote, selectedMember, setSelectedMember,
    addItem,
    scanFeedback,
    setScanFeedback,
    updateQty,
    removeItem,
    clearCart,
    checkout,
    subtotal,
    discountAmount,
    total,
    discountRules,
    addDiscountRule,
    removeDiscountRule,
    clearDiscountRules,
    pointsToUse,
    setPointsToUse,
    heldBills,
    holdCart,
    restoreHeldBill,
    removeHeldBill
  } = useCart();

  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const loadMenu = useCallback(() => {
    setMenuState("loading");
    getMenu()
      .then((items) => { setMenu(items.filter((item) => item.branchType === activeBranch?.branchType)); setMenuState("ready"); })
      .catch(() => setMenuState("error"));
  }, [activeBranch?.branchType]);

  const refreshCustomers = async () => {
    const items = await getCustomers();
    setCustomers(items);
    setCustomersLoaded(true);
  };

  useEffect(() => {
    loadMenu();
    getProductUnits().then(setProductUnits).catch(() => setProductUnits([]));
    getRecipes().then((items) => setRecipeCount(items.length)).catch(() => setRecipeCount(null));
    refreshCustomers().catch(() => {});
  }, [activeBranch?.id]);

  useEffect(() => {
    if (!customersLoaded || !selectedMember) return;
    const current = customers.find((customer) => customer.id === selectedMember.id) ?? null;
    if (current !== selectedMember) setSelectedMember(current);
    if (!current) toast.error("สมาชิกในบิลนี้ไม่อยู่ในสาขาแล้ว กรุณาเลือกสมาชิกใหม่");
  }, [customers, customersLoaded, selectedMember, setSelectedMember, toast]);

  useEffect(() => {
    if (!activeBranch?.id) {
      setStoreSetting(null);
      return;
    }
    getStoreSetting(activeBranch.id).then(setStoreSetting).catch(() => setStoreSetting(null));
  }, [activeBranch]);

  useEffect(() => {
    if (!selectedMember) {
      setPointsToUse("");
      return;
    }
    const max = Math.min(selectedMember.points, Math.floor(Math.max(0, subtotal - discountAmount)));
    if ((Number(pointsToUse) || 0) > max) setPointsToUse(String(max));
  }, [selectedMember, subtotal, discountAmount, pointsToUse, setPointsToUse]);

  const categories = useMemo(() => {
    const bt = activeBranch?.branchType;
    const branchMenu = menu.filter((item) => {
      if (!item.active) return false;
      if (bt && (item as Record<string, any>).branchType && (item as Record<string, any>).branchType !== bt) return false;
      return true;
    });
    const unique = new Set(branchMenu.map((item) => item.category));
    return ["ทั้งหมด", ...Array.from(unique)];
  }, [menu, activeBranch]);

  const promotionCategories = useMemo(() => categories.filter((item) => item !== "ทั้งหมด"), [categories]);

  const matchingCustomers = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    if (!query) return customers.slice(0, 6);
    return customers
      .filter((customer) => customer.name.toLowerCase().includes(query) || customer.phone.includes(query))
      .slice(0, 8);
  }, [customers, memberQuery]);
  const enabledPaymentMethods = useMemo(() => {
    // until the shop's settings arrive, show the server's default (no Wallet) so nothing appears then vanishes
    const configured = storeSetting?.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method));
    return configured?.length ? configured : DEFAULT_PAYMENT_METHODS;
  }, [storeSetting]);

  const maxRedeemablePoints = selectedMember
    ? Math.min(selectedMember.points, Math.floor(Math.max(0, subtotal - discountAmount)))
    : 0;
  const canManageMenu = getRoleLevel(user?.role) >= 3;
  const payableTotal = useMemo(() => getPayableTotal(total, storeSetting), [total, storeSetting]);

  useEffect(() => {
    if (!enabledPaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(enabledPaymentMethods[0]);
    }
  }, [enabledPaymentMethods, paymentMethod]);



  const addCartItem = (item: MenuItem, qty: number = 1, modifiers: import("../types").Modifier[] = []) => {
    addItem({
      id: Math.random().toString(36).slice(2, 9),
      menuItemId: item.id,
      name: item.name,
      category: item.category,
      basePrice: item.basePrice,
      qty,
      modifiers
    });
    setModifierProduct(null);
  };

  const handleMenuItemClick = (item: MenuItem) => {
    if (shouldUseModifierModal(item)) {
      setModifierProduct(item);
      return;
    }
    addCartItem(item);
    setScanFeedback({ tone: "success", message: `เพิ่ม ${item.name} เข้าตะกร้าแล้ว` });
  };

  const processBarcodeScan = (rawCode: string) => {
    const code = rawCode.trim().toLowerCase();
    if (!code) return;
    const productUnit = productUnits.find((unit) => unit.active && unit.barcode?.toLowerCase() === code);
    if (productUnit) {
      const parent = menu.find((item) => item.id === productUnit.menuItemId && item.active);
      if (!parent) {
        setScanFeedback({ tone: "error", message: `หน่วยสินค้าไม่มีสินค้าแม่: ${code}`, code });
        return;
      }
      addItem({
        id: Math.random().toString(36).slice(2, 9),
        menuItemId: parent.id,
        productUnitId: productUnit.id,
        unitLabel: productUnit.unitName,
        unitFactor: productUnit.factor,
        name: `${parent.name} (${productUnit.unitName})`,
        category: parent.category,
        basePrice: productUnit.price ?? parent.basePrice * productUnit.factor,
        qty: 1,
        modifiers: []
      });
      setScanFeedback({ tone: "success", message: `เพิ่ม ${parent.name} (${productUnit.unitName}) เข้าตะกร้าแล้ว`, code });
      window.requestAnimationFrame(() => scannerInputRef.current?.focus());
      return;
    }
    const item = menu.find((i) => i.active && (i.barcode?.toLowerCase() === code || i.sku?.toLowerCase() === code || i.name.toLowerCase() === code));
    if (!item) {
      setScanFeedback({ tone: "error", message: `ไม่พบสินค้า: ${code}`, code });
      return;
    }
    handleMenuItemClick(item);
    window.requestAnimationFrame(() => scannerInputRef.current?.focus());
  };

  const handleProductSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const query = search.trim();
    if (!query) return;
    event.preventDefault();
    processBarcodeScan(query);
    setSearch("");
  };

  const handleAddDiscountRule = () => {
    const value = Number(discountDraft.value);
    const maxDiscount = discountDraft.maxDiscount ? Number(discountDraft.maxDiscount) : undefined;
    const categoryName = discountDraft.category || promotionCategories[0] || "";
    if (maxDiscount !== undefined && (!Number.isFinite(maxDiscount) || maxDiscount < 0)) {
      return toast.error("เพดานส่วนลดต้องเป็นตัวเลข 0 ขึ้นไป");
    }

    let rule: DiscountRule | null = null;
    if (discountDraft.type === "ORDER_PERCENT") {
      if (!Number.isFinite(value) || value <= 0 || value > 100) return toast.error("เปอร์เซ็นต์ส่วนลดต้องมากกว่า 0 และไม่เกิน 100");
      rule = { id: makeRuleId(), type: "ORDER_PERCENT", value, maxDiscount, label: `ลดทั้งบิล ${value}%` };
    } else if (discountDraft.type === "ORDER_FIXED") {
      if (!Number.isFinite(value) || value <= 0) return toast.error("ใส่จำนวนเงินส่วนลดให้ถูกต้อง");
      if (value > subtotal) return toast.error(`ส่วนลดต้องไม่เกินยอดบิล ${formatMoney(subtotal)}`);
      rule = { id: makeRuleId(), type: "ORDER_FIXED", value, maxDiscount, label: `ลดทั้งบิล ${formatMoney(value)}` };
    } else if (discountDraft.type === "CATEGORY_PERCENT") {
      if (!categoryName || !Number.isFinite(value) || value <= 0 || value > 100) return toast.error("เลือกหมวด และเปอร์เซ็นต์ต้องมากกว่า 0 ไม่เกิน 100");
      rule = { id: makeRuleId(), type: "CATEGORY_PERCENT", category: categoryName, value, maxDiscount, label: `ลด ${displayCategoryLabel(categoryName)} ${value}%` };
    } else if (discountDraft.type === "BUY_X_GET_Y") {
      const buyQty = Math.max(1, Math.floor(Number(discountDraft.buyQty) || 2));
      const getQty = Math.max(1, Math.floor(Number(discountDraft.getQty) || 1));
      if (!categoryName) return toast.error("เลือกหมวดโปรโมชันก่อน");
      rule = { id: makeRuleId(), type: "BUY_X_GET_Y", category: categoryName, buyQty, getQty, maxDiscount, label: `${displayCategoryLabel(categoryName)} ซื้อ ${buyQty} แถม ${getQty}` };
    }

    if (rule) {
      addDiscountRule(rule);
      toast.success("เพิ่มส่วนลดแล้ว");
    }
  };

  const handleCreateMember = async () => {
    const name = newMember.name.trim();
    const phone = newMember.phone.trim();
    if (!name || !phone) return toast.error("กรอกชื่อและเบอร์สมาชิก");

    try {
      const customer = await createCustomer({ name, phone });
      setCustomers((prev) => [customer, ...prev]);
      setSelectedMember(customer);
      setMemberQuery(phone);
      setNewMember({ name: "", phone: "" });
      toast.success("สมัครสมาชิกเรียบร้อย");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleCheckout = useCallback(async (cashReceived?: number, changeAmt?: number) => {
    if (cart.length === 0 || isSubmitting) return;
    setCheckoutError(null);
    // Pre-open the receipt window inside the click gesture. Printing then happens in a
    // SEPARATE window, so window.print() never blocks/freezes the main POS screen.
    // In the native wrapper the Star SDK prints directly, so skip the blank window.
    // Skip the blank receipt window when printing natively or via RawBT — those
    // paths print directly, so no browser print window is needed (and we avoid a
    // popup flashing open/closed on the Android tablet).
    const autoPrint = getAutoPrint();
    const receiptWindow = (autoPrint && getPrinterMode() === "browser" && typeof window !== "undefined")
      ? window.open("", "bbpos_receipt", "width=380,height=640")
      : null;
    setIsSubmitting(true);
    const cartSnapshot = cart.map((item, index) => index === 0 && orderNote ? { ...item, note: [item.note, orderNote].filter(Boolean).join(" · ") } : item);
    const subtotalSnapshot = subtotal;
    const discountSnapshot = discountAmount;
    const totalSnapshot = payableTotal;
    const pointsSnapshot = Number(pointsToUse) || 0;
    const rulesSnapshot = [...discountRules];
    try {
      const order = await checkout(paymentMethod, selectedMember?.id ?? null, pointsSnapshot, {
        cashReceived,
        paymentConfirmed: paymentMethod !== "CASH",
        referenceNo: paymentMethod === "CASH" ? undefined : paymentReference.trim() || undefined
      });
      clearCart();
      setLastOrder(order);
      setShowCashDrawer(false);
      setShowCartSheet(false);
      setPendingPaymentConfirm(null);
      // Printing failure must never be reported as a failed payment.
      // With auto-print off the success banner offers "ดูบิล / พิมพ์ซ้ำ" instead.
      if (autoPrint) try {
      const printed = printReceipt({
        order,
        cart: cartSnapshot,
        discountRules: rulesSnapshot,
        subtotal: order.subtotal ?? subtotalSnapshot,
        discountAmount: order.discountAmount ?? discountSnapshot,
        total: order.total ?? totalSnapshot,
        pointsUsed: order.loyaltyPointsUsed ?? pointsSnapshot,
        paymentMethod,
        cashReceived: order.cashReceived ?? cashReceived,
        changeAmount: order.changeAmount ?? changeAmt,
        storeSetting,
        // บ่อถ่ายน้ำมัน (oil_service): พิมพ์ 3 ใบแยก — สำนักงาน / ร้าน / ลูกค้า
        copies: activeBranch?.branchType === "oil_service" ? 3 : 1,
        copyLabels: activeBranch?.branchType === "oil_service"
          ? ["สำหรับสำนักงาน", "สำหรับร้าน (เก็บที่บ่อ)", "สำหรับลูกค้า"]
          : undefined
      }, activeBranch?.name || "Big B Coffee", receiptWindow);
      if (!printed) {
        receiptWindow?.close();
        toast.error("พิมพ์ใบเสร็จไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าปริ้นเตอร์");
      }
      } catch {
        receiptWindow?.close();
        toast.error("บิลบันทึกแล้ว แต่พิมพ์ไม่สำเร็จ เปิดใบเสร็จจากออเดอร์เพื่อพิมพ์ซ้ำ");
      }
      setSelectedMember(null);
      setMemberQuery("");
      setPendingPaymentConfirm(null);
      void refreshCustomers().catch((error) => {
        console.warn("[POS] refresh customers after checkout failed", error);
      });
    } catch (error) {
      // Checkout failed — close the blank receipt window we pre-opened.
      receiptWindow?.close();
      // Surface the reason (e.g. insufficient stock) directly in the payment modal —
      // the toast can be missed when the blank receipt window flashes open then closes.
      setCheckoutError((error as Error)?.message || "ชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSubmitting(false);
    }
  }, [cart, orderNote, isSubmitting, subtotal, discountAmount, payableTotal, pointsToUse, discountRules, checkout, clearCart, paymentMethod, paymentReference, selectedMember, activeBranch, storeSetting, refreshCustomers, toast]);

  const handleCheckoutClick = () => {
    if (cart.length === 0 || isSubmitting || !activeShift) return;
    if (!enabledPaymentMethods.includes(paymentMethod)) {
      toast.error("วิธีชำระเงินนี้ถูกปิดไว้");
      return;
    }
    setCheckoutError(null);
    setPaymentReference("");
    if (paymentMethod === "CASH") {
      setShowCashDrawer(true);
    } else {
      setPaymentReference("");
      setPendingPaymentConfirm(paymentMethod);
    }
  };

  /* ─── Keyboard Shortcuts ─── */
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      // Don't trigger if typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "F1") { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === "F8") { e.preventDefault(); clearCart(); }
      if (e.key === "F9") { e.preventDefault(); if (!isInput) holdCart(); }
      if (e.key === "F12") {
        e.preventDefault();
        if (!isInput) handleCheckoutClick();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearCart, holdCart, handleCheckoutClick]);



  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  return (
    <main className="pos-layout studio-pos">
      <section className="studio-catalog">
        <div className="studio-pos-heading">
          <div><span className="studio-eyebrow"><BusinessIcon size={15} /> {profile.type === "coffee" ? "COFFEE COUNTER" : "SERVICE COUNTER"}</span>
            <h1>{profile.saleTitle}<span className="studio-heading-dot">.</span></h1>
            <p>{profile.type === "coffee" ? "เลือกเมนู ปรับรสชาติ แล้วส่งต่อความอร่อย" : "เลือกสินค้าและบริการสำหรับรถคันนี้"}</p>
          </div>
          <div className="studio-heading-actions">
            <button className="btn btn--ghost" onClick={() => holdCart()} disabled={!cart.length} title="พักบิล (F9)"><PauseCircle size={17} /><span>พักบิล</span></button>
            {canManageMenu && <Link to="/inventory?tab=products&manage=menu" className="studio-icon-button" aria-label="จัดการสินค้า"><Settings size={18} /></Link>}
          </div>
        </div>
        <div className="studio-counter-strip">
          <div><span className={`studio-live-dot${activeShift ? " is-live" : ""}`} /><span>{!shiftLoaded ? "กำลังตรวจกะ..." : activeShift ? "พร้อมรับรายการ" : "เปิดกะเพื่อเริ่มขาย"}</span></div>
          <span>{!shiftLoaded ? "" : activeShift ? `${activeShift.totalOrders} บิลในกะนี้` : "ยังไม่มีกะที่เปิดอยู่"}</span>
          <CupStockStrip cups={cupStock} />
          <Link to="/orders">ดูรายการ <ArrowUpRight size={14} /></Link>
        </div>
        {profile.type === "oil_service" && <div className="studio-service-note"><CarFront size={22} /><label htmlFor="service-note"><span>รายละเอียดรถ / งานบริการ</span><input id="service-note" value={orderNote} maxLength={300} onChange={(e) => setOrderNote(e.target.value)} placeholder="ทะเบียนรถ · เลขไมล์ · งานที่ลูกค้าแจ้ง" /></label></div>}
        {lastOrder && <div className="studio-sale-success" role="status"><CheckCircle2 size={18} /><span>{lastOrder.id < 0 ? "บันทึกบิลออฟไลน์แล้ว" : `บันทึกบิล #${lastOrder.id} แล้ว`} · {formatMoney(lastOrder.total)}</span><Link className="btn btn--ghost" to="/orders">ดูบิล / พิมพ์ซ้ำ</Link><button aria-label="ปิดข้อความ" onClick={() => setLastOrder(null)}><X size={16} /></button></div>}
        {heldBills.length > 0 && <div className="studio-held-bills" aria-label="บิลที่พักไว้">{heldBills.map((bill) => <div key={bill.id}><button onClick={() => restoreHeldBill(bill.id)}><PauseCircle size={15} />{bill.label} · {formatMoney(bill.total)}</button><button aria-label={`ลบ ${bill.label}`} onClick={() => removeHeldBill(bill.id)}><X size={14} /></button></div>)}</div>}
        <div className="studio-catalog-toolbar">
        <div className="studio-search-row">
          <label className="studio-search"><Search size={20} /><input ref={searchInputRef} aria-label="ค้นหาสินค้า" placeholder={profile.type === "coffee" ? "ค้นหาเมนู เครื่องดื่ม หรือเบเกอรี่" : "ค้นหาสินค้า บริการ หรือรหัสสินค้า"} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={handleProductSearchKeyDown} /><kbd>F1</kbd></label>
          <label className="studio-scanner"><ScanBarcode size={20} /><input ref={scannerInputRef} aria-label="ยิงบาร์โค้ด" inputMode="none" placeholder="สแกนบาร์โค้ด" onKeyDown={(e) => { if (e.key === "Enter") { processBarcodeScan(e.currentTarget.value); e.currentTarget.value = ""; } }} /></label>
        </div>
        <div className="studio-categories" aria-label="หมวดสินค้า">{categories.map((item) => <button key={item} aria-pressed={category === item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{displayCategoryLabel(item)}<span>{menu.filter((product) => product.active && (item === "ทั้งหมด" || product.category === item)).length}</span></button>)}</div>
        </div>
        <div className="studio-catalog-label"><strong>{category === "ทั้งหมด" ? "สินค้าทั้งหมด" : displayCategoryLabel(category)}</strong><span role="status" className={scanFeedback.tone === "error" ? "negative" : ""}>{scanFeedback.tone === "idle" ? "แตะสินค้าเพื่อเพิ่มรายการ" : scanFeedback.message}</span></div>
        <div className="pos-products-scroll studio-products-scroll"><ProductGrid menu={menu} category={category} search={search} branchType={activeBranch?.branchType} onItemClick={handleMenuItemClick} status={menuState} onRetry={loadMenu} /></div>
        {recipeCount === 0 && profile.type === "coffee" && <div className="studio-recipe-note">ยังไม่มีสูตรสำหรับตัดวัตถุดิบอัตโนมัติ</div>}
        {isCompact && (cart.length > 0
          ? <button className="pos-cart-fab" onClick={() => setShowCartSheet(true)}><span className="pos-cart-fab__info"><ShoppingCart size={20} /><span>ตะกร้า {cartCount} รายการ</span></span><span className="pos-cart-fab__pay">{formatMoney(payableTotal)} · ชำระเงิน →</span></button>
          : <button className="pos-cart-fab is-empty" onClick={() => setShowCartSheet(true)}><span className="pos-cart-fab__info"><ShoppingCart size={20} /><span>ตะกร้าว่าง</span></span><span className="pos-cart-fab__pay">แตะสินค้าเพื่อเพิ่ม</span></button>)}
      </section>

      {/* Right Panel: Cart & Payment.
          Large screens: side column. Small tablet/phone: full-screen sheet opened
          from the floating cart button. CartPanel renders once either way. */}
      <div className={isCompact ? `pos-cart-sheet${showCartSheet ? " is-open" : ""}` : "pos-cart-side"}>
        {(!isCompact || showCartSheet) && (
          <>
            {isCompact && (
              <div className="pos-cart-sheet__head">
                <strong style={{ fontSize: 17 }}>ตะกร้า / ชำระเงิน</strong>
                <button className="btn btn--ghost" onClick={() => setShowCartSheet(false)} aria-label="ปิด">
                  <X size={20} />
                </button>
              </div>
            )}
      <CartPanel
        businessType={profile.type}
        cart={cart}
        subtotal={subtotal}
        discountAmount={discountAmount}
        total={payableTotal}
        pointsToUse={pointsToUse}
        setPointsToUse={setPointsToUse}
        updateQty={updateQty}
        removeItem={removeItem}
        clearCart={clearCart}
        selectedMember={selectedMember}
        setSelectedMember={setSelectedMember}
        memberQuery={memberQuery}
        setMemberQuery={setMemberQuery}
        matchingCustomers={matchingCustomers}
        newMember={newMember}
        setNewMember={setNewMember}
        handleCreateMember={handleCreateMember}
        maxRedeemablePoints={maxRedeemablePoints}
        discountRules={discountRules}
        clearDiscountRules={clearDiscountRules}
        discountDraft={discountDraft}
        setDiscountDraft={setDiscountDraft}
        promotionCategories={promotionCategories}
        handleAddDiscountRule={handleAddDiscountRule}
        removeDiscountRule={removeDiscountRule}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        enabledPaymentMethods={enabledPaymentMethods}
        handleCheckoutClick={handleCheckoutClick}
        isSubmitting={isSubmitting}
        activeShift={activeShift}
      />
          </>
        )}
      </div>

      {showCashDrawer && (
        <CashDrawerModal
          total={payableTotal}
          isSubmitting={isSubmitting}
          errorMessage={checkoutError}
          onConfirm={(cashReceived, change) => handleCheckout(cashReceived, change)}
          onCancel={() => { setCheckoutError(null); setShowCashDrawer(false); }}
        />
      )}

      {pendingPaymentConfirm && (
        <div className="modal-backdrop" onClick={() => { if (!isSubmitting) setPendingPaymentConfirm(null); }} style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 20 }}>
          <PaymentDialog onClose={() => { if (!isSubmitting) setPendingPaymentConfirm(null); }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <h2 id="payment-title" style={{ fontSize: 20 }}>ยืนยันชำระเงิน {paymentLabels[pendingPaymentConfirm]}</h2>
                <p className="muted" style={{ marginTop: 6 }}>{pendingPaymentConfirm === "QR" ? "ให้ลูกค้าชำระผ่าน QR กรุงไทยของร้าน แล้วตรวจยอดรับเงินในแอปของร้านก่อนยืนยัน" : "ตรวจยอดเงินเข้าจากแอปหรือเครื่องรับบัตรก่อนยืนยัน"}</p><p className="muted">POS บันทึกการชำระเงินหลังคุณตรวจแล้ว ไม่มีการตรวจเงินเข้าอัตโนมัติ</p>
              </div>
              <strong style={{ fontSize: 24, color: "var(--brand-hover)" }}>{formatMoney(payableTotal)}</strong>
            </div>
            <label className="studio-payment-reference">เลขอ้างอิงการรับเงิน (ถ้ามี)<input className="input" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} maxLength={120} placeholder="เลขอ้างอิงจากธนาคารหรือใบสลิป" disabled={isSubmitting} /></label>
            {checkoutError && (
              <div role="alert" style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 8, background: "#fef3f2", border: "1px solid #fda29b", color: "#b42318", fontSize: 14, lineHeight: 1.45 }}>
                ⚠️ ชำระเงินไม่สำเร็จ: {checkoutError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn--ghost" onClick={() => { setCheckoutError(null); setPendingPaymentConfirm(null); }} disabled={isSubmitting}>ยกเลิก</button>
              <button className="btn btn--primary" onClick={() => handleCheckout()} disabled={isSubmitting}>
                {isSubmitting ? "กำลังบันทึก..." : "ยืนยันและบันทึก"}
              </button>
            </div>
          </PaymentDialog>
        </div>
      )}

      {modifierProduct && (
        <ModifierModal
          item={modifierProduct}
          cupStock={cupStock}
          addOns={addOnOptions}
          onClose={() => setModifierProduct(null)}
          onAdd={(item, qty, mods) => {
            addCartItem(item, qty, mods);
            setScanFeedback({ tone: "success", message: `เพิ่ม ${item.name} เข้าตะกร้าแล้ว` });
          }}
        />
      )}
    </main>
  );
}

function PaymentDialog({children,onClose}:{children:React.ReactNode;onClose:()=>void}) {
 const ref=useDialogFocus(onClose);
 return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="payment-title" tabIndex={-1} className="panel" onClick={event=>event.stopPropagation()} style={{width:"min(460px,calc(100vw - 32px))",margin:"auto",padding:24,borderRadius:12,background:"var(--bg-surface)"}}>{children}</div>;
}
