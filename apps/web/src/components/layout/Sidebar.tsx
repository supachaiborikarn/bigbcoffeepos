import { NavLink } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import { businessProfile, roleLabels } from "../../utils/business";
import { LayoutDashboard, Package, Users, BarChart3, Settings, LogOut, UserCircle, ShoppingBag, ClipboardList, Database, PanelsTopLeft, PanelLeftClose, PanelLeftOpen, X, ShieldCheck, History } from "lucide-react";

interface SidebarProps { collapsed?: boolean; onToggle?: () => void; mobileOpen?: boolean; onClose?: () => void }

export default function Sidebar({ collapsed = false, onToggle, mobileOpen, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const { activeBranch } = useBranch();
  const profile = businessProfile(activeBranch?.branchType);
  const BusinessIcon = profile.icon;
  const level = { cashier: 1, manager: 2, admin: 3 }[user?.role ?? "cashier"] ?? 0;
  const items = [
    { to: "/pos", label: profile.saleTitle, icon: BusinessIcon, min: 1, group: "หน้าร้าน" },
    { to: "/orders", label: profile.orderTitle, icon: ShoppingBag, min: 1, group: "หน้าร้าน" },
    ...(profile.queue ? [{ to: "/queue", label: "คิวเครื่องดื่ม", icon: ClipboardList, min: 1, group: "หน้าร้าน" }] : []),
    { to: "/dashboard", label: "ภาพรวมสาขา", icon: LayoutDashboard, min: 2, group: "จัดการร้าน" },
    { to: "/inventory", label: profile.catalogTitle, icon: Package, min: 2, group: "จัดการร้าน" },
    { to: "/customers", label: "ลูกค้าและสมาชิก", icon: UserCircle, min: 2, group: "จัดการร้าน" },
    { to: "/reports", label: "รายงานยอดขาย", icon: BarChart3, min: 2, group: "จัดการร้าน" },
    { to: "/admin", label: "ภาพรวมทุกสาขา", icon: PanelsTopLeft, min: 3, group: "ระบบ" },
    { to: "/staff", label: "พนักงานและสิทธิ์", icon: Users, min: 3, group: "ระบบ" },
    { to: "/activity", label: "บันทึกกิจกรรม", icon: History, min: 3, group: "ระบบ" },
    { to: "/parity", label: "งานหลังร้าน", icon: ClipboardList, min: 3, group: "ระบบ" },
    { to: "/migration", label: "นำเข้าข้อมูล", icon: Database, min: 3, group: "ระบบ" },
    { to: "/settings", label: "ตั้งค่าระบบ", icon: Settings, min: 3, group: "ระบบ" }
  ].filter((item) => level >= item.min);

  return <>
    {mobileOpen && <button className="studio-nav-scrim" aria-label="ปิดเมนู" onClick={onClose} />}
    <aside id="main-navigation" className={`sidebar${collapsed ? " sidebar--collapsed" : ""}${mobileOpen ? " sidebar--mobile-open" : ""}`}>
      <div className="sidebar__brand">
        <span className="studio-brand-mark"><BusinessIcon size={24} strokeWidth={1.7} /></span>
        <div className="sidebar__brand-text"><span className="sidebar__brand-name">{profile.brand}</span><span className="sidebar__brand-sub">BRANCH WORKSPACE</span></div>
        <button className="sidebar__toggle" onClick={onToggle} aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
        <button className="studio-nav-close" onClick={onClose} aria-label="ปิดเมนู"><X size={20} /></button>
      </div>
      <div className="studio-branch-card"><span className="studio-branch-indicator" /><span><small>{profile.title}</small><strong>{activeBranch?.name}</strong></span></div>
      <nav className="sidebar__nav" aria-label="เมนูหลัก">
        {items.map((item, index) => <div key={item.to}>
          {items[index - 1]?.group !== item.group && <div className="sidebar__section-label">{item.group}</div>}
          <NavLink to={item.to} title={item.label} aria-label={item.label} onClick={onClose} className={({ isActive }) => `sidebar__link ${isActive ? "sidebar__link--active" : ""}`}><item.icon className="sidebar__icon" size={19} /><span>{item.label}</span></NavLink>
        </div>)}
      </nav>
      <div className="sidebar__footer">
        <div className="studio-scope-note"><ShieldCheck size={15} /><span>{user?.role === "admin" ? "สิทธิ์ผู้ดูแลระบบ" : "พื้นที่ทำงานเฉพาะสาขาของคุณ"}</span></div>
        <div className="sidebar__user-panel"><div className="sidebar__user-avatar">{user?.name?.charAt(0)}</div><div className="sidebar__user-info"><strong>{user?.name}</strong><span>{roleLabels[user?.role ?? ""]}</span></div><button className="studio-logout-icon" onClick={logout} aria-label="ออกจากระบบ" title="ออกจากระบบ"><LogOut size={18} /></button></div>
      </div>
    </aside>
  </>;
}
