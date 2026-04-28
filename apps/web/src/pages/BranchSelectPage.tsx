import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { Coffee, Store, ChevronRight, LogOut } from "lucide-react";

const ROLE_LABELS: Record<string, string> = { admin: "ผู้ดูแลระบบ", manager: "ผู้จัดการ", cashier: "แคชเชียร์" };

export default function BranchSelectPage() {
  const { user, logout } = useAuth();
  const { branches, activeBranch, setBranchId } = useBranch();

  if (!user) return <Navigate to="/login" replace />;
  if (activeBranch) return <Navigate to="/pos" replace />;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg-page)", padding: 20 }}>
      <div style={{ maxWidth: 480, width: "100%", animation: "slideUp 200ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "linear-gradient(135deg, var(--brand), var(--brand-hover))",
            color: "white", display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px", boxShadow: "0 4px 12px rgba(139,94,60,0.3)"
          }}>
            <Coffee size={24} />
          </div>
          <h1 style={{ marginBottom: 6, fontSize: 22 }}>เลือกสาขา</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            สวัสดี <strong>{user.name}</strong> ({ROLE_LABELS[user.role]}) — วันนี้เข้าสาขาไหน?
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {branches.map((b) => (
            <button
              key={b.id}
              onClick={() => setBranchId(b.id)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                padding: "18px 20px", background: "var(--bg-surface)", border: "1px solid var(--border)",
                borderRadius: 16, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                transition: "all 150ms cubic-bezier(0.16, 1, 0.3, 1)",
                boxShadow: "var(--shadow-card)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--brand)"; e.currentTarget.style.boxShadow = "var(--shadow-card-hover)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "var(--shadow-card)"; e.currentTarget.style.transform = "none"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: "var(--brand-subtle)",
                  color: "var(--brand)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {b.branchType === "coffee" ? <Coffee size={18} /> : <Store size={18} />}
                </div>
                <div>
                  <strong style={{ fontSize: 15, display: "block" }}>{b.name}</strong>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{b.location}</span>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            </button>
          ))}
        </div>

        <button className="btn btn--ghost" style={{ marginTop: 24, width: "100%", justifyContent: "center" }} onClick={logout}>
          <LogOut size={14} />
          ออกจากระบบ
        </button>
      </div>
    </div>
  );
}
