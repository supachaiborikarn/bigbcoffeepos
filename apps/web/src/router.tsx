import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const BranchSelectPage = lazy(() => import("./pages/BranchSelectPage"));
const DashboardPage = lazy(() => import("./components/DashboardPage"));
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage"));
const POSPage = lazy(() => import("./pages/POSPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const StaffPage = lazy(() => import("./pages/StaffPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const MigrationPage = lazy(() => import("./pages/MigrationPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const OrderQueuePage = lazy(() => import("./pages/OrderQueuePage"));
const CustomersPage = lazy(() => import("./pages/CustomersPage"));
const OrdersPage = lazy(() => import("./pages/OrdersPage"));
const ParityPage = lazy(() => import("./pages/ParityPage"));
const CustomerDisplayPage = lazy(() => import("./pages/CustomerDisplayPage"));

function routeElement(children: ReactNode) {
  return (
    <Suspense fallback={<div className="route-loading" aria-live="polite">กำลังโหลด...</div>}>
      {children}
    </Suspense>
  );
}

export const router = createBrowserRouter([
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
      { path: "/inventory", element: routeElement(<InventoryPage />) },
      { path: "/customers", element: routeElement(<CustomersPage />) },
      { path: "/staff", element: routeElement(<StaffPage />) },
      { path: "/reports", element: routeElement(<ReportsPage />) },
      { path: "/parity", element: routeElement(<ParityPage />) },
      { path: "/customer-display", element: routeElement(<CustomerDisplayPage />) },
      { path: "/marketing", element: <Navigate to="/pos" replace /> },
      { path: "/migration", element: routeElement(<MigrationPage />) },
      { path: "/settings", element: routeElement(<SettingsPage />) },
    ],
  },
  { path: "*", element: <Navigate to="/login" replace /> },
]);
