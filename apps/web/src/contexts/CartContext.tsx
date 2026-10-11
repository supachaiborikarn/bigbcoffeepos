import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Customer, CartItem, DiscountRule, DiscountType, Order, PaymentMethod } from "../types";
import { approveDiscount as requestDiscountApproval, createOrder, getActivePromotions, getOrderByIdempotencyKey, validateCoupon } from "../api";
import { useBranch } from "./BranchContext";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";
import { useShift } from "./ShiftContext";

type ScanFeedback = { tone: "idle" | "success" | "error"; message: string; code?: string };

export type AppliedCoupon = { code: string; type: string; value: number; minSpend?: number };
export type DiscountApproval = { token: string; approverName: string };

/** Mirrors the server: manual discounts at or above this share of the bill need a manager. */
export const MANUAL_DISCOUNT_APPROVAL_RATIO = 0.5;

const PROMO_RULE_TYPES = new Set(["ORDER_PERCENT", "ORDER_FIXED", "CATEGORY_PERCENT", "BUY_X_GET_Y"]);

function promotionToRule(promo: { id: number; name: string; type: string; value: number; category?: string }): DiscountRule | null {
  if (!PROMO_RULE_TYPES.has(promo.type)) return null;
  return {
    id: `PROMO-${promo.id}`,
    label: promo.name,
    type: promo.type as DiscountRule["type"],
    value: Number(promo.value) || 0,
    category: promo.category || undefined
  };
}

export type HeldBill = {
  id: string;
  label: string;
  branchId: number | null;
  createdAt: string;
  itemCount: number;
  total: number;
  cart: CartItem[];
  discountType: DiscountType;
  discountValue: string;
  discountRules: DiscountRule[];
  pointsToUse: string;
  orderNote?: string;
  selectedMember?: Customer | null;
  appliedCoupon?: AppliedCoupon | null;
};

type CartContextType = {
  selectedMember: Customer | null;
  setSelectedMember: (customer: Customer | null) => void;
  orderNote: string;
  setOrderNote: (note: string) => void;
  cart: CartItem[];
  discountType: DiscountType;
  discountValue: string;
  discountRules: DiscountRule[];
  pointsToUse: string;
  scanFeedback: ScanFeedback;
  addItem: (item: CartItem) => void;
  updateQty: (id: string, delta: number) => void;
  setItemNote: (id: string, note: string) => void;
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
  heldBills: HeldBill[];
  holdCart: (label?: string) => boolean;
  restoreHeldBill: (id: string) => void;
  removeHeldBill: (id: string) => void;
  appliedCoupon: AppliedCoupon | null;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: () => void;
  autoPromotions: DiscountRule[];
  /** the single auto promotion the server will apply to this bill (they don't stack) */
  appliedPromotion: DiscountRule | null;
  skipPromotions: boolean;
  setSkipPromotions: (skip: boolean) => void;
  couponBelowMinSpend: boolean;
  needsDiscountApproval: boolean;
  discountApproval: DiscountApproval | null;
  approveDiscount: (pin: string) => Promise<void>;
  clearDiscountApproval: () => void;
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
  const { activeBranch } = useBranch();
  const { user } = useAuth();
  const storageKey = `bbpos.cart:${user?.id}:${activeBranch?.id}`;
  const [saved] = useState(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
      return draft && typeof draft === "object" && !Array.isArray(draft) ? draft : {};
    } catch { return {}; }
  });
  const [cart, setCart] = useState<CartItem[]>(Array.isArray(saved.cart) ? saved.cart : []);
  const [selectedMember, setSelectedMember] = useState<Customer | null>(saved.selectedMember || null);
  const [orderNote, setOrderNote] = useState<string>(saved.orderNote || "");
  const [discountType, setDiscountType] = useState<DiscountType>(saved.discountType ?? null);
  const [discountValue, setDiscountValue] = useState(saved.discountValue || "");
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>(saved.discountRules || []);
  const [pointsToUse, setPointsToUse] = useState(saved.pointsToUse || "");
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>({ tone: "idle", message: "พร้อมยิงบาร์โค้ด" });
  const [heldBills, setHeldBills] = useState<HeldBill[]>(saved.heldBills || []);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(saved.appliedCoupon || null);
  const [autoPromotions, setAutoPromotions] = useState<DiscountRule[]>([]);
  const [skipPromotions, setSkipPromotions] = useState<boolean>(saved.skipPromotions === true);
  // approval token only lives in memory: a reload asks the manager again
  const [discountApproval, setDiscountApproval] = useState<DiscountApproval | null>(null);

  const { activeShift, refreshShift } = useShift();
  const toast = useToast();
  const checkoutKeyRef = useRef<string | null>(saved.checkoutKey || null);
  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify({ cart, orderNote, selectedMember, pointsToUse, discountType, discountValue, discountRules, heldBills, appliedCoupon, skipPromotions, checkoutKey: checkoutKeyRef.current }));
  }, [storageKey, cart, orderNote, selectedMember, pointsToUse, discountType, discountValue, discountRules, heldBills, appliedCoupon, skipPromotions]);

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

  const setItemNote = useCallback((id: string, note: string) => {
    checkoutKeyRef.current = null;
    setCart((prev) => prev.map((item) => item.id === id ? { ...item, note: note.trim().slice(0, 120) || undefined } : item));
  }, []);

  const removeItem = useCallback((id: string) => {
    checkoutKeyRef.current = null;
    setCart((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    checkoutKeyRef.current = null;
    setCart([]);
    setOrderNote("");
    setSelectedMember(null);
    setDiscountType(null);
    setDiscountValue("");
    setDiscountRules([]);
    setPointsToUse("");
    setAppliedCoupon(null);
    setSkipPromotions(false);
    setDiscountApproval(null);
    setScanFeedback({ tone: "idle", message: "พร้อมยิงบาร์โค้ด" });
  }, []);

  // Load active promotions so POS totals mirror the server's auto-applied discount.
  useEffect(() => {
    let cancelled = false;
    if (!activeBranch || !user) return;
    getActivePromotions()
      .then((items) => {
        if (cancelled) return;
        setAutoPromotions(items.map(promotionToRule).filter((rule): rule is DiscountRule => Boolean(rule)));
      })
      .catch(() => { if (!cancelled) setAutoPromotions([]); });
    return () => { cancelled = true; };
  }, [activeBranch?.id]);

  const subtotal = useMemo(() => cart.reduce((sum, item) => {
    const modifiersTotal = item.modifiers.reduce((modSum, mod) => modSum + mod.price, 0);
    return sum + (item.basePrice + modifiersTotal) * item.qty;
  }, 0), [cart]);

  const addDiscountRule = useCallback((rule: DiscountRule) => {
    setDiscountRules((prev) => [...prev, rule]);
  }, []);

  const removeDiscountRule = useCallback((id: string) => {
    setDiscountRules((prev) => prev.filter((rule) => rule.id !== id));
    setDiscountApproval(null);
  }, []);

  const clearDiscountRules = useCallback(() => {
    setDiscountRules([]);
    setDiscountType(null);
    setDiscountValue("");
    setDiscountApproval(null);
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
  
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const applyRules = useCallback((rules: DiscountRule[]) => {
    let totalDiscount = 0;
    for (const rule of rules) totalDiscount = round2(totalDiscount + round2(computeRuleDiscount(rule, Math.max(0, subtotal - totalDiscount))));
    return totalDiscount;
  }, [computeRuleDiscount, subtotal]);

  // Same order and rules as the server (orders.ts createOrder): best single auto
  // promotion, then the coupon, then manual discounts; each capped by what's left.
  const appliedPromotion = useMemo(() => {
    if (skipPromotions) return null;
    let best: DiscountRule | null = null;
    let bestAmount = 0;
    for (const rule of autoPromotions) {
      const isPercent = rule.type === "ORDER_PERCENT" || rule.type === "CATEGORY_PERCENT";
      if (rule.type !== "BUY_X_GET_Y" && (!(Number(rule.value) > 0) || (isPercent && Number(rule.value) > 100))) continue;
      const amount = applyRules([rule]);
      if (amount > bestAmount) { best = rule; bestAmount = amount; }
    }
    return best;
  }, [autoPromotions, skipPromotions, applyRules]);

  const couponBelowMinSpend = Boolean(appliedCoupon?.minSpend && subtotal < appliedCoupon.minSpend);
  const couponRule = useMemo<DiscountRule | null>(() => {
    if (!appliedCoupon || couponBelowMinSpend || !(appliedCoupon.value > 0)) return null;
    const isPercent = appliedCoupon.type.toUpperCase().includes("PERCENT");
    if (isPercent && appliedCoupon.value > 100) return null;
    return { id: `COUPON-${appliedCoupon.code}`, label: `คูปอง ${appliedCoupon.code}`, type: isPercent ? "ORDER_PERCENT" : "ORDER_FIXED", value: appliedCoupon.value };
  }, [appliedCoupon, couponBelowMinSpend]);

  const manualRules = useMemo<DiscountRule[]>(() => {
    if (discountRules.length) return discountRules;
    const val = Number(discountValue);
    if (discountType === "PERCENT" && val > 0 && val <= 100) return [{ id: "legacy", label: `ลดทั้งบิล ${val}%`, type: "ORDER_PERCENT", value: val }];
    if (discountType === "FIXED" && val > 0) return [{ id: "legacy", label: `ลดทั้งบิล ${val} บาท`, type: "ORDER_FIXED", value: val }];
    return [];
  }, [discountRules, discountType, discountValue]);

  const discountAmount = useMemo(
    () => applyRules([...(appliedPromotion ? [appliedPromotion] : []), ...(couponRule ? [couponRule] : []), ...manualRules]),
    [applyRules, appliedPromotion, couponRule, manualRules]
  );

  const canApproveOwnDiscount = user?.role === "admin" || user?.role === "manager";
  const needsDiscountApproval = !canApproveOwnDiscount && !discountApproval && subtotal > 0 && manualRules.length > 0
    && applyRules(manualRules) >= subtotal * MANUAL_DISCOUNT_APPROVAL_RATIO;

  const approveDiscount = useCallback(async (pin: string) => {
    if (!activeBranch) throw new Error("เลือกสาขาก่อน");
    const approval = await requestDiscountApproval(activeBranch.id, pin);
    setDiscountApproval(approval);
    checkoutKeyRef.current = null;
  }, [activeBranch]);
  const clearDiscountApproval = useCallback(() => setDiscountApproval(null), []);

  const total = useMemo(() => {
    const pointsDiscount = Math.min(Number(pointsToUse) || 0, Math.max(0, subtotal - discountAmount));
    return Math.round(Math.max(0, subtotal - discountAmount - pointsDiscount) * 100) / 100;
  }, [subtotal, discountAmount, pointsToUse]);

  const applyCoupon = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error("กรุณาใส่โค้ดคูปอง");
      return;
    }
    try {
      const coupon = await validateCoupon(trimmed);
      setAppliedCoupon(coupon);
      toast.success(`ใช้คูปอง ${coupon.code} แล้ว`);
    } catch (e) {
      setAppliedCoupon(null);
      toast.error((e as Error).message);
    }
  }, [toast]);

  const removeCoupon = useCallback(() => setAppliedCoupon(null), []);

  const holdCart = useCallback((label?: string) => {
    if (cart.length === 0) {
      toast.error("ไม่มีรายการให้พัก");
      return false;
    }
    const timeLabel = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const bill: HeldBill = {
      id: makeId(),
      label: label?.trim() || `บิลพัก ${timeLabel}`,
      branchId: activeBranch?.id ?? null,
      createdAt: new Date().toISOString(),
      itemCount: cart.reduce((sum, item) => sum + item.qty, 0),
      total,
      cart,
      discountType,
      discountValue,
      discountRules,
      pointsToUse,
      selectedMember,
      appliedCoupon,
      orderNote
    };
    setHeldBills((prev) => [bill, ...prev]);
    clearCart();
    toast.success("พักบิลแล้ว");
    return true;
  }, [cart, total, activeBranch, discountType, discountValue, discountRules, pointsToUse, selectedMember, appliedCoupon, orderNote, clearCart, toast]);

  const restoreHeldBill = useCallback((id: string) => {
    if (cart.length > 0) {
      toast.error("เคลียร์หรือพักตะกร้าปัจจุบันก่อนเรียกบิลที่พักไว้");
      return;
    }
    const bill = heldBills.find((b) => b.id === id);
    if (!bill || bill.branchId !== activeBranch?.id) return;
    checkoutKeyRef.current = null;
    setCart(bill.cart);
    setOrderNote(bill.orderNote || "");
    setSelectedMember(bill.selectedMember || null);
    setAppliedCoupon(bill.appliedCoupon || null);
    setDiscountType(bill.discountType);
    setDiscountValue(bill.discountValue);
    setDiscountRules(bill.discountRules);
    setPointsToUse(bill.pointsToUse);
    setScanFeedback({ tone: "idle", message: "เรียกบิลที่พักไว้แล้ว" });
    setHeldBills((prev) => prev.filter((b) => b.id !== id));
  }, [cart, heldBills, activeBranch?.id, toast]);

  const removeHeldBill = useCallback((id: string) => {
    setHeldBills((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const visibleHeldBills = useMemo(
    () => heldBills.filter((b) => b.branchId === (activeBranch?.id ?? null)),
    [heldBills, activeBranch?.id]
  );

  const checkout = useCallback(async (paymentMethod: PaymentMethod, customerId: number | null, usablePoints: number, paymentDetails?: { cashReceived?: number; paymentConfirmed?: boolean; referenceNo?: string }) => {
    if (cart.length === 0 || !activeBranch) throw new Error("ไม่สามารถชำระเงินได้");
    if (!activeShift || activeShift.branchId !== activeBranch.id) throw new Error("กรุณาเปิดกะของสาขานี้ก่อนขาย");
    const idempotencyKey = checkoutKeyRef.current ?? makeCheckoutKey();
    checkoutKeyRef.current = idempotencyKey;
    const draft = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
    sessionStorage.setItem(storageKey, JSON.stringify({ ...draft, checkoutKey: idempotencyKey }));
    try {
      let order: Order;
      const checkoutStartedAt = performance.now();
      try {
        order = await createOrder({
          items: cart.map((item, index) => index === 0 && orderNote ? { ...item, note: [item.note, orderNote].filter(Boolean).join(" · ") } : item),
          paymentMethod,
          paymentDetails,
          discountType,
          discountValue: Number(discountValue) || 0,
          discounts: discountRules,
          couponCode: appliedCoupon?.code,
          skipPromotions,
          discountApprovalToken: discountApproval?.token,
          branchId: activeBranch.id,
          customerId,
          loyaltyPointsToUse: usablePoints,
          userId: user?.id,
          shiftId: activeShift.id,
          idempotencyKey,
        });
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
      // Offline-queued orders are returned with a synthetic negative id.
      if (order.id < 0) {
        toast.success("บันทึกบิลออฟไลน์แล้ว ระบบจะ sync อัตโนมัติเมื่อเน็ตกลับมา");
      } else {
        toast.success("ชำระเงินสำเร็จ");
      }
      return order;
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  }, [cart, orderNote, storageKey, activeBranch, activeShift, user, discountType, discountValue, discountRules, appliedCoupon, skipPromotions, discountApproval, clearCart, refreshShift, toast]);

  return (
    <CartContext.Provider value={{
      cart, orderNote, setOrderNote, selectedMember, setSelectedMember, discountType, discountValue, discountRules, pointsToUse, scanFeedback,
      addItem, updateQty, setItemNote, removeItem, clearCart, setDiscountType, setDiscountValue, addDiscountRule, removeDiscountRule, clearDiscountRules, setPointsToUse, setScanFeedback, checkout,
      subtotal, discountAmount, total,
      heldBills: visibleHeldBills, holdCart, restoreHeldBill, removeHeldBill,
      appliedCoupon, applyCoupon, removeCoupon, autoPromotions,
      appliedPromotion, skipPromotions, setSkipPromotions: (skip: boolean) => { checkoutKeyRef.current = null; setSkipPromotions(skip); },
      couponBelowMinSpend, needsDiscountApproval, discountApproval, approveDiscount, clearDiscountApproval
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
