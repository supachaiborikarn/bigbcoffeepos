import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Branch } from "../types";
import { getBranches } from "../api";
import { useAuth } from "./AuthContext";

type BranchContextType = {
  branches: Branch[];
  activeBranch: Branch | null;
  setBranchId: (id: number) => void;
  loading: boolean;
};

const BranchContext = createContext<BranchContextType | null>(null);

const BRANCH_KEY = "bb_pos_branch_id";

export function BranchProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setBranches([]);
      setActiveBranchId(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getBranches().then((items) => {
      if (cancelled) return;
      setBranches(items);
      const savedId = localStorage.getItem(BRANCH_KEY);
      if (savedId) {
        const id = Number(savedId);
        if (items.some((b) => b.id === id)) setActiveBranchId(id);
        else setActiveBranchId(null);
      }
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setBranches([]);
      setActiveBranchId(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const setBranchId = useCallback((id: number) => {
    setActiveBranchId(id);
    localStorage.setItem(BRANCH_KEY, String(id));
  }, []);

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  return (
    <BranchContext.Provider value={{ branches, activeBranch, setBranchId, loading }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
