import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";

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
    <div className="page-center">
      <div className="panel login-card">
        <div className="brand__mark" style={{ width: 72, height: 72, fontSize: 24, margin: "0 auto 16px" }}>BB</div>
        <h1 style={{ fontSize: 24, marginBottom: 4, textAlign: "center" }}>Big B Coffee</h1>
        <p className="muted" style={{ marginBottom: 24, textAlign: "center" }}>กรุณาใส่ PIN เพื่อเข้าสู่ระบบ</p>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="PIN 4 หลัก"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          style={{ textAlign: "center", fontSize: 28, letterSpacing: "0.5em" }}
          autoFocus
        />
        {error && <p style={{ color: "#b5482b", marginTop: 8, textAlign: "center" }}>{error}</p>}
        <button
          className="btn btn--primary btn--full"
          style={{ marginTop: 16 }}
          onClick={handleSubmit}
          disabled={loading || pin.length < 4}
        >
          {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
      </div>
    </div>
  );
}
