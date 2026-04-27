import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createCustomer, getCustomers, getMenu } from "../api";
import type { Customer, DiscountRule, MenuItem, PaymentMethod } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { useCart } from "../contexts/CartContext";
import { useShift } from "../contexts/ShiftContext";
import { useToast } from "../contexts/ToastContext";
import { CashDrawerModal, printReceipt } from "../components/ReceiptPrinter";

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
    <main className="app__grid" style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "24px", height: "calc(100vh - 100px)" }}>
      <section className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <div className="panel__header">
          <div>
            <h2>เมนูขาย</h2>
            <p className="muted">{activeBranch?.name}</p>
          </div>
          <input
            ref={searchInputRef}
            className="input"
            placeholder="ค้นหาสินค้า (F1)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleProductSearchKeyDown}
          />
        </div>

        <div className={`scanner-strip scanner-strip--${scanFeedback.tone}`} style={{ padding: "12px", background: scanFeedback.tone === "error" ? "#fef2f2" : scanFeedback.tone === "success" ? "#f0fdf4" : "var(--bg-alt)", borderBottom: "1px solid var(--border)" }}>
          <div className="scanner-strip__copy">
            <strong>ช่องยิงบาร์โค้ด: </strong>
            <span>{scanFeedback.message}</span>
          </div>
          <input
            ref={scannerInputRef}
            className="input scanner-input"
            inputMode="none"
            placeholder="ยิงบาร์โค้ด แล้วกด Enter อัตโนมัติ"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                processBarcodeScan(e.currentTarget.value);
                e.currentTarget.value = "";
              }
            }}
          />
        </div>

        <div className="tab-row" style={{ padding: "0 24px", borderBottom: "1px solid var(--border)" }}>
          {categories.map((item) => (
            <button key={item} className={`tab ${category === item ? "tab--active" : ""}`} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </div>

        <div className="menu-grid" style={{ overflowY: "auto", padding: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "16px", alignContent: "start", flex: 1 }}>
          {visibleMenu.map((item) => (
            <button
              key={item.id}
              className="menu-card panel"
              onClick={() => {
                addCartItem(item);
                setScanFeedback({ tone: "success", message: `เพิ่ม ${item.name} แล้ว` });
              }}
              style={{ cursor: "pointer", textAlign: "left", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <strong style={{ fontSize: "16px" }}>{item.name}</strong>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
                <span className="muted">{item.category}</span>
                <span style={{ fontWeight: 600, color: "var(--accent)" }}>{formatMoney(item.basePrice)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <div className="panel__header">
          <div>
            <h2>ออเดอร์ปัจจุบัน</h2>
            <p className="muted">{activeShift ? `กะ #${activeShift.id}` : "ยังไม่ได้เปิดกะ"}</p>
          </div>
          <button className="btn btn--ghost" onClick={clearCart}>ล้าง (F8)</button>
        </div>

        <div className="order-list" style={{ overflowY: "auto", flex: 1, padding: "0 24px" }}>
          {cart.length === 0 ? (
            <div className="empty">ยังไม่มีรายการ</div>
          ) : (
            cart.map((item) => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <strong>{item.name}</strong>
                  <div className="muted" style={{ fontSize: "12px" }}>{formatMoney(item.basePrice)} · {item.category}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button className="btn btn--ghost" style={{ padding: "4px 8px" }} onClick={() => updateQty(item.id, -1)}>-</button>
                  <span style={{ width: "24px", textAlign: "center" }}>{item.qty}</span>
                  <button className="btn btn--ghost" style={{ padding: "4px 8px" }} onClick={() => updateQty(item.id, 1)}>+</button>
                  <button className="btn btn--ghost" style={{ color: "#b5482b", marginLeft: "8px" }} onClick={() => removeItem(item.id)}>x</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="cart-footer" style={{ padding: "20px", borderTop: "1px solid var(--border)", background: "var(--bg-alt)", overflowY: "auto", maxHeight: "58vh" }}>
          <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <strong>สมาชิก</strong>
              {selectedMember ? <button className="btn btn--ghost" onClick={() => { setSelectedMember(null); setPointsToUse(""); }}>ยกเลิก</button> : null}
            </div>
            {selectedMember ? (
              <div style={{ marginTop: 8 }}>
                <div><strong>{selectedMember.name}</strong> <span className="muted">{selectedMember.phone}</span></div>
                <div className="member-points">แต้มคงเหลือ {selectedMember.points} · ใช้ได้สูงสุด {maxRedeemablePoints}</div>
                <input className="input" type="number" min={0} max={maxRedeemablePoints} value={pointsToUse}
                  onChange={(e) => setPointsToUse(String(Math.min(maxRedeemablePoints, Number(e.target.value) || 0)))}
                  placeholder="แต้มที่ใช้แลกส่วนลด" style={{ width: "100%", marginTop: 8 }} />
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                <input className="input" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="ค้นหาชื่อ/เบอร์สมาชิก" />
                {matchingCustomers.map((customer) => (
                  <button key={customer.id} className="btn btn--ghost" style={{ justifyContent: "space-between" }} onClick={() => setSelectedMember(customer)}>
                    <span>{customer.name}</span>
                    <span className="muted">{customer.phone} · {customer.points} แต้ม</span>
                  </button>
                ))}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
                  <input className="input" value={newMember.name} onChange={(e) => setNewMember({ ...newMember, name: e.target.value })} placeholder="ชื่อใหม่" />
                  <input className="input" value={newMember.phone} onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })} placeholder="เบอร์" />
                  <button className="btn btn--ghost" onClick={handleCreateMember}>สมัคร</button>
                </div>
              </div>
            )}
          </div>

          <div className="panel discount-panel" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <strong>โปรโมชัน / ส่วนลด</strong>
              {discountRules.length ? <button className="btn btn--ghost" onClick={clearDiscountRules}>ล้าง</button> : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr", gap: 8, marginTop: 8 }}>
              <select className="input" value={discountDraft.type} onChange={(e) => setDiscountDraft({ ...discountDraft, type: e.target.value as DiscountRule["type"] })}>
                <option value="ORDER_PERCENT">ลดทั้งบิล %</option>
                <option value="ORDER_FIXED">ลดทั้งบิล บาท</option>
                <option value="CATEGORY_PERCENT">ลดเฉพาะหมวด %</option>
                <option value="BUY_X_GET_Y">ซื้อ X แถม Y</option>
              </select>
              {discountDraft.type !== "BUY_X_GET_Y" ? (
                <input className="input" type="number" value={discountDraft.value} onChange={(e) => setDiscountDraft({ ...discountDraft, value: e.target.value })} placeholder="ส่วนลด" />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input className="input" type="number" value={discountDraft.buyQty} onChange={(e) => setDiscountDraft({ ...discountDraft, buyQty: e.target.value })} />
                  <input className="input" type="number" value={discountDraft.getQty} onChange={(e) => setDiscountDraft({ ...discountDraft, getQty: e.target.value })} />
                </div>
              )}
              {(discountDraft.type === "CATEGORY_PERCENT" || discountDraft.type === "BUY_X_GET_Y") ? (
                <select className="input" value={discountDraft.category} onChange={(e) => setDiscountDraft({ ...discountDraft, category: e.target.value })}>
                  {promotionCategories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              ) : (
                <input className="input" type="number" value={discountDraft.maxDiscount} onChange={(e) => setDiscountDraft({ ...discountDraft, maxDiscount: e.target.value })} placeholder="เพดานลด (ถ้ามี)" />
              )}
              {(discountDraft.type === "CATEGORY_PERCENT" || discountDraft.type === "BUY_X_GET_Y") ? (
                <input className="input" type="number" value={discountDraft.maxDiscount} onChange={(e) => setDiscountDraft({ ...discountDraft, maxDiscount: e.target.value })} placeholder="เพดานลด (ถ้ามี)" />
              ) : null}
              <button className="btn btn--ghost" onClick={handleAddDiscountRule}>เพิ่มโปร</button>
            </div>
            {discountRules.length ? (
              <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                {discountRules.map((rule) => (
                  <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span className="badge">{rule.label}</span>
                    <button className="btn btn--ghost" onClick={() => removeDiscountRule(rule.id)}>ลบ</button>
                  </div>
                ))}
              </div>
            ) : <p className="muted" style={{ margin: "8px 0 0" }}>ยังไม่มีโปรโมชันในบิลนี้</p>}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>ยอดรวม</span>
              <strong>{formatMoney(subtotal)}</strong>
            </div>
            {discountAmount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--accent)" }}>
                <span>ส่วนลด</span>
                <strong>-{formatMoney(discountAmount)}</strong>
              </div>
            )}
            {(Number(pointsToUse) || 0) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--accent)" }}>
                <span>แลกแต้ม</span>
                <strong>-{formatMoney(Number(pointsToUse) || 0)}</strong>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "20px", fontWeight: 700 }}>
              <span>ยอดสุทธิ</span>
              <span>{formatMoney(total)}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", margin: "16px 0" }}>
            {(["CASH", "QR", "CARD", "EWALLET"] as PaymentMethod[]).map((method) => (
              <button
                key={method}
                className={`btn ${paymentMethod === method ? "btn--primary" : "btn--ghost"}`}
                style={{ flex: 1 }}
                onClick={() => setPaymentMethod(method)}
              >
                {method === "CASH" ? "สด" : method === "QR" ? "โอน" : method === "CARD" ? "บัตร" : "Wallet"}
              </button>
            ))}
          </div>

          <button
            className="btn btn--primary btn--full"
            style={{ padding: "16px", fontSize: "18px" }}
            disabled={cart.length === 0 || isSubmitting || !activeShift}
            onClick={handleCheckoutClick}
          >
            {!activeShift ? "เปิดกะก่อนขาย" : isSubmitting ? "กำลังทำรายการ..." : `ชำระเงิน ${formatMoney(total)} (F12)`}
          </button>

          {showCashDrawer && (
            <CashDrawerModal
              total={total}
              onConfirm={(cashReceived, change) => handleCheckout(cashReceived, change)}
              onCancel={() => setShowCashDrawer(false)}
            />
          )}
        </div>
      </section>
    </main>
  );
}
