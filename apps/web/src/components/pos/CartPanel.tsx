import { motion, AnimatePresence } from "framer-motion";
import { User, Tag, Plus, Minus, X, Search, UserPlus } from "lucide-react";
import type { Customer, DiscountRule, PaymentMethod, CartItem } from "../../types";

const formatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
function formatMoney(v: number) { return formatter.format(v); }

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
  discountRules: any[];
  clearDiscountRules: () => void;
  discountDraft: any;
  setDiscountDraft: (d: any) => void;
  promotionCategories: string[];
  handleAddDiscountRule: () => void;
  removeDiscountRule: (id: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  handleCheckoutClick: () => void;
  isSubmitting: boolean;
  activeShift: any;
}

export default function CartPanel(props: CartPanelProps) {
  const { cart, subtotal, discountAmount, total, pointsToUse, setPointsToUse, updateQty, removeItem, clearCart, selectedMember, setSelectedMember, memberQuery, setMemberQuery, matchingCustomers, newMember, setNewMember, handleCreateMember, maxRedeemablePoints, discountRules, clearDiscountRules, discountDraft, setDiscountDraft, promotionCategories, handleAddDiscountRule, removeDiscountRule, paymentMethod, setPaymentMethod, handleCheckoutClick, isSubmitting, activeShift } = props;

  return (
    <section className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: 0 }}>
      {/* Cart Header */}
      <div style={{ padding: "24px 24px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
            <div style={{ background: "var(--canvas-alt)", padding: "16px", borderRadius: "50%", color: "var(--muted)" }}>
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
                style={{ display: "flex", justifyContent: "space-between", padding: "16px 0", borderBottom: "1px solid var(--border)" }}
              >
                <div>
                  <strong style={{ fontSize: "15px" }}>{item.name}</strong>
                  <div className="muted" style={{ fontSize: "13px", marginTop: 4 }}>{formatMoney(item.basePrice)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", background: "var(--canvas-alt)", borderRadius: "var(--radius-sm)", padding: "4px" }}>
                    <button className="btn btn--ghost" style={{ padding: "6px", border: "none" }} onClick={() => updateQty(item.id, -1)}><Minus size={14} /></button>
                    <span style={{ width: "24px", textAlign: "center", fontWeight: 600 }}>{item.qty}</span>
                    <button className="btn btn--ghost" style={{ padding: "6px", border: "none" }} onClick={() => updateQty(item.id, 1)}><Plus size={14} /></button>
                  </div>
                  <button className="btn btn--ghost" style={{ color: "var(--danger)", padding: "8px", border: "none" }} onClick={() => removeItem(item.id)}><X size={18} /></button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Customer & Discount & Payment */}
      <div style={{ borderTop: "1px solid var(--border)", background: "var(--canvas-alt)", padding: "20px 24px", overflowY: "auto", maxHeight: "50vh", display: "flex", flexDirection: "column", gap: "16px" }}>
        
        {/* Customer Select */}
        <div style={{ background: "var(--surface)", borderRadius: "var(--radius-md)", padding: "16px", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: selectedMember ? 12 : 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <User size={18} className="muted" /> สมาชิก
            </div>
            {selectedMember && <button className="btn btn--ghost" style={{ padding: "4px 8px", fontSize: "12px" }} onClick={() => { setSelectedMember(null); setPointsToUse(""); }}>ยกเลิก</button>}
          </div>
          
          {selectedMember ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{selectedMember.name}</strong>
                <span className="muted">{selectedMember.phone}</span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--accent)", marginTop: 4, fontWeight: 500 }}>
                แต้มสะสม: {selectedMember.points}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ position: "relative" }}>
                <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
                <input className="input" style={{ paddingLeft: 36 }} value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="ค้นหาเบอร์โทร / ชื่อ" />
              </div>
              {memberQuery && matchingCustomers.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                  {matchingCustomers.map((customer) => (
                    <button key={customer.id} className="btn btn--ghost" style={{ justifyContent: "space-between", padding: "8px 12px", textAlign: "left" }} onClick={() => setSelectedMember(customer)}>
                      <span>{customer.name}</span>
                      <span className="muted" style={{ fontSize: "12px" }}>{customer.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Totals Section */}
        <div style={{ background: "var(--surface)", borderRadius: "var(--radius-md)", padding: "20px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--ink-secondary)" }}>
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
          
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "24px", fontWeight: 700, marginTop: "8px", paddingTop: "12px", borderTop: "1px dashed var(--border)" }}>
            <span>ยอดสุทธิ</span>
            <motion.span
              key={total}
              initial={{ scale: 1.1, color: "var(--accent)" }}
              animate={{ scale: 1, color: "var(--ink)" }}
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
              {method === "CASH" ? "เงินสด" : method === "QR" ? "สแกนจ่าย (QR)" : method === "CARD" ? "บัตรเครดิต" : "E-Wallet"}
            </button>
          ))}
        </div>

        {/* Checkout Button */}
        <motion.button
          whileTap={!activeShift || isSubmitting || cart.length === 0 ? {} : { scale: 0.98 }}
          className="btn btn--primary"
          style={{ 
            padding: "20px", 
            fontSize: "18px", 
            fontWeight: 700,
            background: (!activeShift || cart.length === 0) ? "var(--muted)" : "var(--success)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)"
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
