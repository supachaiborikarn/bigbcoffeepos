import { useEffect, useState } from "react";
import { getUsers, getBranches, addUser, updateUser, deleteUser } from "../api";
import type { User, Branch } from "../types";
import { useToast } from "../contexts/ToastContext";
import { Plus, Pencil, Trash2, X, Check, UserIcon } from "lucide-react";

export default function StaffPage() {
  const [staffList, setStaffList] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const toast = useToast();

  const [formData, setFormData] = useState({
    id: 0,
    name: "",
    pin: "",
    role: "cashier",
    branchId: "" as string | number,
    active: true
  });

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [usersData, branchesData] = await Promise.all([getUsers(), getBranches()]);
      setStaffList(usersData);
      setBranches(branchesData);
    } catch (err) {
      toast.error("โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const openAddModal = () => {
    setFormData({ id: 0, name: "", pin: "", role: "cashier", branchId: "", active: true });
    setShowModal(true);
  };

  const openEditModal = (u: User) => {
    setFormData({
      id: u.id,
      name: u.name,
      pin: "", // do not show current PIN
      role: u.role,
      branchId: u.branchId || "",
      active: u.active ?? true
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return toast.error("กรุณากรอกชื่อพนักงาน");
    if (formData.id === 0 && (!formData.pin || formData.pin.length !== 4)) {
      return toast.error("กรุณากรอก PIN 4 หลัก");
    }
    if (formData.id > 0 && formData.pin && formData.pin.length !== 4) {
      return toast.error("PIN ต้องเป็นตัวเลข 4 หลัก");
    }

    try {
      const payload: any = {
        name: formData.name,
        role: formData.role,
        branchId: formData.branchId ? Number(formData.branchId) : null,
        active: formData.active
      };
      if (formData.pin) payload.pin = formData.pin;

      if (formData.id > 0) {
        await updateUser(formData.id, payload);
        toast.success("อัปเดตข้อมูลพนักงานสำเร็จ");
      } else {
        await addUser(payload as any);
        toast.success("เพิ่มพนักงานสำเร็จ");
      }
      setShowModal(false);
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`คุณต้องการลบพนักงาน "${name}" ใช่หรือไม่?`)) return;
    try {
      await deleteUser(id);
      toast.success("ลบพนักงานสำเร็จ");
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || "ลบข้อมูลไม่สำเร็จ");
    }
  };

  const getRoleLabel = (role: string) => {
    if (role === 'admin') return 'ผู้ดูแลระบบ (Owner)';
    if (role === 'manager') return 'ผู้จัดการร้าน (Cafe Manager)';
    return 'บาริสต้า / แคชเชียร์';
  };

  return (
    <main className="app__grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px", maxWidth: 1000, margin: "0 auto" }}>
      <section className="panel" style={{ overflow: "hidden" }}>
        <div className="panel__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2>ทีมงานบาริสต้า & พนักงาน</h2>
            <p className="muted">จัดการสิทธิ์พนักงานร้านกาแฟแต่ละสาขา</p>
          </div>
          <button className="btn btn--primary" onClick={openAddModal} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Plus size={18} /> เพิ่มพนักงาน
          </button>
        </div>
        
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>กำลังโหลดข้อมูล...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 14 }}>
                  <th style={{ padding: "16px 24px", fontWeight: 500 }}>พนักงาน</th>
                  <th style={{ padding: "16px 24px", fontWeight: 500 }}>ตำแหน่ง</th>
                  <th style={{ padding: "16px 24px", fontWeight: 500 }}>สาขาประจำ</th>
                  <th style={{ padding: "16px 24px", fontWeight: 500 }}>สถานะ</th>
                  <th style={{ padding: "16px 24px", fontWeight: 500, textAlign: "right" }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map(user => (
                  <tr key={user.id} style={{ borderBottom: "1px solid var(--border)", opacity: user.active !== false ? 1 : 0.5 }}>
                    <td style={{ padding: "16px 24px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--bg-alt)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)" }}>
                          <UserIcon size={20} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{user.name}</div>
                          <div className="muted" style={{ fontSize: 12 }}>ID: {user.id}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "16px 24px" }}>
                      <span className={`badge ${user.role === 'admin' ? 'badge--active' : ''}`}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td style={{ padding: "16px 24px", color: "var(--text-muted)" }}>
                      {user.branch?.name || "ไม่ระบุสาขา"}
                    </td>
                    <td style={{ padding: "16px 24px" }}>
                      {user.active !== false ? (
                        <span style={{ color: "var(--success)", display: "flex", alignItems: "center", gap: 4, fontSize: 14 }}><Check size={16} /> ใช้งานปกติ</span>
                      ) : (
                        <span style={{ color: "var(--danger)", fontSize: 14 }}>ระงับการใช้งาน</span>
                      )}
                    </td>
                    <td style={{ padding: "16px 24px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="btn btn--outline" onClick={() => openEditModal(user)} style={{ padding: 8 }}>
                          <Pencil size={16} />
                        </button>
                        <button className="btn btn--outline" onClick={() => handleDelete(user.id, user.name)} style={{ padding: 8, color: "var(--danger)", borderColor: "var(--danger-light)" }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {staffList.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>ไม่มีข้อมูลพนักงาน</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* STAFF MODAL */}
      {showModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div className="panel" style={{ width: 480, maxWidth: "90vw", animation: "slideUp 0.2s ease-out" }}>
            <div className="panel__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{formData.id > 0 ? "แก้ไขข้อมูลพนักงาน" : "เพิ่มพนักงานใหม่"}</h3>
              <button className="btn" onClick={() => setShowModal(false)} style={{ padding: 4, border: "none", background: "none" }}><X size={24} /></button>
            </div>
            <form onSubmit={handleSave} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>ชื่อพนักงาน</label>
                <input 
                  type="text" 
                  className="input" 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  placeholder="เช่น สมชาย ใจดี"
                  required 
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                  PIN เข้าสู่ระบบ (4 หลัก)
                  {formData.id > 0 && <span className="muted" style={{ fontWeight: "normal", marginLeft: 8 }}>(ปล่อยว่างถ้าไม่ต้องการเปลี่ยน)</span>}
                </label>
                <input 
                  type="password" 
                  className="input" 
                  maxLength={4}
                  value={formData.pin} 
                  onChange={e => setFormData({...formData, pin: e.target.value.replace(/\D/g, '')})} 
                  placeholder="เช่น 1234"
                  required={formData.id === 0}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>ตำแหน่ง / สิทธิ์การใช้งาน</label>
                <select className="input" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                  <option value="cashier">บาริสต้า / แคชเชียร์ (ขายหน้าร้าน)</option>
                  <option value="manager">ผู้จัดการร้าน (ดูรายงาน, จัดการสต็อก)</option>
                  <option value="admin">ผู้ดูแลระบบ (ทุกอย่าง)</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>สาขาประจำ (ถ้ามี)</label>
                <select className="input" value={formData.branchId} onChange={e => setFormData({...formData, branchId: e.target.value})}>
                  <option value="">-- ไม่ระบุ (เห็นทุกสาขา) --</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              {formData.id > 0 && (
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 8 }}>
                    <input type="checkbox" checked={formData.active} onChange={e => setFormData({...formData, active: e.target.checked})} style={{ width: 20, height: 20 }} />
                    <span style={{ fontWeight: 500 }}>สถานะเปิดใช้งาน</span>
                  </label>
                </div>
              )}
              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                <button type="button" className="btn btn--outline" onClick={() => setShowModal(false)} style={{ flex: 1 }}>ยกเลิก</button>
                <button type="submit" className="btn btn--primary" style={{ flex: 1 }}>บันทึกข้อมูล</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
