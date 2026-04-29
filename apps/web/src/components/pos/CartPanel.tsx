import { motion, AnimatePresence } from "framer-motion";
import { User, Tag, Plus, Minus, X, Search, UserPlus } from "lucide-react";
import type { Customer, DiscountRule, PaymentMethod, CartItem, Shift } from "../../types";

const formatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });

function formatMoney(v: number) {
  return formatter.format(v);
}

type DiscountDraft = {
  type: DiscountRule["type"];
  value: string;
  category: string;
  buyQty: string;
  getQty: string;
  maxDiscount: string;
};

const discountTypeLabels: Record<DiscountRule["type"], string> = {
  ORDER_PERCENT: "ลดทั้งบิล (%)",
  ORDER_FIXED: "ลดทั้งบิล (บาท)",
  CATEGORY_PERCENT: "ลดตามหมวด (%)",
  BUY_X_GET_Y: "ซื้อ X แถม Y"
};

const paymentLabels: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  QR: "สแกนจ่าย (QR)",
  CARD: "บัตรเครดิต",
  EWALLET: "E-Wallet"
};

interface CartPanelProps {
  cart: CartItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  pointsToUse: string;
  setPointsToUse: (val: string) => void;
  updateQty: (id: string, delta: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  selectedMember: Customer | null;
  setSelectedMember: (c: Customer | null) => void;
  memberQuery: string;
  setMemberQuery: (q: string) => void;
  matchingCustomers: Customer[];
  newMember: { name: string; phone: string };
  setNewMember: (m: { name: string; phone: string }) => void;
  handleCreateMember: () => void;
  maxRedeemablePoints: number;
  discountRules: DiscountRule[];
  clearDiscountRules: () => void;
  discountDraft: DiscountDraft;
  setDiscountDraft: (d: DiscountDraft) => void;
  promotionCategories: string[];
  handleAddDiscountRule: () => void;
  removeDiscountRule: (id: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  handleCheckoutClick: () => void;
  isSubmitting: boolean;
  activeShift: Shift | null;
}

export default function CartPanel(props: CartPanelProps) {
  const {
    cart,
    subtotal,
    discountAmount,
    total,
    pointsToUse,
    setPointsToUse,
    updateQty,
    removeItem,
    clearCart,
    selectedMember,
    setSelectedMember,
    memberQuery,
    setMemberQuery,
    matchingCustomers,
    newMember,
    setNewMember,
    handleCreateMember,
    maxRedeemablePoints,
    discountRules,
    clearDiscountRules,
    discountDraft,
    setDiscountDraft,
    promotionCategories,
    handleAddDiscountRule,
    removeDiscountRule,
    paymentMethod,
    setPaymentMethod,
    handleCheckoutClick,
    isSubmitting,
    activeShift
  } = props;

  const isCategoryPromotion = discountDraft.type === "CATEGORY_PERCENT" || discountDraft.type === "BUY_X_GET_Y";
  const isBuyGet = discountDraft.type === "BUY_X_GET_Y";

  const updatePointInput = (value: string) => {
    if (value === "") {
      setPointsToUse("");
      return;
    }
    const numericValue = Math.max(0, Math.floor(Number(value) || 0));
    setPointsToUse(String(Math.min(numericValue, maxRedeemablePoints)));
  };

  const updateDiscountDraft = (patch: Partial<DiscountDraft>) => {
    setDiscountDraft({ ...discountDraft, ...patch });
  };

  return (
    <section className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: 0, borderRadius: 0, borderTop: 0, borderRight: 0, borderBottom: 0 }}>
      {/* Cart Header */}
      <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "20px" }}>ออเดอร์ปัจจุบัน</h2>
          <p className="muted" style={{ fontSize: "13px" }}>{activeShift ? `กะ #${activeShift.id}` : "ยังไม่ได้เปิดกะ"}</p>
        </div>
        <button className="btn btn--ghost" onClick={clearCart} style={{ fontSize: "13px" }}>ล้าง (F8)</button>
      </div>

      {/* Cart Items */}
      <div className="order-list" style={{ overflowY: "auto", flex: 1, padding: "16px 24px" }}>
        {cart.length === 0 ? (
          <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, border: "2px dashed var(--border)", padding: "40px 20px" }}>
            <div style={{ background: "var(--bg-muted)", padding: "16px", borderRadius: "50%", color: "var(--text-muted)" }}>
              <Search size={32} />
            </div>
            <span>ไม่มีสินค้าในตะกร้า</span>
          </div>
        ) : (
          <AnimatePresence>
            {cart.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "14px 0", borderBottom: "1px solid var(--border)" }}
              >
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: "15px", color: "var(--text-primary)" }}>{item.name}</strong>
                  {item.modifiers.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", marginTop: 4 }}>
                      {item.modifiers.map((mod, i) => (
                        <span key={i} style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 2 }}>
                          {mod.value} {mod.price > 0 && <span style={{ color: "var(--brand)" }}>(+฿{mod.price})</span>}
                          {i < item.modifiers.length - 1 && <span style={{ color: "var(--border)" }}>|</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: "13px", marginTop: 4, fontWeight: 600, color: "var(--brand)" }}>
                    {formatMoney(item.basePrice + item.modifiers.reduce((sum, m) => sum + m.price, 0))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", padding: "4px" }}>
                    <button className="btn btn--ghost" style={{ padding: "6px", border: "none" }} onClick={() => updateQty(item.id, -1)} aria-label={`ลดจำนวน ${item.name}`}><Minus size={14} /></button>
                    <span style={{ width: "24px", textAlign: "center", fontWeight: 600 }}>{item.qty}</span>
                    <button className="btn btn--ghost" style={{ padding: "6px", border: "none" }} onClick={() => updateQty(item.id, 1)} aria-label={`เพิ่มจำนวน ${item.name}`}><Plus size={14} /></button>
                  </div>
                  <button className="btn btn--ghost" style={{ color: "var(--danger)", padding: "8px", border: "none" }} onClick={() => removeItem(item.id)} aria-label={`ลบ ${item.name}`}><X size={18} /></button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Customer & Discount & Payment */}
      <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-subtle)", padding: "16px 20px 20px", overflowY: "auto", flex: "0 1 auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        {/* Customer Select */}
        <div className="member-card">
          <div className="member-card__header">
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <User size={18} className="muted" /> สมาชิก
            </div>
            {selectedMember && (
              <button className="btn btn--ghost" style={{ padding: "4px 8px", fontSize: "12px" }} onClick={() => { setSelectedMember(null); setPointsToUse(""); }}>
                ยกเลิก
              </button>
            )}
          </div>

          {selectedMember ? (
            <div className="member-active">
              <label>
                สมาชิก
                <strong style={{ color: "var(--text-primary)", fontSize: "14px" }}>{selectedMember.name}</strong>
                <span>{selectedMember.phone}</span>
              </label>
              <label>
                ใช้แต้ม
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={maxRedeemablePoints}
                  value={pointsToUse}
                  onChange={(e) => updatePointInput(e.target.value)}
                  disabled={maxRedeemablePoints <= 0}
                  placeholder="0"
                />
              </label>
              <div className="member-points">
                แต้มสะสม {selectedMember.points.toLocaleString("th-TH")} แต้ม · ใช้ได้สูงสุด {maxRedeemablePoints.toLocaleString("th-TH")} แต้ม
              </div>
            </div>
          ) : (
            <div className="member-search">
              <div style={{ position: "relative" }}>
                <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input className="input" style={{ paddingLeft: 36 }} value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="ค้นหาเบอร์โทร / ชื่อ" />
              </div>
              {memberQuery && matchingCustomers.length > 0 && (
                <div className="member-results">
                  {matchingCustomers.map((customer) => (
                    <button key={customer.id} className="member-row" onClick={() => setSelectedMember(customer)}>
                      <span>{customer.name}</span>
                      <span className="muted" style={{ fontSize: "12px" }}>{customer.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="member-form">
                <input className="input" value={newMember.name} onChange={(e) => setNewMember({ ...newMember, name: e.target.value })} placeholder="ชื่อลูกค้าใหม่" />
                <input className="input" value={newMember.phone} onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })} placeholder="เบอร์โทร" />
                <button className="btn btn--ghost" onClick={handleCreateMember} disabled={!newMember.name.trim() || !newMember.phone.trim()}>
                  <UserPlus size={16} /> สมัคร
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Discount Rules */}
        <div className="member-card">
          <div className="member-card__header">
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <Tag size={18} className="muted" /> ส่วนลด / โปรโมชัน
            </div>
            {discountRules.length > 0 && (
              <button className="btn btn--ghost" style={{ padding: "4px 8px", fontSize: "12px" }} onClick={clearDiscountRules}>
                ล้างทั้งหมด
              </button>
            )}
          </div>

          <div className="discount-panel">
            <select className="input" value={discountDraft.type} onChange={(e) => updateDiscountDraft({ type: e.target.value as DiscountRule["type"] })}>
              {Object.entries(discountTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>

            {isCategoryPromotion ? (
              <select className="input" value={discountDraft.category} onChange={(e) => updateDiscountDraft({ category: e.target.value })}>
                {promotionCategories.length === 0 && <option value="">ไม่มีหมวดสินค้า</option>}
                {promotionCategories.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            ) : (
              <input className="input" value={discountDraft.value} onChange={(e) => updateDiscountDraft({ value: e.target.value })} inputMode="decimal" placeholder="มูลค่าส่วนลด" />
            )}

            {isBuyGet ? (
              <>
                <input className="input" value={discountDraft.buyQty} onChange={(e) => updateDiscountDraft({ buyQty: e.target.value })} inputMode="numeric" placeholder="ซื้อกี่ชิ้น" />
                <input className="input" value={discountDraft.getQty} onChange={(e) => updateDiscountDraft({ getQty: e.target.value })} inputMode="numeric" placeholder="แถมกี่ชิ้น" />
              </>
            ) : (
              <>
                {isCategoryPromotion && (
                  <input className="input" value={discountDraft.value} onChange={(e) => updateDiscountDraft({ value: e.target.value })} inputMode="decimal" placeholder="เปอร์เซ็นต์" />
                )}
                <input className="input" value={discountDraft.maxDiscount} onChange={(e) => updateDiscountDraft({ maxDiscount: e.target.value })} inputMode="decimal" placeholder="เพดานส่วนลด (ถ้ามี)" />
              </>
            )}

            <button className="btn btn--ghost" onClick={handleAddDiscountRule} disabled={cart.length === 0}>
              <Plus size={16} /> เพิ่มโปร
            </button>
          </div>

          {discountRules.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {discountRules.map((rule) => (
                <div key={rule.id} className="member-row">
                  <span>{rule.label}</span>
                  <button className="btn btn--ghost" style={{ padding: "4px 8px", color: "var(--danger)" }} onClick={() => removeDiscountRule(rule.id)} aria-label={`ลบโปร ${rule.label}`}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Totals Section */}
        <div style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-md)", padding: "18px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
            <span>ยอดรวม ({cart.reduce((sum, i) => sum + i.qty, 0)} รายการ)</span>
            <strong>{formatMoney(subtotal)}</strong>
          </div>

          {discountAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--success)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Tag size={14} /> ส่วนลด
              </div>
              <strong>-{formatMoney(discountAmount)}</strong>
            </div>
          )}

          {(Number(pointsToUse) || 0) > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--info)" }}>
              <span>ใช้แต้ม</span>
              <strong>-{formatMoney(Math.min(Number(pointsToUse) || 0, Math.max(0, subtotal - discountAmount)))}</strong>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "24px", fontWeight: 700, marginTop: "8px", paddingTop: "12px", borderTop: "1px dashed var(--border)" }}>
            <span>ยอดสุทธิ</span>
            <motion.span
              key={total}
              initial={{ scale: 1.1, color: "var(--brand)" }}
              animate={{ scale: 1, color: "var(--text-primary)" }}
              transition={{ duration: 0.3 }}
            >
              {formatMoney(total)}
            </motion.span>
          </div>
        </div>

        {/* Payment Methods */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {(["CASH", "QR", "CARD", "EWALLET"] as PaymentMethod[]).map((method) => (
            <button
              key={method}
              className={`btn ${paymentMethod === method ? "btn--primary" : "btn--ghost"}`}
              style={{ padding: "12px", fontWeight: 600, fontSize: "14px", border: paymentMethod === method ? "none" : "1px solid var(--border)" }}
              onClick={() => setPaymentMethod(method)}
            >
              {paymentLabels[method]}
            </button>
          ))}
        </div>

        {/* Checkout Button */}
        <motion.button
          whileTap={!activeShift || isSubmitting || cart.length === 0 ? {} : { scale: 0.98 }}
          className="btn btn--primary"
          style={{
            padding: "18px",
            fontSize: "17px",
            fontWeight: 700,
            background: (!activeShift || cart.length === 0) ? "var(--bg-muted)" : "var(--brand)",
            color: (!activeShift || cart.length === 0) ? "var(--text-muted)" : "#fff",
            border: "none",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-card-hover)"
          }}
          disabled={cart.length === 0 || isSubmitting || !activeShift}
          onClick={handleCheckoutClick}
        >
          {!activeShift ? "กรุณาเปิดกะก่อนขาย" : isSubmitting ? "กำลังทำรายการ..." : `ชำระเงิน ${formatMoney(total)} (F12)`}
        </motion.button>
      </div>
    </section>
  );
}
