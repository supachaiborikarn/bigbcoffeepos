import { Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import AppLayout from "./components/layout/AppLayout";
import RouteErrorPage from "./components/RouteErrorPage";
import { lazyRoute } from "./utils/lazyRoute";

const LoginPage = lazyRoute(() => import("./pages/LoginPage"));
const BranchSelectPage = lazyRoute(() => import("./pages/BranchSelectPage"));
const DashboardPage = lazyRoute(() => import("./components/DashboardPage"));
const AdminDashboardPage = lazyRoute(() => import("./pages/AdminDashboardPage"));
const ActivityLogPage = lazyRoute(() => import("./pages/ActivityLogPage"));
const POSPage = lazyRoute(() => import("./pages/POSPage"));
const InventoryPage = lazyRoute(() => import("./pages/InventoryPage"));
const BranchInventoryPage = lazyRoute(() => import("./pages/BranchInventoryPage"));
const StaffPage = lazyRoute(() => import("./pages/StaffPage"));
const ReportsPage = lazyRoute(() => import("./pages/ReportsPage"));
const MigrationPage = lazyRoute(() => import("./pages/MigrationPage"));
const SettingsPage = lazyRoute(() => import("./pages/SettingsPage"));
const OrderQueuePage = lazyRoute(() => import("./pages/OrderQueuePage"));
const CustomersPage = lazyRoute(() => import("./pages/CustomersPage"));
const OrdersPage = lazyRoute(() => import("./pages/OrdersPage"));
const ParityPage = lazyRoute(() => import("./pages/ParityPage"));
const CustomerDisplayPage = lazyRoute(() => import("./pages/CustomerDisplayPage"));
const WarehousePage = lazyRoute(() => import("./pages/WarehousePage"));

function routeElement(children: ReactNode) {
  return (
    <Suspense fallback={<div className="route-loading" aria-live="polite">กำลังโหลด...</div>}>
      {children}
    </Suspense>
  );
}

export const router = createBrowserRouter([{ errorElement: <RouteErrorPage />, children: [
  { path: "/login", element: routeElement(<LoginPage />) },
  { path: "/branch", element: routeElement(<BranchSelectPage />) },
  {
    element: <AppLayout />,
    children: [
      { path: "/dashboard", element: routeElement(<DashboardPage branchId={null} />) },
      { path: "/admin", element: routeElement(<AdminDashboardPage />) },
      { path: "/pos", element: routeElement(<POSPage />) },
      { path: "/queue", element: routeElement(<OrderQueuePage />) },
      { path: "/orders", element: routeElement(<OrdersPage />) },
      { path: "/inventory", element: routeElement(<InventoryRoute />) },
      { path: "/warehouse", element: routeElement(<WarehousePage />) },
      { path: "/customers", element: routeElement(<CustomersPage />) },
      { path: "/staff", element: routeElement(<StaffPage />) },
      { path: "/reports", element: routeElement(<ReportsPage />) },
      { path: "/parity", element: routeElement(<ParityPage />) },
      { path: "/customer-display", element: routeElement(<CustomerDisplayPage />) },
      { path: "/marketing", element: <Navigate to="/pos" replace /> },
      { path: "/migration", element: routeElement(<MigrationPage />) },
      { path: "/settings", element: routeElement(<SettingsPage />) },
      { path: "/activity", element: routeElement(<ActivityLogPage />) },
    ],
  },
  { path: "*", element: <Navigate to="/login" replace /> },
] }]);

function InventoryRoute() {
  const { user } = useAuth();
  return user?.role === "admin" ? <InventoryPage /> : <BranchInventoryPage />;
}
