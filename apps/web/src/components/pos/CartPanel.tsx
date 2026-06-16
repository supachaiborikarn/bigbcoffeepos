import { useState } from "react";
import { useCart } from "../../contexts/CartContext";
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
  enabledPaymentMethods?: PaymentMethod[];
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
    enabledPaymentMethods,
    handleCheckoutClick,
    isSubmitting,
    activeShift
  } = props;

  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const { appliedCoupon, applyCoupon, removeCoupon, autoPromotions } = useCart();
  const [couponInput, setCouponInput] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);

  async function handleApplyCoupon() {
    if (couponBusy) return;
    setCouponBusy(true);
    try {
      await applyCoupon(couponInput);
      setCouponInput("");
    } finally {
      setCouponBusy(false);
    }
  }

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
      <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: "20px" }}>ออเดอร์ปัจจุบัน</h2>
          <p className="muted" style={{ fontSize: "13px" }}>{activeShift ? `กะ #${activeShift.id}` : "ยังไม่ได้เปิดกะ"}</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={clearCart} style={{ fontSize: "13px" }}>ล้าง (F8)</button>
      </div>

      {/* Cart Items List (scrolls independently) */}
      <div className="order-list" style={{ overflowY: "auto", flex: "1 1 0", padding: "16px 24px", minHeight: 0 }}>
        {cart.length === 0 ? (
          <div className="empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, border: "2px dashed var(--border)", padding: "40px 20px" }}>
            <div style={{ background: "var(--bg-muted)", padding: "16px", borderRadius: "50%", color: "var(--text-muted)" }}>
              <Search size={32} />
            </div>
            <span>ไม่มีสินค้าในตะกร้า</span>
          </div>
        ) : (
          <AnimatePresence>
            {cart.map((item) => {
              const itemUnitPrice = item.basePrice + item.modifiers.reduce((sum, m) => sum + m.price, 0);
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "14px 0", borderBottom: "1px solid var(--border)" }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
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
                      {formatMoney(itemUnitPrice)}
                      {item.qty > 1 && (
                        <span style={{ color: "var(--text-muted)", fontWeight: "normal", marginLeft: 6, fontSize: "12px" }}>
                          (รวม {formatMoney(itemUnitPrice * item.qty)})
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", padding: "4px" }}>
                      <button type="button" className="btn btn--ghost" style={{ padding: "6px", border: "none" }} onClick={() => updateQty(item.id, -1)} aria-label={`ลดจำนวน ${item.name}`}><Minus size={14} /></button>
                      <span style={{ width: "24px", textAlign: "center", fontWeight: 600 }}>{item.qty}</span>
                      <button type="button" className="btn btn--ghost" style={{ padding: "6px", border: "none" }} onClick={() => updateQty(item.id, 1)} aria-label={`เพิ่มจำนวน ${item.name}`}><Plus size={14} /></button>
                    </div>
                    <button type="button" className="btn btn--ghost" style={{ color: "var(--danger)", padding: "8px", border: "none" }} onClick={() => removeItem(item.id)} aria-label={`ลบ ${item.name}`}><X size={18} /></button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Docked Checkout section at the bottom (never scrolls) */}
      <div style={{
        borderTop: "1px solid var(--border)",
        background: "var(--bg-subtle)",
        padding: "16px 20px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        flexShrink: 0
      }}>
        {/* Row 1: Member Action / Tag */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          {selectedMember ? (
            <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between", background: "var(--brand-subtle)", padding: "6px 12px", borderRadius: "8px", border: "1px solid rgba(139, 94, 60, 0.15)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "13px", minWidth: 0 }}>
                <User size={15} style={{ color: "var(--brand)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <strong>{selectedMember.name}</strong> ({selectedMember.phone})
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: "11px", color: "var(--brand-hover)", fontWeight: 500 }}>
                  ใช้แต้ม:
                </span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={maxRedeemablePoints}
                  value={pointsToUse}
                  onChange={(e) => updatePointInput(e.target.value)}
                  disabled={maxRedeemablePoints <= 0}
                  style={{ width: "65px", padding: "2px 6px", height: "26px", fontSize: "12px", textAlign: "right" }}
                  placeholder="0"
                />
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: "2px", border: "none", color: "var(--danger)", display: "flex", alignItems: "center" }}
                  onClick={() => { setSelectedMember(null); setPointsToUse(""); }}
                  aria-label="ลบสมาชิก"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px", fontSize: "13px", height: "36px", border: "1px dashed var(--border)" }}
              onClick={() => setShowMemberModal(true)}
            >
              <User size={15} /> เลือกสมาชิก / สมัคร
            </button>
          )}

          {/* Row 1 right: Discount Action / Tag */}
          {discountRules.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#e8f5e9", border: "1px solid #a5d6a7", padding: "6px 12px", borderRadius: "8px", maxWidth: "45%", flexShrink: 0 }}>
              <Tag size={15} style={{ color: "#2e7d32", flexShrink: 0 }} />
              <span style={{ fontSize: "12px", color: "#2e7d32", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {discountRules[0].label}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                style={{ padding: "2px", border: "none", color: "var(--danger)", display: "flex", alignItems: "center" }}
                onClick={() => removeDiscountRule(discountRules[0].id)}
                aria-label="ลบส่วนลด"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px", fontSize: "13px", height: "36px", border: "1px dashed var(--border)" }}
              onClick={() => setShowDiscountModal(true)}
              disabled={cart.length === 0}
            >
              <Tag size={15} /> ส่วนลด / โปรโมชัน
            </button>
          )}
        </div>

        {/* Auto-applied promotions (server-side, shown so cash totals are correct) */}
        {cart.length > 0 && autoPromotions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {autoPromotions.map((promo) => (
              <span key={promo.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
                <Tag size={12} /> {promo.label} (อัตโนมัติ)
              </span>
            ))}
          </div>
        )}

        {/* Coupon */}
        {appliedCoupon ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, background: "#fff7ed", border: "1px solid #fdba74", padding: "6px 12px", borderRadius: "8px" }}>
            <span style={{ fontSize: "12px", color: "#9a3412", fontWeight: 600 }}>
              คูปอง {appliedCoupon.code} ({appliedCoupon.type.toUpperCase().includes("PERCENT") ? `${appliedCoupon.value}%` : `${appliedCoupon.value} บาท`})
            </span>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ padding: "2px", border: "none", color: "var(--danger)", display: "flex", alignItems: "center" }}
              onClick={removeCoupon}
              aria-label="ลบคูปอง"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="input"
              style={{ flex: 1, height: "36px", fontSize: "13px" }}
              placeholder="โค้ดคูปอง"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleApplyCoupon(); }}
              disabled={cart.length === 0}
            />
            <button
              type="button"
              className="btn btn--ghost"
              style={{ height: "36px", fontSize: "13px", whiteSpace: "nowrap" }}
              onClick={handleApplyCoupon}
              disabled={cart.length === 0 || couponBusy || !couponInput.trim()}
            >
              {couponBusy ? "..." : "ใช้คูปอง"}
            </button>
          </div>
        )}

        {/* Member Point Summary Details */}
        {selectedMember && (
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "-4px", paddingLeft: "8px" }}>
            แต้มสะม: <strong>{selectedMember.points.toLocaleString("th-TH")}</strong> แต้ม (ใช้ได้สูงสุด {maxRedeemablePoints.toLocaleString("th-TH")} แต้ม)
          </div>
        )}

        {/* Totals Summary */}
        <div style={{ background: "var(--bg-surface)", borderRadius: "10px", padding: "12px 16px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)", fontSize: "13px" }}>
            <span>ยอดรวม ({cart.reduce((sum, i) => sum + i.qty, 0)} ชิ้น)</span>
            <span>{formatMoney(subtotal)}</span>
          </div>

          {discountAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "#2e7d32", fontSize: "13px" }}>
              <span>ส่วนลดโปรโมชัน</span>
              <strong>-{formatMoney(discountAmount)}</strong>
            </div>
          )}

          {(Number(pointsToUse) || 0) > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--info)", fontSize: "13px" }}>
              <span>ใช้แต้ม</span>
              <strong>-{formatMoney(Math.min(Number(pointsToUse) || 0, Math.max(0, subtotal - discountAmount)))}</strong>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "20px", fontWeight: 800, marginTop: "4px", paddingTop: "8px", borderTop: "1px dashed var(--border)" }}>
            <span>ยอดสุทธิ</span>
            <span style={{ color: "var(--brand-hover)" }}>{formatMoney(total)}</span>
          </div>
        </div>

        {/* Payment Methods selector in a single clean row */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, enabledPaymentMethods?.length ?? 4)}, 1fr)`, gap: "6px" }}>
          {(enabledPaymentMethods?.length ? enabledPaymentMethods : ["CASH", "QR", "CARD", "EWALLET"] as PaymentMethod[]).map((method) => {
            const label = method === "CASH" ? "เงินสด" : method === "QR" ? "QR" : method === "CARD" ? "บัตร" : "Wallet";
            return (
              <button
                key={method}
                type="button"
                className={`btn ${paymentMethod === method ? "btn--primary" : "btn--ghost"}`}
                style={{ padding: "10px 2px", fontWeight: 600, fontSize: "13px", border: paymentMethod === method ? "none" : "1px solid var(--border)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
                onClick={() => setPaymentMethod(method)}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Checkout Button */}
        <button
          type="button"
          className="btn btn--primary"
          style={{
            padding: "16px",
            fontSize: "16px",
            fontWeight: 700,
            background: (!activeShift || cart.length === 0) ? "var(--bg-muted)" : "var(--brand)",
            color: (!activeShift || cart.length === 0) ? "var(--text-muted)" : "#fff",
            border: "none",
            borderRadius: "var(--radius)",
            boxShadow: "0 4px 12px rgba(139, 94, 60, 0.18)"
          }}
          disabled={cart.length === 0 || isSubmitting || !activeShift}
          onClick={handleCheckoutClick}
        >
          {!activeShift ? "กรุณาเปิดกะก่อนขาย" : isSubmitting ? "กำลังทำรายการ..." : `ชำระเงิน ${formatMoney(total)} (F12)`}
        </button>
      </div>

      {/* ─── Member Selection Modal ─── */}
      {showMemberModal && (
        <div className="modal-backdrop" onClick={() => setShowMemberModal(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="panel" onClick={e => e.stopPropagation()} style={{ width: "min(460px, calc(100vw - 32px))", padding: "24px", borderRadius: "12px", background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "18px", margin: 0, color: "var(--ink)" }}>👤 ค้นหา / สมัครสมาชิก</h3>
              <button type="button" className="btn btn--ghost" style={{ padding: "4px 8px" }} onClick={() => setShowMemberModal(false)}>ปิด</button>
            </div>

            <div className="member-search" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ position: "relative" }}>
                <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input
                  className="input"
                  style={{ paddingLeft: 36, width: "100%" }}
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="ค้นหาเบอร์โทร / ชื่อลูกค้า"
                />
              </div>

              {/* Search Results dropdown list */}
              {memberQuery && (
                <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" }}>
                  {matchingCustomers.length === 0 ? (
                    <div style={{ padding: "12px", textAlign: "center", color: "var(--text-muted)" }}>ไม่พบรายชื่อสมาชิก</div>
                  ) : (
                    matchingCustomers.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          background: "none",
                          border: "none",
                          borderBottom: "1px solid var(--border)",
                          textAlign: "left",
                          cursor: "pointer"
                        }}
                        onClick={() => {
                          setSelectedMember(customer);
                          setShowMemberModal(false);
                          setMemberQuery("");
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{customer.name}</span>
                        <span className="muted" style={{ fontSize: "13px" }}>{customer.phone} · {customer.points} แต้ม</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Signup Form */}
              <div style={{ borderTop: "1px dashed var(--border)", paddingTop: "16px", marginTop: "8px" }}>
                <h4 style={{ fontSize: "14px", marginBottom: "12px", color: "var(--text-secondary)" }}>➕ สมัครสมาชิกใหม่</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <input
                    className="input"
                    value={newMember.name}
                    onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                    placeholder="ชื่อลูกค้าใหม่"
                  />
                  <input
                    className="input"
                    value={newMember.phone}
                    onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                    placeholder="เบอร์โทร"
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{ width: "100%" }}
                    onClick={() => {
                      handleCreateMember();
                      setShowMemberModal(false);
                    }}
                    disabled={!newMember.name.trim() || !newMember.phone.trim()}
                  >
                    <UserPlus size={16} /> สมัครสมาชิกและเลือกใช้
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Discount Selection Modal ─── */}
      {showDiscountModal && (
        <div className="modal-backdrop" onClick={() => setShowDiscountModal(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="panel" onClick={e => e.stopPropagation()} style={{ width: "min(480px, calc(100vw - 32px))", padding: "24px", borderRadius: "12px", background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "18px", margin: 0, color: "var(--ink)" }}>🏷️ ส่วนลด / โปรโมชัน</h3>
              <button type="button" className="btn btn--ghost" style={{ padding: "4px 8px" }} onClick={() => setShowDiscountModal(false)}>ปิด</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>ประเภทโปรโมชัน</label>
                <select className="input" style={{ width: "100%" }} value={discountDraft.type} onChange={(e) => updateDiscountDraft({ type: e.target.value as DiscountRule["type"] })}>
                  {Object.entries(discountTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              {isCategoryPromotion ? (
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>เลือกหมวดหมู่สินค้า</label>
                  <select className="input" style={{ width: "100%" }} value={discountDraft.category} onChange={(e) => updateDiscountDraft({ category: e.target.value })}>
                    {promotionCategories.length === 0 && <option value="">ไม่มีหมวดสินค้า</option>}
                    {promotionCategories.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                    {discountDraft.type === "ORDER_PERCENT" ? "เปอร์เซ็นต์ส่วนลด (%)" : "จำนวนเงินส่วนลด (บาท)"}
                  </label>
                  <input className="input" style={{ width: "100%" }} value={discountDraft.value} onChange={(e) => updateDiscountDraft({ value: e.target.value })} inputMode="decimal" placeholder="เช่น 10, 50" />
                </div>
              )}

              {isBuyGet ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>ซื้อสินค้า (จำนวนชิ้น)</label>
                    <input className="input" style={{ width: "100%" }} value={discountDraft.buyQty} onChange={(e) => updateDiscountDraft({ buyQty: e.target.value })} inputMode="numeric" placeholder="ซื้อ X ชิ้น" />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>แถมสินค้า (จำนวนชิ้น)</label>
                    <input className="input" style={{ width: "100%" }} value={discountDraft.getQty} onChange={(e) => updateDiscountDraft({ getQty: e.target.value })} inputMode="numeric" placeholder="แถม Y ชิ้น" />
                  </div>
                </div>
              ) : (
                <>
                  {isCategoryPromotion && (
                    <div>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>เปอร์เซ็นต์ส่วนลด (%)</label>
                      <input className="input" style={{ width: "100%" }} value={discountDraft.value} onChange={(e) => updateDiscountDraft({ value: e.target.value })} inputMode="decimal" placeholder="เปอร์เซ็นต์ส่วนลด" />
                    </div>
                  )}
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>เพดานส่วนลดสูงสุด (ถ้ามี - บาท)</label>
                    <input className="input" style={{ width: "100%" }} value={discountDraft.maxDiscount} onChange={(e) => updateDiscountDraft({ maxDiscount: e.target.value })} inputMode="decimal" placeholder="ไม่จำกัด" />
                  </div>
                </>
              )}

              <button
                type="button"
                className="btn btn--primary"
                style={{ width: "100%", marginTop: "8px" }}
                onClick={() => {
                  handleAddDiscountRule();
                  setShowDiscountModal(false);
                }}
                disabled={cart.length === 0}
              >
                <Plus size={16} /> ยืนยันเพิ่มส่วนลด
              </button>

              {/* Active Discount Rules list */}
              {discountRules.length > 0 && (
                <div style={{ borderTop: "1px dashed var(--border)", paddingTop: "14px", marginTop: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                    <h4 style={{ fontSize: "14px", margin: 0, color: "var(--text-secondary)" }}>โปรโมชันที่เปิดใช้อยู่</h4>
                    <button type="button" className="btn btn--ghost" style={{ fontSize: "12px", color: "var(--danger)", padding: "2px 6px" }} onClick={clearDiscountRules}>ล้างทั้งหมด</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {discountRules.map((rule) => (
                      <div key={rule.id} className="member-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-muted)", padding: "6px 12px", borderRadius: "6px" }}>
                        <span style={{ fontSize: "13px" }}>{rule.label}</span>
                        <button type="button" className="btn btn--ghost" style={{ padding: "4px", color: "var(--danger)", border: "none", display: "flex", alignItems: "center" }} onClick={() => removeDiscountRule(rule.id)} aria-label={`ลบโปร ${rule.label}`}>
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
