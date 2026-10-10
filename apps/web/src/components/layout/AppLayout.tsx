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

export default function AppLayout() {
  const { user, loading: authLoading } = useAuth();
  const { activeBranch, loading } = useBranch();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("bbpos.sidebarCollapsed") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [appearance, setAppearance] = useState(() => localStorage.getItem("bbpos.appearance") === "dark" ? "dark" : "light");
  const profile = businessProfile(activeBranch?.branchType);
  useEffect(() => { localStorage.setItem("bbpos.sidebarCollapsed", sidebarCollapsed ? "1" : "0"); }, [sidebarCollapsed]);
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

  return <div className="app-layout studio-app" data-business={profile.type} data-appearance={appearance}>
    <div className="app-layout__body">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
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
