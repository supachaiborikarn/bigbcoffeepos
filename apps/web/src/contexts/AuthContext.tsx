import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "../types";
import { ApiError, getCurrentUser, loginWithPin as apiLoginWithPin } from "../api";

type AuthContextType = {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = "bb_pos_token";
const USER_KEY = "bb_pos_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* Restore session on mount */
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    let cancelled = false;
    if (savedToken && savedUser) {
      try {
        const restored = JSON.parse(savedUser) as User;
        if (!restored?.id || !["admin", "manager", "cashier"].includes(restored.role)) throw new Error("invalid saved session");
        setUser(restored);
        setToken(savedToken);
        setLoading(false);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setLoading(false);
        return;
      }
      getCurrentUser().then((current) => {
        if (cancelled || localStorage.getItem(TOKEN_KEY) !== savedToken) return;
        setUser(current);
        setToken(savedToken);
        localStorage.setItem(USER_KEY, JSON.stringify(current));
      }).catch((err) => {
        if (cancelled || localStorage.getItem(TOKEN_KEY) !== savedToken) return;
        // Only a real "token rejected" ends the session. A dropped connection or a
        // busy server must not log the cashier out mid-shift: keep the saved user.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setUser(null);
          setToken(null);
          return;
        }
        try { setUser(JSON.parse(savedUser)); setToken(savedToken); }
        catch { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
      }).finally(() => { if (!cancelled) setLoading(false); });
    } else setLoading(false);
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (pin: string): Promise<boolean> => {
    setError("");
    try {
      const data = await apiLoginWithPin(pin);
      setUser(data.user);
      setToken(data.token || "pin-session");
      localStorage.setItem(TOKEN_KEY, data.token || "pin-session");
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return true;
    } catch (err) {
      setError((err as Error).message || "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์");
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    Object.keys(localStorage).filter(key => key.startsWith("bbpos.print.job:")).forEach(key => localStorage.removeItem(key));
    setUser(null);
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
