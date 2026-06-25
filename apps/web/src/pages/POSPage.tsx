import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, PauseCircle, Settings, X } from "lucide-react";
import { createCustomer, getCustomers, getMenu, getProductUnits, getRecipes, getStoreSetting } from "../api";
import type { Customer, DiscountRule, MenuItem, PaymentMethod, ProductUnit, StoreSetting } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { useCart } from "../contexts/CartContext";
import { useShift } from "../contexts/ShiftContext";
import { useToast } from "../contexts/ToastContext";
import { CashDrawerModal, printReceipt } from "../components/ReceiptPrinter";
import { isNativePrintAvailable } from "../utils/nativePrinter";
import { isRawbtEnabled } from "../utils/rawbtPrinter";
import ProductGrid from "../components/pos/ProductGrid";
import CartPanel from "../components/pos/CartPanel";
import ModifierModal from "../components/pos/ModifierModal";
import { shouldUseModifierModal } from "../utils/menuRules";

const moneyFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0
});
const paymentLabels: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  QR: "QR",
  CARD: "บัตรเครดิต",
  EWALLET: "E-Wallet"
};
const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "QR", "CARD", "EWALLET"];
const ROLE_LEVEL: Record<string, number> = { cashier: 1, manager: 2, admin: 3 };

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
  const [productUnits, setProductUnits] = useState<ProductUnit[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<Customer | null>(null);
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCashDrawer, setShowCashDrawer] = useState(false);
  const [pendingPaymentConfirm, setPendingPaymentConfirm] = useState<PaymentMethod | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<any>(null);
  const [modifierProduct, setModifierProduct] = useState<MenuItem | null>(null);
  const [recipeCount, setRecipeCount] = useState<number | null>(null);
  const [storeSetting, setStoreSetting] = useState<StoreSetting | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { activeBranch } = useBranch();
  const { activeShift } = useShift();
  const { user } = useAuth();
  const toast = useToast();
  const {
    cart,
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

  const refreshCustomers = async () => {
    const items = await getCustomers();
    setCustomers(items);
  };

  useEffect(() => {
    getMenu().then(setMenu).catch(() => {});
    getProductUnits().then(setProductUnits).catch(() => setProductUnits([]));
    getRecipes().then((items) => setRecipeCount(items.length)).catch(() => setRecipeCount(null));
    refreshCustomers().catch(() => {});
  }, []);

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
    const configured = storeSetting?.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method));
    return configured?.length ? configured : PAYMENT_METHODS;
  }, [storeSetting]);

  const maxRedeemablePoints = selectedMember
    ? Math.min(selectedMember.points, Math.floor(Math.max(0, subtotal - discountAmount)))
    : 0;
  const canManageMenu = getRoleLevel(user?.role) >= 2;
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
      if (!Number.isFinite(value) || value <= 0) return toast.error("ใส่เปอร์เซ็นต์ส่วนลดให้ถูกต้อง");
      rule = { id: makeRuleId(), type: "ORDER_PERCENT", value, maxDiscount, label: `ลดทั้งบิล ${value}%` };
    } else if (discountDraft.type === "ORDER_FIXED") {
      if (!Number.isFinite(value) || value <= 0) return toast.error("ใส่จำนวนเงินส่วนลดให้ถูกต้อง");
      rule = { id: makeRuleId(), type: "ORDER_FIXED", value, maxDiscount, label: `ลดทั้งบิล ${formatMoney(value)}` };
    } else if (discountDraft.type === "CATEGORY_PERCENT") {
      if (!categoryName || !Number.isFinite(value) || value <= 0) return toast.error("เลือกหมวดและเปอร์เซ็นต์ให้ถูกต้อง");
      rule = { id: makeRuleId(), type: "CATEGORY_PERCENT", category: categoryName, value, maxDiscount, label: `ลด ${categoryName} ${value}%` };
    } else if (discountDraft.type === "BUY_X_GET_Y") {
      const buyQty = Math.max(1, Math.floor(Number(discountDraft.buyQty) || 2));
      const getQty = Math.max(1, Math.floor(Number(discountDraft.getQty) || 1));
      if (!categoryName) return toast.error("เลือกหมวดโปรโมชันก่อน");
      rule = { id: makeRuleId(), type: "BUY_X_GET_Y", category: categoryName, buyQty, getQty, maxDiscount, label: `${categoryName} ซื้อ ${buyQty} แถม ${getQty}` };
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
    const receiptWindow = (!isNativePrintAvailable() && !isRawbtEnabled() && typeof window !== "undefined")
      ? window.open("", "bbpos_receipt", "width=380,height=640")
      : null;
    setIsSubmitting(true);
    const cartSnapshot = [...cart];
    const subtotalSnapshot = subtotal;
    const discountSnapshot = discountAmount;
    const totalSnapshot = payableTotal;
    const pointsSnapshot = Number(pointsToUse) || 0;
    const rulesSnapshot = [...discountRules];
    try {
      const order = await checkout(paymentMethod, selectedMember?.id ?? null, pointsSnapshot, {
        cashReceived,
        paymentConfirmed: paymentMethod !== "CASH"
      });
      clearCart();
      setLastOrder(order);
      setShowCashDrawer(false);
      // Print receipt
      const printed = printReceipt({
        order,
        cart: cartSnapshot,
        discountRules: rulesSnapshot,
        subtotal: subtotalSnapshot,
        discountAmount: discountSnapshot,
        total: totalSnapshot,
        pointsUsed: pointsSnapshot,
        paymentMethod,
        cashReceived,
        changeAmount: changeAmt,
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
  }, [cart, isSubmitting, subtotal, discountAmount, payableTotal, pointsToUse, discountRules, checkout, clearCart, paymentMethod, selectedMember, activeBranch, storeSetting, refreshCustomers, toast]);

  const handleCheckoutClick = () => {
    if (cart.length === 0 || isSubmitting || !activeShift) return;
    if (!enabledPaymentMethods.includes(paymentMethod)) {
      toast.error("วิธีชำระเงินนี้ถูกปิดไว้");
      return;
    }
    setCheckoutError(null);
    if (paymentMethod === "CASH") {
      setShowCashDrawer(true);
    } else {
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



  return (
    <main className="pos-layout" style={{ display: "grid", gap: "0", height: "100%", width: "100%", background: "var(--pos-bg)" }}>
      {/* Center Panel: Products */}
      <section style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: 0, borderRight: "1px solid var(--border)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "20px", fontWeight: "bold", color: "var(--pos-sidebar)" }}>ขายสินค้า (POS)</h2>
              <p className="muted" style={{ fontSize: "12px" }}>{activeBranch?.name}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {recipeCount === 0 && (
                <span className="badge badge--warning" title="ระบบขายได้ แต่ยังไม่มีสูตรสำหรับตัดวัตถุดิบออกจากสต็อกอัตโนมัติ">
                  ยังไม่มีสูตรตัดสต็อก
                </span>
              )}
              <button
                className="btn btn--ghost"
                onClick={() => holdCart()}
                disabled={cart.length === 0}
                title="พักบิลปัจจุบันแล้วเริ่มบิลใหม่ (F9)"
              >
                <PauseCircle size={16} />
                พักบิล
              </button>
              {canManageMenu && (
                <Link to="/inventory?tab=products&manage=menu" className="btn btn--primary pos-manage-card-header">
                  <Settings size={16} />
                  จัดการการ์ด
                </Link>
              )}
            </div>
          </div>

          {heldBills.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>บิลที่พักไว้:</span>
              {heldBills.map((bill) => (
                <span
                  key={bill.id}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "4px 6px 4px 12px", fontSize: 13 }}
                >
                  <button
                    onClick={() => restoreHeldBill(bill.id)}
                    title="เรียกบิลนี้กลับมาคิดเงิน"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--brand-hover)", fontWeight: 600, padding: 0 }}
                  >
                    {bill.label} · {bill.itemCount} ชิ้น · ฿{Math.round(bill.total).toLocaleString("th-TH")}
                  </button>
                  <button
                    onClick={() => removeHeldBill(bill.id)}
                    title="ลบบิลที่พัก"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", display: "inline-flex", padding: 0 }}
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: "16px" }}>
            <input
              ref={searchInputRef}
              className="input"
              placeholder="ค้นหาสินค้า (F1)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleProductSearchKeyDown}
              style={{ flex: 1 }}
            />
            
            <input
              ref={scannerInputRef}
              className="input scanner-input"
              inputMode="none"
              placeholder="ยิงบาร์โค้ด (Enter)"
              style={{ width: "220px", borderColor: scanFeedback.tone === "error" ? "var(--danger)" : scanFeedback.tone === "success" ? "var(--success)" : "var(--border)" }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  processBarcodeScan(e.currentTarget.value);
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>
          {scanFeedback.message && (
            <div style={{ fontSize: "12px", color: scanFeedback.tone === "error" ? "var(--danger)" : "var(--success)", marginTop: "8px" }}>
              {scanFeedback.message}
            </div>
          )}

          {/* Horizontal category chips — shown only on narrow screens (tablet/phone)
              where the 140px left categories column is hidden to free up space. */}
          <div className="pos-cat-chips">
            {categories.map((item) => (
              <button
                key={item}
                className={`pos-cat-chip${category === item ? " is-active" : ""}`}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {/* Split view: Left Sidebar Categories, Right Product Grid */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, background: "#fff" }}>
          {/* Left Categories Sidebar */}
          <aside className="pos-categories" style={{
            width: "140px",
            borderRight: "1px solid var(--border)",
            background: "var(--bg-muted)",
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
            flexShrink: 0
          }}>
            {categories.map((item) => (
              <button
                key={item}
                style={{
                  width: "100%",
                  padding: "16px 12px",
                  textAlign: "left",
                  background: category === item ? "#fff" : "transparent",
                  color: category === item ? "var(--brand-hover)" : "var(--text-secondary)",
                  border: "none",
                  borderLeft: `4px solid ${category === item ? "var(--brand)" : "transparent"}`,
                  fontWeight: category === item ? "bold" : "normal",
                  fontSize: "13px",
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(0,0,0,0.04)",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}
                onClick={() => setCategory(item)}
              >
                <span style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  lineHeight: "1.3"
                }}>
                  {item}
                </span>
              </button>
            ))}
          </aside>

          {/* Right Product Grid */}
          <div style={{ flex: 1, overflowY: "auto", background: "#fff" }}>
            <ProductGrid
              menu={menu}
              category={category}
              search={search}
              branchType={activeBranch?.branchType}
              onItemClick={handleMenuItemClick}
            />
          </div>
        </div>
      </section>

      {/* Right Panel: Cart & Payment */}
      <CartPanel 
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
          <div className="panel" onClick={(event) => event.stopPropagation()} style={{ width: "min(420px, calc(100vw - 32px))", margin: "auto", padding: 24, borderRadius: 12, background: "var(--bg-surface)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 20 }}>ยืนยันชำระเงิน {paymentLabels[pendingPaymentConfirm]}</h2>
                <p className="muted" style={{ marginTop: 6 }}>บันทึกบิลหลังตรวจยอดรับชำระแล้ว</p>
              </div>
              <strong style={{ fontSize: 24, color: "var(--brand-hover)" }}>{formatMoney(payableTotal)}</strong>
            </div>
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
          </div>
        </div>
      )}

      {modifierProduct && (
        <ModifierModal
          item={modifierProduct}
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
