import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { BranchProvider } from "./contexts/BranchContext";
import { ShiftProvider } from "./contexts/ShiftContext";
import { ToastProvider } from "./contexts/ToastContext";
import { CartProvider } from "./contexts/CartContext";
import { router } from "./router";

export default function App() {
  return (
    <AuthProvider>
      <BranchProvider>
        <ShiftProvider>
          <ToastProvider>
            <CartProvider>
              <RouterProvider router={router} future={{ v7_startTransition: true }} />
            </CartProvider>
          </ToastProvider>
        </ShiftProvider>
      </BranchProvider>
    </AuthProvider>
  );
}
