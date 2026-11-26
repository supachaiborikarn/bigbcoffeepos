import { useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import PrintCenter from "../PrintCenter";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import { businessProfile } from "../../utils/business";

const ADMIN_ROUTES = ["/admin", "/staff", "/migration", "/settings", "/parity", "/activity"];
const MANAGER_ROUTES = ["/dashboard", "/reports", "/customers", "/inventory"];
const DRAWER_QUERY = "(max-width: 999px)";
const SIDEBAR_KEY = "bbpos.sidebarCollapsed.v2";

export default function AppLayout() {
  const { user, loading: authLoading } = useAuth();
  const { activeBranch, loading } = useBranch();
  const location = useLocation();
  // No choice made yet: touch tablets (≈1200px wide in landscape) start with the icon-only
  // sidebar so the sale screen gets the room. The toggle expands it and that choice is kept.
  // (A new key: the old one was written on every page load, so it never meant a real choice.)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved !== null) return saved === "1";
    return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse) and (max-width: 1366px)").matches;
  });
  const toggleSidebar = () => setSidebarCollapsed((value) => {
    try { localStorage.setItem(SIDEBAR_KEY, value ? "0" : "1"); } catch { /* storage blocked: keep it for this visit only */ }
    return !value;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  // At ≤999px the sidebar is a slide-in drawer (studio.css); it always shows full labels there.
  const [drawerNav, setDrawerNav] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(DRAWER_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DRAWER_QUERY);
    const sync = () => { setDrawerNav(mql.matches); if (!mql.matches) setMobileOpen(false); };
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);
  const [appearance, setAppearance] = useState(() => localStorage.getItem("bbpos.appearance") === "dark" ? "dark" : "light");
  const profile = businessProfile(activeBranch?.branchType);
  useEffect(() => { localStorage.setItem("bbpos.appearance", appearance); }, [appearance]);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  if (authLoading || loading) return <div className="route-loading">กำลังเปิดพื้นที่ทำงาน...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!activeBranch) return <Navigate to="/branch" replace />;
  if ((ADMIN_ROUTES.includes(location.pathname) && user.role !== "admin") || (MANAGER_ROUTES.includes(location.pathname) && user.role === "cashier") || (location.pathname === "/queue" && !profile.queue)) return <Navigate to="/pos" replace />;
  const isPOSPage = location.pathname.startsWith("/pos");

  return <div className={`app-layout studio-app${!sidebarCollapsed && !drawerNav ? " studio-app--sidebar-open" : ""}`} data-business={profile.type} data-appearance={appearance}>
    <div className="app-layout__body">
      <Sidebar collapsed={sidebarCollapsed && !drawerNav} onToggle={toggleSidebar} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="app-layout__main">
        <TopBar onOpenMenu={() => setMobileOpen(true)} mobileOpen={mobileOpen} appearance={appearance} onToggleAppearance={() => setAppearance((v) => v === "light" ? "dark" : "light")} />
        <PrintCenter key={`${user.id}:${activeBranch.id}`} />
        <div className={`app-layout__content${isPOSPage ? " studio-content--pos" : ""}`}>
          <Outlet key={`${user.id}:${activeBranch.id}`} />
        </div>
      </div>
    </div>
  </div>;
}
