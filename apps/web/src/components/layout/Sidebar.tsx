import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { 
  LayoutDashboard, 
  Store, 
  Package, 
  Users, 
  BarChart3, 
  Settings, 
  LogOut,
  Database
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

export default function Sidebar() {
  const { user, logout } = useAuth();
  const userLevel = ROLE_LEVEL[user?.role ?? "cashier"] ?? 0;

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span style={{ fontWeight: 800 }}>POSPOS</span><span style={{ fontWeight: 400, fontSize: 12, marginLeft: 4 }}>Smart</span>
      </div>

      <div className="sidebar__user-panel">
        <div className="sidebar__user-avatar">{user?.name?.charAt(0) || "U"}</div>
        <div className="sidebar__user-info">
          <strong>{user?.name}</strong>
          <span>ออนไลน์</span>
        </div>
      </div>

      <div className="sidebar__nav-header">เมนูหลัก</div>

      <nav className="sidebar__nav">
        {navItems.filter((n) => userLevel >= n.minRole).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar__link ${isActive ? "sidebar__link--active" : ""}`}
            >
              <Icon className="sidebar__icon" size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div style={{ padding: "15px", marginTop: "auto" }}>
        <button 
          onClick={logout} 
          style={{
            width: "100%",
            background: "#d9534f",
            color: "white",
            border: "none",
            padding: "10px",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "bold"
          }}
        >
          <LogOut size={16} />
          ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}
