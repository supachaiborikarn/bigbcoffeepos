import { RouterProvider } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { BranchProvider, useBranch } from "./contexts/BranchContext";
import { ShiftProvider } from "./contexts/ShiftContext";
import { ToastProvider } from "./contexts/ToastContext";
import { CartProvider } from "./contexts/CartContext";
import { router } from "./router";

export default function App() {
  return (
    <AuthProvider>
      <BranchProvider>
        <Workspace />
      </BranchProvider>
    </AuthProvider>
  );
}

function Workspace() {
  const { activeBranch } = useBranch();
  const { user } = useAuth();
  return <ShiftProvider key={`${user?.id}:${activeBranch?.id}`}><ToastProvider><CartProvider><RouterProvider router={router} future={{ v7_startTransition: true }} /></CartProvider></ToastProvider></ShiftProvider>;
}
