import { useEffect, useState } from "react";
import { getUsers } from "../api";
import type { User } from "../types";
import { useToast } from "../contexts/ToastContext";

export default function StaffPage() {
  const [staffList, setStaffList] = useState<User[]>([]);
  const toast = useToast();

  useEffect(() => {
    getUsers()
      .then(setStaffList)
      .catch(() => toast.error("โหลดข้อมูลพนักงานไม่สำเร็จ"));
  }, [toast]);

  return (
    <main className="app__grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>บุคลากร</h2>
            <p className="muted">จัดการพนักงานและรหัสผ่าน (PIN)</p>
          </div>
        </div>
        <div style={{ padding: "0 24px 24px" }}>
          {staffList.map(user => (
            <div key={user.id} style={{ display: "flex", justifyContent: "space-between", padding: "16px 0", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "var(--bg-alt)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>
                  {user.name.charAt(0)}
                </div>
                <div>
                  <strong>{user.name}</strong>
                  <div className="muted" style={{ fontSize: "12px" }}>ID: {user.id}</div>
                </div>
              </div>
              <div>
                <span className={`badge ${user.role === 'admin' ? 'badge--active' : ''}`}>
                  {user.role === 'admin' ? 'ผู้ดูแลระบบ' : user.role === 'manager' ? 'ผู้จัดการ' : 'แคชเชียร์'}
                </span>
              </div>
            </div>
          ))}
          {staffList.length === 0 && <div className="empty">ไม่มีข้อมูลพนักงาน</div>}
        </div>
      </section>
    </main>
  );
}
