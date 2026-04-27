import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";

const ROLE_LABELS: Record<string, string> = { admin: "ผู้ดูแลระบบ", manager: "ผู้จัดการ", cashier: "แคชเชียร์" };

export default function BranchSelectPage() {
  const { user, logout } = useAuth();
  const { branches, activeBranch, setBranchId } = useBranch();

  if (!user) return <Navigate to="/login" replace />;
  if (activeBranch) return <Navigate to="/pos" replace />;

  return (
    <div className="page-center">
      <div style={{ maxWidth: 480, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div className="brand__mark" style={{ margin: "0 auto 16px", width: 56, height: 56, fontSize: 20 }}>BB</div>
          <h1 style={{ marginBottom: 4 }}>เลือกสาขา</h1>
          <p className="muted">สวัสดี {user.name} ({ROLE_LABELS[user.role]}) — วันนี้เข้าสาขาไหน?</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {branches.map((b) => (
            <button
              key={b.id}
              className="panel branch-card"
              onClick={() => setBranchId(b.id)}
            >
              <div>
                <strong style={{ fontSize: 16 }}>{b.name}</strong>
                <p className="muted" style={{ margin: "4px 0 0" }}>{b.location}</p>
              </div>
              <span className="badge">{b.branchType === "coffee" ? "☕ กาแฟ" : "🔧 บ่อถ่าย"}</span>
            </button>
          ))}
        </div>
        <button className="btn btn--ghost" style={{ marginTop: 24, width: "100%" }} onClick={logout}>
          ← ออกจากระบบ
        </button>
      </div>
    </div>
  );
}
