import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Shift, ShiftCloseResult } from "../types";
import {
  getCurrentShift,
  openShift as apiOpenShift,
  closeShift as apiCloseShift,
} from "../api";
import { useBranch } from "./BranchContext";
import { useAuth } from "./AuthContext";

type ShiftContextType = {
  activeShift: Shift | null;
  loading: boolean;
  /** false until this branch's shift has been looked up once — show "loading", not "no shift" */
  loaded: boolean;
  openShift: (openingCash: number) => Promise<void>;
  closeShift: (closingCash: number, details?: { cashCounts?: Record<string, number>; note?: string }) => Promise<ShiftCloseResult>;
  refreshShift: () => Promise<void>;
};

const ShiftContext = createContext<ShiftContextType | null>(null);

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { activeBranch } = useBranch();
  const { user } = useAuth();
  const branchId = activeBranch?.id;
  const scope = branchId && user ? `${branchId}:${user.id}` : null;
  const [shiftState, setShiftState] = useState<{ scope: string; shift: Shift | null } | null>(null);
  const activeShift = shiftState?.scope === scope ? shiftState.shift : null;
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requestVersion = useRef(0);
  const mutation = useRef<{ scope: string; version: number } | null>(null);

  // Keeps showing the current shift while it re-checks (e.g. after each sale) and
  // keeps it if the check fails, so the POS never flashes "ยังไม่ได้เปิดกะ" or locks
  // the pay button because of a network hiccup. Only a branch switch clears it.
  const refreshShift = useCallback(async () => {
    if (!branchId || !scope || mutation.current?.scope === scope) return;
    const version = ++requestVersion.current;
    const current = () => scopeRef.current === scope && requestVersion.current === version;
    setLoading(true);
    try {
      const shift = await getCurrentShift(branchId);
      if (current()) setShiftState({ scope, shift });
    } catch {
      /* keep what we had; the next refresh will catch up */
    } finally {
      if (current()) {
        setLoading(false);
        setLoadedFor(scope);
      }
    }
  }, [branchId, scope]);

  useEffect(() => {
    setShiftState(null);
    setLoadedFor(null);
    setLoading(false);
    void refreshShift();
    return () => { requestVersion.current += 1; };
  }, [refreshShift]);

  useEffect(() => {
    const recheck = () => { if (document.visibilityState === "visible") void refreshShift(); };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [refreshShift]);

  const openShift = useCallback(async (openingCash: number) => {
    if (!branchId || !scope) throw new Error("เลือกสาขาก่อน");
    if (mutation.current?.scope === scope) throw new Error("กำลังบันทึกกะ กรุณารอสักครู่");
    const operation = { scope, version: ++requestVersion.current };
    mutation.current = operation;
    const current = () => scopeRef.current === scope && requestVersion.current === operation.version;
    setLoading(true);
    try {
      const shift = await apiOpenShift({ branchId, userId: user?.id, openingCash });
      if (current()) {
        setShiftState({ scope, shift });
        setLoadedFor(scope);
      }
    } finally {
      if (mutation.current === operation) mutation.current = null;
      if (current()) setLoading(false);
    }
  }, [branchId, scope, user?.id]);

  const closeShift = useCallback(async (closingCash: number, details?: { cashCounts?: Record<string, number>; note?: string }): Promise<ShiftCloseResult> => {
    if (!activeShift || !scope) throw new Error("ไม่มีกะที่เปิดอยู่");
    if (mutation.current?.scope === scope) throw new Error("กำลังบันทึกกะ กรุณารอสักครู่");
    const operation = { scope, version: ++requestVersion.current };
    mutation.current = operation;
    const current = () => scopeRef.current === scope && requestVersion.current === operation.version;
    setLoading(true);
    try {
      const closed = await apiCloseShift(activeShift.id, closingCash, details);
      if (closed.shift.branchId !== activeShift.branchId) throw new Error("ผลปิดกะไม่ตรงกับสาขานี้ กรุณาตรวจสอบกะแล้วลองอีกครั้ง");
      if (current()) {
        setShiftState({ scope, shift: null });
        setLoadedFor(scope);
      }
      return closed;
    } finally {
      if (mutation.current === operation) mutation.current = null;
      if (current()) setLoading(false);
    }
  }, [activeShift, scope]);

  return (
    <ShiftContext.Provider value={{ activeShift, loading, loaded: scope !== null && loadedFor === scope, openShift, closeShift, refreshShift }}>
      {children}
    </ShiftContext.Provider>
  );
}

export function useShift() {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error("useShift must be used within ShiftProvider");
  return ctx;
}
