import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import {
  LayoutDashboard,
  Store,
  Package,
  Users,
  BarChart3,
  Settings,
  LogOut,
  UserCircle,
  ShoppingBag,
  ClipboardList,
  Database,
} from "lucide-react";
import BrandLogo from "../BrandLogo";

const ROLE_LEVEL: Record<string, number> = { cashier: 1, manager: 2, admin: 3 };

const navItems = [
  { to: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard, minRole: 2 },
  { to: "/pos", label: "ขายสินค้า", icon: Store, minRole: 1 },
  { to: "/orders", label: "ออเดอร์/เดลิเวอรี่", icon: ShoppingBag, minRole: 1 },
  { to: "/inventory?tab=products&manage=menu", label: "เมนูขาย/สต็อก", icon: Package, minRole: 2 },
  { to: "/customers", label: "ลูกค้า", icon: UserCircle, minRole: 2 },
  { to: "/staff", label: "พนักงาน", icon: Users, minRole: 3 },
  { to: "/reports", label: "รายงาน", icon: BarChart3, minRole: 2 },
  { to: "/parity", label: "งานเพิ่มเติม", icon: ClipboardList, minRole: 2 },
  { to: "/migration", label: "ย้ายข้อมูล", icon: Database, minRole: 3 },
  { to: "/queue", label: "คิวครัว", icon: ShoppingBag, minRole: 1 },
  { to: "/settings", label: "ตั้งค่า", icon: Settings, minRole: 3 },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { branches, activeBranch, setBranchId } = useBranch();
  const userLevel = ROLE_LEVEL[user?.role ?? "cashier"] ?? 0;

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar__brand">
        <BrandLogo className="sidebar__brand-logo" />
        <div className="sidebar__brand-text">
          <span className="sidebar__brand-name">Big B Coffee</span>
          <span className="sidebar__brand-sub">POS Platform</span>
        </div>
      </div>

      {/* Branch Selector */}
      <select
        className="sidebar__branch-select"
        value={activeBranch?.id ?? ""}
        onChange={(e) => setBranchId(Number(e.target.value))}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>

      <div className="sidebar__section-label">เมนูหลัก</div>

      {/* Navigation */}
      <nav className="sidebar__nav">
        {navItems.filter((n) => userLevel >= n.minRole).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `sidebar__link ${isActive ? "sidebar__link--active" : ""}`
              }
            >
              <Icon className="sidebar__icon" size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar__footer">
        <div className="sidebar__user-panel">
          <div className="sidebar__user-avatar">
            {user?.name?.charAt(0) || "U"}
          </div>
          <div className="sidebar__user-info">
            <strong>{user?.name}</strong>
            <span>ออนไลน์</span>
          </div>
        </div>
        <button className="sidebar__logout" onClick={logout}>
          <LogOut size={14} />
          ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}
