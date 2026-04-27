import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createCustomer, getCustomers, getMenu } from "../api";
import type { Customer, DiscountRule, MenuItem, PaymentMethod } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { useCart } from "../contexts/CartContext";
import { useShift } from "../contexts/ShiftContext";
import { useToast } from "../contexts/ToastContext";
import { CashDrawerModal, printReceipt } from "../components/ReceiptPrinter";
import ProductGrid from "../components/pos/ProductGrid";
import CartPanel from "../components/pos/CartPanel";

const moneyFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function makeRuleId() {
  return `DISC-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default function POSPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
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
  const [lastOrder, setLastOrder] = useState<any>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { activeBranch } = useBranch();
  const { activeShift } = useShift();
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
    setPointsToUse
  } = useCart();

  const scannerInputRef = useRef<HTMLInputElement | null>(null);

  const refreshCustomers = async () => {
    const items = await getCustomers();
    setCustomers(items);
  };

  useEffect(() => {
    getMenu().then(setMenu).catch(() => {});
    refreshCustomers().catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedMember) {
      setPointsToUse("");
      return;
    }
    const max = Math.min(selectedMember.points, Math.floor(Math.max(0, subtotal - discountAmount)));
    if ((Number(pointsToUse) || 0) > max) setPointsToUse(String(max));
  }, [selectedMember, subtotal, discountAmount, pointsToUse, setPointsToUse]);

  const categories = useMemo(() => {
    const unique = new Set(menu.map((item) => item.category));
    return ["ทั้งหมด", ...Array.from(unique)];
  }, [menu]);

  const promotionCategories = useMemo(() => categories.filter((item) => item !== "ทั้งหมด"), [categories]);

  const visibleMenu = useMemo(() => {
    const bt = activeBranch?.branchType;
    return menu.filter((item) => {
      if (!item.active) return false;
      if (bt && (item as Record<string, any>).branchType && (item as Record<string, any>).branchType !== bt) return false;
      if (category !== "ทั้งหมด" && item.category !== category) return false;
      if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [menu, category, search, activeBranch]);

  const matchingCustomers = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    if (!query) return customers.slice(0, 6);
    return customers
      .filter((customer) => customer.name.toLowerCase().includes(query) || customer.phone.includes(query))
      .slice(0, 8);
  }, [customers, memberQuery]);

  const maxRedeemablePoints = selectedMember
    ? Math.min(selectedMember.points, Math.floor(Math.max(0, subtotal - discountAmount)))
    : 0;

  const addCartItem = (item: MenuItem) => {
    addItem({
      id: Math.random().toString(36).slice(2, 9),
      menuItemId: item.id,
      name: item.name,
      category: item.category,
      basePrice: item.basePrice,
      qty: 1,
      modifiers: []
    });
  };

  const processBarcodeScan = (rawCode: string) => {
    const code = rawCode.trim().toLowerCase();
    if (!code) return;
    const item = menu.find((i) => i.active && (i.barcode?.toLowerCase() === code || i.sku?.toLowerCase() === code || i.name.toLowerCase() === code));
    if (!item) {
      setScanFeedback({ tone: "error", message: `ไม่พบสินค้า: ${code}`, code });
      return;
    }
    addCartItem(item);
    setScanFeedback({ tone: "success", message: `เพิ่ม ${item.name} เข้าตะกร้าแล้ว`, code: item.barcode || item.sku });
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

    if (rule) addDiscountRule(rule);
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
    setIsSubmitting(true);
    const cartSnapshot = [...cart];
    const subtotalSnapshot = subtotal;
    const discountSnapshot = discountAmount;
    const totalSnapshot = total;
    const pointsSnapshot = Number(pointsToUse) || 0;
    const rulesSnapshot = [...discountRules];
    try {
      const order = await checkout(paymentMethod, selectedMember?.id ?? null, pointsSnapshot);
      setLastOrder(order);
      setShowCashDrawer(false);
      // Print receipt
      printReceipt({
        order,
        cart: cartSnapshot,
        discountRules: rulesSnapshot,
        subtotal: subtotalSnapshot,
        discountAmount: discountSnapshot,
        total: totalSnapshot,
        pointsUsed: pointsSnapshot,
        paymentMethod,
        cashReceived,
        changeAmount: changeAmt
      }, activeBranch?.name || "Big B Coffee");
      await refreshCustomers();
      setSelectedMember(null);
      setMemberQuery("");
    } finally {
      setIsSubmitting(false);
    }
  }, [cart, isSubmitting, subtotal, discountAmount, total, pointsToUse, discountRules, checkout, paymentMethod, selectedMember, activeBranch, refreshCustomers]);

  const handleCheckoutClick = () => {
    if (cart.length === 0 || isSubmitting || !activeShift) return;
    if (paymentMethod === "CASH") {
      setShowCashDrawer(true);
    } else {
      handleCheckout();
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
      if (e.key === "F12") {
        e.preventDefault();
        if (!isInput) handleCheckoutClick();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearCart, handleCheckoutClick]);

  return (
    <main style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "24px", height: "100%", width: "100%" }}>
      {/* Center Panel: Products */}
      <section className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: 0 }}>
        <div style={{ padding: "24px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "24px" }}>เมนูขาย</h2>
              <p className="muted" style={{ fontSize: "14px" }}>{activeBranch?.name}</p>
            </div>
          </div>
          
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
        </div>

        <div style={{ padding: "16px 24px 0", borderBottom: "1px solid var(--border)" }}>
          <div className="tab-row" style={{ marginBottom: "16px" }}>
            {categories.map((item) => (
              <button key={item} className={`tab ${category === item ? "tab--active" : ""}`} onClick={() => setCategory(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>

        <ProductGrid 
          menu={menu} 
          category={category} 
          search={search} 
          branchType={activeBranch?.branchType} 
          onItemClick={(item) => {
            addCartItem(item);
            setScanFeedback({ tone: "success", message: `เพิ่ม ${item.name} แล้ว` });
          }} 
        />
      </section>

      {/* Right Panel: Cart & Payment */}
      <CartPanel 
        cart={cart}
        subtotal={subtotal}
        discountAmount={discountAmount}
        total={total}
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
        handleCheckoutClick={handleCheckoutClick}
        isSubmitting={isSubmitting}
        activeShift={activeShift}
      />

      {showCashDrawer && (
        <CashDrawerModal
          total={total}
          onConfirm={(cashReceived, change) => handleCheckout(cashReceived, change)}
          onCancel={() => setShowCashDrawer(false)}
        />
      )}
    </main>
  );
}
