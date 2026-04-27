import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Shift } from "../types";
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
  openShift: (openingCash: number) => Promise<void>;
  closeShift: (closingCash: number) => Promise<Shift>;
  refreshShift: () => Promise<void>;
};

const ShiftContext = createContext<ShiftContextType | null>(null);

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { activeBranch } = useBranch();
  const { user } = useAuth();
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshShift = useCallback(async () => {
    if (!activeBranch) {
      setActiveShift(null);
      return;
    }
    setLoading(true);
    setActiveShift(null);
    try {
      const shift = await getCurrentShift(activeBranch.id);
      setActiveShift(shift);
    } catch {
      setActiveShift(null);
    } finally {
      setLoading(false);
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

  const closeShift = useCallback(async (closingCash: number): Promise<Shift> => {
    if (!activeShift) throw new Error("ไม่มีกะที่เปิดอยู่");
    setLoading(true);
    try {
      const closed = await apiCloseShift(activeShift.id, closingCash);
      setActiveShift(null);
      return closed;
    } finally {
      setLoading(false);
    }
  }, [activeShift]);

  return (
    <ShiftContext.Provider value={{ activeShift, loading, openShift, closeShift, refreshShift }}>
      {children}
    </ShiftContext.Provider>
  );
}

export function useShift() {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error("useShift must be used within ShiftProvider");
  return ctx;
}
