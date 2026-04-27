import { Outlet, Navigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";

export default function AppLayout() {
  const { user } = useAuth();
  const { activeBranch } = useBranch();

  if (!user) return <Navigate to="/login" replace />;
  if (!activeBranch) return <Navigate to="/branch" replace />;

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-layout__main">
        <TopBar />
        <div className="app-layout__content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
