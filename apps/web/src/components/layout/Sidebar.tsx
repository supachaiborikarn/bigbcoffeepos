import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import { useShift } from "../../contexts/ShiftContext";

const ROLE_LEVEL: Record<string, number> = { cashier: 1, manager: 2, admin: 3 };

const navItems = [
  { to: "/dashboard", label: "แดชบอร์ด", icon: "📈", minRole: 2 },
  { to: "/pos", label: "หน้าร้าน", icon: "☕", minRole: 1 },
  { to: "/inventory", label: "สินค้า & สต็อก", icon: "📦", minRole: 2 },
  { to: "/staff", label: "พนักงาน", icon: "👥", minRole: 3 },
  { to: "/reports", label: "รายงาน", icon: "📊", minRole: 2 },
  { to: "/migration", label: "ย้ายข้อมูล", icon: "📥", minRole: 3 },
  { to: "/settings", label: "ตั้งค่า", icon: "⚙️", minRole: 3 },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { activeBranch } = useBranch();
  const { activeShift } = useShift();
  const userLevel = ROLE_LEVEL[user?.role ?? "cashier"] ?? 0;

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="brand__mark">BB</div>
        <div className="sidebar__brand-text">
          <strong>Big B Coffee</strong>
          <span className="sidebar__branch">{activeBranch?.name ?? "ไม่ได้เลือกสาขา"}</span>
        </div>
      </div>

      <nav className="sidebar__nav">
        {navItems.filter((n) => userLevel >= n.minRole).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar__link ${isActive ? "sidebar__link--active" : ""}`}
          >
            <span className="sidebar__icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        {activeShift ? (
          <div className="sidebar__shift">
            <span className="sidebar__shift-dot sidebar__shift-dot--open" />
            กะ #{activeShift.id} เปิดอยู่
          </div>
        ) : (
          <div className="sidebar__shift">
            <span className="sidebar__shift-dot" />
            ยังไม่เปิดกะ
          </div>
        )}
        <div className="sidebar__user">
          <span>👤 {user?.name}</span>
        </div>
        <button className="btn btn--ghost sidebar__logout" onClick={logout}>
          ← ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}
