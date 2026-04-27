import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import { useShift } from "../../contexts/ShiftContext";
import { useToast } from "../../contexts/ToastContext";
import { 
  LayoutDashboard, 
  Store, 
  Package, 
  Users, 
  BarChart3, 
  Settings, 
  LogOut,
  Database,
  Lock,
  Unlock
} from "lucide-react";

const ROLE_LEVEL: Record<string, number> = { cashier: 1, manager: 2, admin: 3 };

const navItems = [
  { to: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard, minRole: 2 },
  { to: "/pos", label: "หน้าร้าน", icon: Store, minRole: 1 },
  { to: "/inventory", label: "สินค้า & สต็อก", icon: Package, minRole: 2 },
  { to: "/staff", label: "พนักงาน", icon: Users, minRole: 3 },
  { to: "/reports", label: "รายงาน", icon: BarChart3, minRole: 2 },
  { to: "/migration", label: "ย้ายข้อมูล", icon: Database, minRole: 3 },
  { to: "/settings", label: "ตั้งค่า", icon: Settings, minRole: 3 },
];

const formatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
function formatMoney(v: number) { return formatter.format(v); }

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { branches, activeBranch, setBranchId } = useBranch();
  const { activeShift, openShift, closeShift, loading } = useShift();
  const toast = useToast();
  const userLevel = ROLE_LEVEL[user?.role ?? "cashier"] ?? 0;

  const [showShiftModal, setShowShiftModal] = useState<"open" | "close" | null>(null);
  const [cashInput, setCashInput] = useState("");
  const [closedSummary, setClosedSummary] = useState<any>(null);

  const handleOpenShift = async () => {
    try {
      await openShift(Number(cashInput) || 0);
      toast.success("เปิดกะขายเรียบร้อย");
      setShowShiftModal(null);
      setCashInput("");
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleCloseShift = async () => {
    try {
      const closed = await closeShift(Number(cashInput) || 0);
      setClosedSummary(closed);
      toast.success("ปิดกะขายเรียบร้อย");
      setShowShiftModal(null);
      setCashInput("");
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="brand__mark">B</div>
          <div className="sidebar__brand-text">
            <strong>Big B Coffee</strong>
            <select
              className="sidebar__branch-select"
              value={activeBranch?.id ?? ""}
              onChange={(e) => setBranchId(Number(e.target.value))}
              style={{
                background: "transparent",
                border: "none",
                fontSize: "12px",
                color: "var(--muted)",
                fontWeight: 500,
                outline: "none",
                padding: "2px 0",
                cursor: "pointer"
              }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        <nav className="sidebar__nav">
          {navItems.filter((n) => userLevel >= n.minRole).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `sidebar__link ${isActive ? "sidebar__link--active" : ""}`}
              >
                <Icon className="sidebar__icon" size={20} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          {activeShift ? (
            <button className="sidebar__shift sidebar__shift--open" onClick={() => { setCashInput(""); setShowShiftModal("close"); }} style={{ cursor: "pointer", border: "none", width: "100%", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="sidebar__shift-dot" />
                <span>กะ #{activeShift.id}</span>
              </div>
              <Lock size={14} />
            </button>
          ) : (
            <button className="sidebar__shift" onClick={() => { setCashInput(""); setShowShiftModal("open"); }} style={{ cursor: "pointer", border: "none", width: "100%", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="sidebar__shift-dot" />
                <span>ยังไม่เปิดกะ</span>
              </div>
              <Unlock size={14} />
            </button>
          )}
          
          <div className="sidebar__user">
            <div className="sidebar__user-avatar">{user?.name?.charAt(0) || "U"}</div>
            <div className="sidebar__user-info">
              <strong>{user?.name}</strong>
              <span>{user?.role}</span>
            </div>
          </div>
          <button className="btn sidebar__logout" onClick={logout}>
            <LogOut size={18} />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </aside>

      {/* Shift Open Modal */}
      {showShiftModal === "open" && (
        <div className="modal-backdrop" onClick={() => setShowShiftModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3>🟢 เปิดกะขาย</h3>
              <button className="modal__close" onClick={() => setShowShiftModal(null)}>×</button>
            </div>
            <p className="muted">ใส่จำนวนเงินทอนเริ่มต้นในลิ้นชัก</p>
            <input className="input" type="number" min={0} placeholder="เงินทอนเริ่มต้น (บาท)"
              value={cashInput} onChange={(e) => setCashInput(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleOpenShift(); }}
              style={{ fontSize: 20, textAlign: "center", margin: "16px 0" }} />
            <button className="btn btn--primary btn--full" onClick={handleOpenShift} disabled={loading}>
              {loading ? "กำลังเปิดกะ..." : "ยืนยันเปิดกะ"}
            </button>
          </div>
        </div>
      )}

      {/* Shift Close Modal */}
      {showShiftModal === "close" && activeShift && (
        <div className="modal-backdrop" onClick={() => setShowShiftModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3>🔒 ปิดกะ #{activeShift.id}</h3>
              <button className="modal__close" onClick={() => setShowShiftModal(null)}>×</button>
            </div>
            <div className="summary-grid" style={{ marginBottom: 16 }}>
              <div className="summary-card"><span>ยอดขายรวม</span><strong>{formatMoney(activeShift.totalSales)}</strong></div>
              <div className="summary-card"><span>ออเดอร์</span><strong>{activeShift.totalOrders}</strong></div>
              <div className="summary-card"><span>เงินสดรับ</span><strong>{formatMoney(activeShift.cashSales)}</strong></div>
            </div>
            <p className="muted">ยอดเงินสดที่ควรมี: <strong>{formatMoney(activeShift.openingCash + activeShift.cashSales)}</strong></p>
            <input className="input" type="number" min={0} placeholder="นับเงินจริงในลิ้นชัก (บาท)"
              value={cashInput} onChange={(e) => setCashInput(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCloseShift(); }}
              style={{ fontSize: 20, textAlign: "center", margin: "16px 0" }} />
            <button className="btn btn--primary btn--full" onClick={handleCloseShift} disabled={loading}>
              {loading ? "กำลังปิดกะ..." : "ยืนยันปิดกะ"}
            </button>
          </div>
        </div>
      )}

      {/* Closed Shift Summary */}
      {closedSummary && (
        <div className="modal-backdrop" onClick={() => setClosedSummary(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3>✅ สรุปกะ #{closedSummary.id}</h3>
              <button className="modal__close" onClick={() => setClosedSummary(null)}>×</button>
            </div>
            <div className="summary-grid" style={{ marginBottom: 16 }}>
              <div className="summary-card"><span>ยอดขายรวม</span><strong>{formatMoney(closedSummary.totalSales)}</strong></div>
              <div className="summary-card"><span>ออเดอร์</span><strong>{closedSummary.totalOrders}</strong></div>
              <div className="summary-card"><span>เงินสดรับ</span><strong>{formatMoney(closedSummary.cashSales)}</strong></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>เงินทอนเริ่มต้น</span><strong>{formatMoney(closedSummary.openingCash)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>เงินสดที่ควรมี</span><strong>{formatMoney(closedSummary.expectedCash ?? 0)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>เงินจริงในลิ้นชัก</span><strong>{formatMoney(closedSummary.closingCash ?? 0)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
                <span>ส่วนต่าง</span>
                <strong className={(closedSummary.difference ?? 0) >= 0 ? "positive" : "negative"}>
                  {(closedSummary.difference ?? 0) >= 0 ? "+" : ""}{formatMoney(closedSummary.difference ?? 0)}
                </strong>
              </div>
            </div>
            <button className="btn btn--primary btn--full" onClick={() => setClosedSummary(null)}>ปิด</button>
          </div>
        </div>
      )}
    </>
  );
}
