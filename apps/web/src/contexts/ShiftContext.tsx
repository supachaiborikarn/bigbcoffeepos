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
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const branchRef = useRef<number | null>(null);

  // Keeps showing the current shift while it re-checks (e.g. after each sale) and
  // keeps it if the check fails, so the POS never flashes "ยังไม่ได้เปิดกะ" or locks
  // the pay button because of a network hiccup. Only a branch switch clears it.
  const refreshShift = useCallback(async () => {
    if (!activeBranch) {
      setActiveShift(null);
      return;
    }
    if (branchRef.current !== activeBranch.id) {
      branchRef.current = activeBranch.id;
      setActiveShift(null);
      setLoadedFor(null);
    }
    setLoading(true);
    try {
      const shift = await getCurrentShift(activeBranch.id);
      if (branchRef.current === activeBranch.id) setActiveShift(shift);
    } catch {
      /* keep what we had; the next refresh will catch up */
    } finally {
      setLoading(false);
      setLoadedFor(activeBranch.id);
    }
  }, [activeBranch]);

  useEffect(() => {
    if (activeBranch && user) refreshShift();
    else setActiveShift(null);
  }, [activeBranch, user, refreshShift]);

  const openShift = useCallback(async (openingCash: number) => {
    if (!activeBranch) throw new Error("เลือกสาขาก่อน");
    setLoading(true);
    try {
      const shift = await apiOpenShift({ branchId: activeBranch.id, userId: user?.id, openingCash });
      setActiveShift(shift);
    } finally {
      setLoading(false);
    }
  }, [activeBranch, user]);

  const closeShift = useCallback(async (closingCash: number, details?: { cashCounts?: Record<string, number>; note?: string }): Promise<ShiftCloseResult> => {
    if (!activeShift) throw new Error("ไม่มีกะที่เปิดอยู่");
    setLoading(true);
    try {
      const closed = await apiCloseShift(activeShift.id, closingCash, details);
      setActiveShift(null);
      return closed;
    } finally {
      setLoading(false);
    }
  }, [activeShift]);

  return (
    <ShiftContext.Provider value={{ activeShift, loading, loaded: loadedFor === activeBranch?.id, openShift, closeShift, refreshShift }}>
      {children}
    </ShiftContext.Provider>
  );
}

export function useShift() {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error("useShift must be used within ShiftProvider");
  return ctx;
}
