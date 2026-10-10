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
  const { token, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const accountKey = `${user?.id}:${user?.role}:${user?.branchId}`;

  useEffect(() => {
    if (!token) {
      setBranches([]);
      setActiveBranchId(null);
      setLoadedFor(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getBranches().then((items) => {
      if (cancelled) return;
      const allowed = items.filter((b) => b.active && (user?.role === "admin" || b.id === user?.branchId));
      setBranches(allowed);
      if (allowed.length === 1) localStorage.setItem(`${BRANCH_KEY}:${user?.id}`, String(allowed[0].id));
      const savedId = Number(localStorage.getItem(`${BRANCH_KEY}:${user?.id}`));
      setActiveBranchId(allowed.length === 1 ? allowed[0].id : allowed.some((b) => b.id === savedId) ? savedId : null);
      setLoadedFor(accountKey);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setBranches([]);
      setActiveBranchId(null);
      setLoadedFor(accountKey);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [token, user?.id, user?.role, user?.branchId, accountKey]);

  const setBranchId = useCallback((id: number) => {
    if (!branches.some((b) => b.id === id)) return;
    setActiveBranchId(id);
    localStorage.setItem(`${BRANCH_KEY}:${user?.id}`, String(id));
  }, [branches, user?.id]);

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  return (
    <BranchContext.Provider value={{ branches, activeBranch, setBranchId, loading: loading || Boolean(token && loadedFor !== accountKey) }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
