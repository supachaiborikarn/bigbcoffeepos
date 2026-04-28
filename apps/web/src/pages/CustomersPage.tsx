import { useEffect, useMemo, useState } from "react";
import { getCustomers } from "../api";
import type { Customer } from "../types";
import { Search, UserCircle, Star, Phone } from "lucide-react";

function formatMoney(v: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCustomers().then(setCustomers).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [customers, search]);

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>ลูกค้า</h1>
        <p className="muted" style={{ marginTop: 4 }}>จัดการสมาชิกและ Loyalty Program</p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        <div className="dash-kpi">
          <span className="dash-kpi__icon"><UserCircle size={18} style={{ color: "#3B82F6" }} /></span>
          <div>
            <p className="dash-kpi__label">สมาชิกทั้งหมด</p>
            <p className="dash-kpi__value">{customers.length}</p>
          </div>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi__icon" style={{ background: "#FEF3C7" }}><Star size={18} style={{ color: "#F59E0B" }} /></span>
          <div>
            <p className="dash-kpi__label">มีคะแนนสะสม</p>
            <p className="dash-kpi__value">{customers.filter((c) => c.points > 0).length}</p>
          </div>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi__icon" style={{ background: "#ECFDF5" }}><Star size={18} style={{ color: "#10B981" }} /></span>
          <div>
            <p className="dash-kpi__label">คะแนนรวม</p>
            <p className="dash-kpi__value">{customers.reduce((s, c) => s + c.points, 0).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Search & Table */}
      <section className="panel" style={{ flex: 1 }}>
        <div className="panel__header">
          <div><h2>รายชื่อสมาชิก</h2><p className="muted">ค้นหาด้วยชื่อหรือเบอร์โทร</p></div>
          <span className="badge">{filtered.length} คน</span>
        </div>
        <div style={{ padding: "0 24px 16px" }}>
          <div className="inventory-search" style={{ maxWidth: 400 }}>
            <Search size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ / เบอร์โทร" />
          </div>
        </div>

        <div style={{ overflow: "auto", padding: "0 24px 24px" }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center" }} className="muted">กำลังโหลดข้อมูล...</div>
          ) : filtered.length === 0 ? (
            <div className="empty">ไม่พบสมาชิก</div>
          ) : (
            <table className="inventory-table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>สมาชิก</th>
                  <th>เบอร์โทร</th>
                  <th>คะแนนสะสม</th>
                  <th>สมัครเมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--brand-subtle)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                          {c.name.charAt(0)}
                        </div>
                        <div>
                          <strong style={{ fontSize: 13 }}>{c.name}</strong>
                          <span className="muted" style={{ display: "block", fontSize: 11 }}>ID: {c.id}</span>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Phone size={12} style={{ color: "var(--text-muted)" }} />
                        {c.phone}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${c.points > 0 ? "badge--active" : ""}`}>
                        {c.points.toLocaleString()} คะแนน
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {new Date(c.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
