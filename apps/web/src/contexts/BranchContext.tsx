import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Branch } from "../types";
import { ApiError, getBranches } from "../api";
import { useAuth } from "./AuthContext";

type BranchContextType = {
  branches: Branch[];
  activeBranch: Branch | null;
  setBranchId: (id: number) => void;
  loading: boolean;
  /** set when the branch list couldn't be loaded (and no cached copy) — not "you have no branch" */
  error: string | null;
  reload: () => void;
};

const BranchContext = createContext<BranchContextType | null>(null);

const BRANCH_KEY = "bb_pos_branch_id";
const BRANCH_CACHE_KEY = "bb_pos_branches_cache";
const RETRY_DELAYS = [800, 2000, 4000];

/** Branch list with retries for network hiccups; falls back to the last list this browser saw. */
async function loadBranchesResilient(userId: number | undefined): Promise<{ items: Branch[]; cached: boolean }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const items = await getBranches();
      try { localStorage.setItem(`${BRANCH_CACHE_KEY}:${userId}`, JSON.stringify(items)); } catch { /* cache is optional */ }
      return { items, cached: false };
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) throw err;
      if (attempt < RETRY_DELAYS.length) { await new Promise((r) => window.setTimeout(r, RETRY_DELAYS[attempt])); continue; }
      try {
        const cached = JSON.parse(localStorage.getItem(`${BRANCH_CACHE_KEY}:${userId}`) || "null");
        if (Array.isArray(cached) && cached.length) return { items: cached, cached: true };
      } catch { /* fall through */ }
      throw err;
    }
  }
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
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

    setError(null);
    loadBranchesResilient(user?.id).then(({ items }) => {
      if (cancelled) return;
      const allowed = items.filter((b) => b.active && (user?.role === "admin" || b.id === user?.branchId));
      setBranches(allowed);
      if (allowed.length === 1) localStorage.setItem(`${BRANCH_KEY}:${user?.id}`, String(allowed[0].id));
      const savedId = Number(localStorage.getItem(`${BRANCH_KEY}:${user?.id}`));
      setActiveBranchId(allowed.length === 1 ? allowed[0].id : allowed.some((b) => b.id === savedId) ? savedId : null);
      setLoadedFor(accountKey);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setBranches([]);
      setActiveBranchId(null);
      setError((err as Error).message || "โหลดรายการสาขาไม่สำเร็จ");
      setLoadedFor(accountKey);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [token, user?.id, user?.role, user?.branchId, accountKey, attempt]);

  const setBranchId = useCallback((id: number) => {
    if (!branches.some((b) => b.id === id)) return;
    setActiveBranchId(id);
    localStorage.setItem(`${BRANCH_KEY}:${user?.id}`, String(id));
  }, [branches, user?.id]);

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  return (
    <BranchContext.Provider value={{ branches, activeBranch, setBranchId, loading: loading || Boolean(token && loadedFor !== accountKey), error, reload }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
