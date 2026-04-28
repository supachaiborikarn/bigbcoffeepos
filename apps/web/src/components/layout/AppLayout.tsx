import { Outlet, Navigate, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";

export default function AppLayout() {
  const { user } = useAuth();
  const { activeBranch } = useBranch();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace />;
  if (!activeBranch) return <Navigate to="/branch" replace />;

  const isPOSPage = location.pathname.startsWith("/pos");

  return (
    <div className="app-layout">
      <TopBar />
      <div className="app-layout__body">
        <Sidebar />
        <div className="app-layout__main">
          <div className="app-layout__content" style={{ padding: isPOSPage ? "0" : "16px" }}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
