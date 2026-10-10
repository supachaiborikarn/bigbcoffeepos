import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Coffee, Wrench, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function LoginPage() {
  const { user, login, error } = useAuth();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (user) navigate("/branch", { replace: true }); }, [user, navigate]);
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pin.length !== 4 || loading) return;
    setLoading(true);
    await login(pin);
    setLoading(false);
  }
  return <main className="studio-login">
    <section className="studio-login-story" aria-label="ระบบจัดการร้าน"><div className="studio-login-brand"><span><Coffee size={24} /></span><strong>Big B<span>BUSINESS WORKSPACE</span></strong></div>
      <div className="studio-login-intro"><span className="studio-eyebrow">YOUR EVERYDAY WORKSPACE</span><h1>พร้อมสำหรับ<br />วันทำงานที่ดี<span>.</span></h1><p>ดูแลหน้าร้าน รับชำระเงิน และติดตามยอดขาย<br />จากพื้นที่ทำงานของสาขาคุณ</p><div className="studio-business-tags"><span><Coffee size={17} /> ร้านกาแฟ</span><span><Wrench size={17} /> บ่อถ่ายน้ำมัน</span></div></div>
      <div className="studio-login-footer"><ShieldCheck size={17} /><span>แต่ละสาขาเข้าถึงข้อมูลตามสิทธิ์พนักงาน</span></div>
    </section>
    <section className="studio-login-form"><form onSubmit={handleSubmit}>
      <span className="studio-login-lock"><LockKeyhole size={25} strokeWidth={1.5} /></span><span className="studio-eyebrow">WELCOME BACK</span><h2>เข้าสู่พื้นที่ทำงาน</h2><p>ใส่รหัสพนักงานเพื่อเริ่มใช้งานสาขาของคุณ</p>
      <label htmlFor="employee-pin">รหัส PIN 4 หลัก</label><input id="employee-pin" className="input" type="password" inputMode="numeric" maxLength={4} placeholder="● ● ● ●" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoFocus disabled={loading} />
      {error && <div role="alert" className="studio-login-error">{error}</div>}
      <button type="submit" className="btn btn--primary btn--full" disabled={loading || pin.length !== 4}>{loading ? "กำลังเข้าสู่ระบบ..." : <>เข้าสู่ระบบ <ArrowRight size={18} /></>}</button>
      <div className="studio-login-help"><LockKeyhole size={13} /><span>หากลืมรหัส ให้ติดต่อผู้ดูแลระบบของร้าน</span></div>
    </form></section>
  </main>;
}
