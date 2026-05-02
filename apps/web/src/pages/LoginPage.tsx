import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import BrandLogo from "../components/BrandLogo";

export default function LoginPage() {
  const { user, login, error } = useAuth();
  const { setBranchId } = useBranch();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      if (user.branchId) {
        setBranchId(user.branchId);
        navigate("/pos", { replace: true });
      } else {
        navigate("/branch", { replace: true });
      }
    }
  }, [user, navigate, setBranchId]);

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    setLoading(true);
    await login(pin);
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg-page)", padding: 20 }}>
      <div style={{
        background: "var(--bg-surface)", borderRadius: 24, padding: "48px 40px",
        boxShadow: "var(--shadow-lg)", width: 400, maxWidth: "100%", textAlign: "center",
        animation: "scaleIn 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        border: "1px solid var(--border)",
      }}>
        <BrandLogo style={{ width: 88, height: 88, objectFit: "contain", margin: "0 auto 16px", display: "block" }} />

        <h1 style={{ fontSize: 24, marginBottom: 4, fontWeight: 700, letterSpacing: "-0.02em" }}>Big B Coffee</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 32 }}>กรุณาใส่ PIN เพื่อเข้าสู่ระบบ</p>

        <input
          className="input"
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="● ● ● ●"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          style={{ textAlign: "center", fontSize: 28, letterSpacing: "0.5em", padding: "14px 16px", borderRadius: 12 }}
          autoFocus
        />

        {error && <p style={{ color: "var(--danger)", marginTop: 12, fontSize: 13, fontWeight: 500 }}>{error}</p>}

        <button
          className="btn btn--primary btn--full btn--lg"
          style={{ marginTop: 20 }}
          onClick={handleSubmit}
          disabled={loading || pin.length < 4}
        >
          {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>

        <p style={{ marginTop: 24, fontSize: 11, color: "var(--text-muted)" }}>Big B Coffee POS Platform</p>
      </div>
    </div>
  );
}
