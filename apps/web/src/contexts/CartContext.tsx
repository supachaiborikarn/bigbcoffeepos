import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CartItem, DiscountRule, DiscountType, Order, PaymentMethod } from "../types";
import { createOrder, getOrderByIdempotencyKey } from "../api";
import { useBranch } from "./BranchContext";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";
import { useShift } from "./ShiftContext";

type ScanFeedback = { tone: "idle" | "success" | "error"; message: string; code?: string };

type CartContextType = {
  cart: CartItem[];
  discountType: DiscountType;
  discountValue: string;
  discountRules: DiscountRule[];
  pointsToUse: string;
  scanFeedback: ScanFeedback;
  addItem: (item: CartItem) => void;
  updateQty: (id: string, delta: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  setDiscountType: (type: DiscountType) => void;
  setDiscountValue: (val: string) => void;
  addDiscountRule: (rule: DiscountRule) => void;
  removeDiscountRule: (id: string) => void;
  clearDiscountRules: () => void;
  setPointsToUse: (val: string) => void;
  setScanFeedback: (feedback: ScanFeedback) => void;
  checkout: (paymentMethod: PaymentMethod, customerId: number | null, usablePoints: number, paymentDetails?: { cashReceived?: number; paymentConfirmed?: boolean; referenceNo?: string }) => Promise<Order>;
  subtotal: number;
  discountAmount: number;
  total: number;
};

const CartContext = createContext<CartContextType | null>(null);

function makeId() {
  return Math.random().toString(36).substring(2, 9);
}

function makeCheckoutKey() {
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isCheckoutTimeout(error: unknown) {
  return String((error as Error).message).includes("บันทึกออเดอร์นานเกินไป");
}

async function recoverTimedOutCheckout(idempotencyKey: string) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 18_000) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    try {
      return await getOrderByIdempotencyKey(idempotencyKey);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("บันทึกออเดอร์นานเกินไป กรุณาตรวจสอบหน้ารายการออเดอร์ก่อนกดซ้ำ");
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>(null);
  const [discountValue, setDiscountValue] = useState("");
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);
  const [pointsToUse, setPointsToUse] = useState("");
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>({ tone: "idle", message: "พร้อมยิงบาร์โค้ด" });
  
  const { activeBranch } = useBranch();
  const { user } = useAuth();
  const { activeShift, refreshShift } = useShift();
  const toast = useToast();
  const previousBranchId = useRef<number | null>(null);
  const checkoutKeyRef = useRef<string | null>(null);

  const addItem = useCallback((item: CartItem) => {
    checkoutKeyRef.current = null;
    setCart((prev) => [...prev, item]);
  }, []);

  const updateQty = useCallback((id: string, delta: number) => {
    checkoutKeyRef.current = null;
    setCart((prev) =>
      prev.map((item) => (item.id === id ? { ...item, qty: Math.max(1, item.qty + delta) } : item)).filter(i => i.qty > 0)
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    checkoutKeyRef.current = null;
    setCart((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    checkoutKeyRef.current = null;
    setCart([]);
    setDiscountType(null);
    setDiscountValue("");
    setDiscountRules([]);
    setPointsToUse("");
    setScanFeedback({ tone: "idle", message: "พร้อมยิงบาร์โค้ด" });
  }, []);

  useEffect(() => {
    const branchId = activeBranch?.id ?? null;
    if (previousBranchId.current !== null && previousBranchId.current !== branchId) {
      clearCart();
    }
    previousBranchId.current = branchId;
  }, [activeBranch?.id, clearCart]);

  const subtotal = useMemo(() => cart.reduce((sum, item) => {
    const modifiersTotal = item.modifiers.reduce((modSum, mod) => modSum + mod.price, 0);
    return sum + (item.basePrice + modifiersTotal) * item.qty;
  }, 0), [cart]);

  const addDiscountRule = useCallback((rule: DiscountRule) => {
    setDiscountRules((prev) => [...prev, rule]);
  }, []);

  const removeDiscountRule = useCallback((id: string) => {
    setDiscountRules((prev) => prev.filter((rule) => rule.id !== id));
  }, []);

  const clearDiscountRules = useCallback(() => {
    setDiscountRules([]);
    setDiscountType(null);
    setDiscountValue("");
  }, []);

  const computeRuleDiscount = useCallback((rule: DiscountRule, remainingSubtotal: number) => {
    let amount = 0;

    if (rule.type === "ORDER_PERCENT") {
      amount = subtotal * ((rule.value ?? 0) / 100);
    } else if (rule.type === "ORDER_FIXED") {
      amount = rule.value ?? 0;
    } else if (rule.type === "CATEGORY_PERCENT") {
      const eligible = cart
        .filter((item) => item.category === rule.category)
        .reduce((sum, item) => {
          const modifiersTotal = item.modifiers.reduce((modSum, mod) => modSum + mod.price, 0);
          return sum + (item.basePrice + modifiersTotal) * item.qty;
        }, 0);
      amount = eligible * ((rule.value ?? 0) / 100);
    } else if (rule.type === "BUY_X_GET_Y") {
      const buyQty = rule.buyQty ?? 2;
      const getQty = rule.getQty ?? 1;
      const unitPrices: number[] = [];
      cart.filter((item) => item.category === rule.category).forEach((item) => {
        const modifiersTotal = item.modifiers.reduce((modSum, mod) => modSum + mod.price, 0);
        for (let index = 0; index < Math.floor(item.qty); index += 1) unitPrices.push(item.basePrice + modifiersTotal);
      });
      const freeCount = Math.floor(unitPrices.length / (buyQty + getQty)) * getQty;
      amount = unitPrices.sort((a, b) => a - b).slice(0, freeCount).reduce((sum, price) => sum + price, 0);
    }

    const validMaxDiscount = Number.isFinite(rule.maxDiscount) ? Math.max(0, Number(rule.maxDiscount)) : undefined;
    const maxDiscount = validMaxDiscount === undefined ? amount : Math.min(amount, validMaxDiscount);
    return Math.max(0, Math.min(remainingSubtotal, maxDiscount));
  }, [cart, subtotal]);
  
  const discountAmount = useMemo(() => {
    let totalDiscount = 0;
    discountRules.forEach((rule) => {
      totalDiscount += computeRuleDiscount(rule, Math.max(0, subtotal - totalDiscount));
    });

    if (discountRules.length === 0) {
      const val = Number(discountValue);
      if (discountType === "PERCENT" && Number.isFinite(val) && val > 0) {
        totalDiscount = Math.min(subtotal, subtotal * (val / 100));
      } else if (discountType === "FIXED" && Number.isFinite(val) && val > 0) {
        totalDiscount = Math.min(subtotal, val);
      }
    }

    return Math.round(totalDiscount * 100) / 100;
  }, [subtotal, discountType, discountValue, discountRules, computeRuleDiscount]);

  const total = useMemo(() => {
    const pointsDiscount = Math.min(Number(pointsToUse) || 0, Math.max(0, subtotal - discountAmount));
    return Math.round(Math.max(0, subtotal - discountAmount - pointsDiscount) * 100) / 100;
  }, [subtotal, discountAmount, pointsToUse]);

  const checkout = useCallback(async (paymentMethod: PaymentMethod, customerId: number | null, usablePoints: number, paymentDetails?: { cashReceived?: number; paymentConfirmed?: boolean; referenceNo?: string }) => {
    if (cart.length === 0 || !activeBranch) throw new Error("ไม่สามารถชำระเงินได้");
    if (!activeShift) throw new Error("กรุณาเปิดกะก่อนขาย");
    const idempotencyKey = checkoutKeyRef.current ?? makeCheckoutKey();
    checkoutKeyRef.current = idempotencyKey;
    try {
      const orderInput: Parameters<typeof createOrder>[0] = {
        items: cart,
        paymentMethod,
        paymentDetails,
        discountType,
        discountValue: Number(discountValue) || 0,
        discounts: discountRules,
        branchId: activeBranch.id,
        customerId,
        loyaltyPointsToUse: usablePoints,
        userId: user?.id,
        shiftId: activeShift.id,
        idempotencyKey,
      };
      let order: Order;
      const checkoutStartedAt = performance.now();
      try {
        order = await createOrder(orderInput);
      } catch (error) {
        if (!isCheckoutTimeout(error)) throw error;
        console.warn("[POS] checkout timed out, polling existing order", { idempotencyKey });
        order = await recoverTimedOutCheckout(idempotencyKey);
      } finally {
        const durationMs = Math.round(performance.now() - checkoutStartedAt);
        if (durationMs > 3_000) console.warn("[POS] checkout duration", { durationMs, idempotencyKey });
      }
      clearCart();
      void refreshShift().catch((error) => {
        console.warn("[POS] refresh shift after checkout failed", error);
      });
      toast.success("ชำระเงินสำเร็จ");
      return order;
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  }, [cart, activeBranch, activeShift, user, discountType, discountValue, discountRules, clearCart, refreshShift, toast]);

  return (
    <CartContext.Provider value={{
      cart, discountType, discountValue, discountRules, pointsToUse, scanFeedback,
      addItem, updateQty, removeItem, clearCart, setDiscountType, setDiscountValue, addDiscountRule, removeDiscountRule, clearDiscountRules, setPointsToUse, setScanFeedback, checkout,
      subtotal, discountAmount, total
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
