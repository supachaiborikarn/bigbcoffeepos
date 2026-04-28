import { createBrowserRouter, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import BranchSelectPage from "./pages/BranchSelectPage";
import DashboardPage from "./components/DashboardPage";
import POSPage from "./pages/POSPage";
import InventoryPage from "./pages/InventoryPage";
import StaffPage from "./pages/StaffPage";
import ReportsPage from "./pages/ReportsPage";
import MigrationPage from "./pages/MigrationPage";
import SettingsPage from "./pages/SettingsPage";
import OrderQueuePage from "./pages/OrderQueuePage";
import CustomersPage from "./pages/CustomersPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/branch", element: <BranchSelectPage /> },
  { path: "/queue", element: <OrderQueuePage /> },
  {
    element: <AppLayout />,
    children: [
      { path: "/dashboard", element: <DashboardPage branchId={null} /> },
      { path: "/pos", element: <POSPage /> },
      { path: "/inventory", element: <InventoryPage /> },
      { path: "/customers", element: <CustomersPage /> },
      { path: "/staff", element: <StaffPage /> },
      { path: "/reports", element: <ReportsPage /> },
      { path: "/finance", element: <div style={{ padding: 40, textAlign: "center" }}><h2>การเงิน</h2><p className="muted" style={{ marginTop: 8 }}>Coming Soon — ระบบบัญชีและการเงินกำลังพัฒนา</p></div> },
      { path: "/migration", element: <MigrationPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/login" replace /> },
]);
