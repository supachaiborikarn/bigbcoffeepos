import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "../types";
import { loginWithPin as apiLoginWithPin } from "../api";

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
    if (savedToken && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
        setToken(savedToken);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    }
    setLoading(false);
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
