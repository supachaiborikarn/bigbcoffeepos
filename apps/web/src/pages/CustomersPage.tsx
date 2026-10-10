import { useEffect, useMemo, useState } from "react";
import { Clock, Search, Star, Users, UserRoundCheck } from "lucide-react";
import { assignCustomerBranch, getCustomerInsights, getCustomers, getUnassignedCustomers, type UnassignedCustomer } from "../api";
import type { Customer, CustomerInsights } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";

const money = (value: number) => `฿${value.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "ยังไม่เคยซื้อ";

export default function CustomersPage() {
  const { user } = useAuth();
  const { activeBranch, branches } = useBranch();
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [insights, setInsights] = useState<CustomerInsights | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedCustomer[]>([]);
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [tab, setTab] = useState<"branch" | "unassigned">("branch");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getCustomers(), getCustomerInsights({ inactiveDays: 60, limit: 5 }), user?.role === "admin" ? getUnassignedCustomers() : Promise.resolve([])])
      .then(([items, summary, pending]) => {
        if (cancelled) return;
        setCustomers(items); setInsights(summary); setUnassigned(pending);
      }).catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeBranch?.id, user?.role]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (tab === "branch" ? customers : unassigned).filter((customer) => customer.name.toLowerCase().includes(query) || customer.phone.includes(query));
  }, [customers, unassigned, search, tab]);

  async function assign(customer: Customer) {
    const branchId = Number(assignments[customer.id]);
    if (!branchId || saving !== null) return;
    setSaving(customer.id);
    try {
      const updated = await assignCustomerBranch(customer.id, branchId);
      setUnassigned((rows) => rows.filter((row) => row.id !== customer.id));
      if (branchId === activeBranch?.id) setCustomers((rows) => [updated, ...rows]);
      toast.success(`ผูก ${customer.name} กับสาขาที่เลือกแล้ว`);
      getCustomerInsights({ inactiveDays: 60, limit: 5 }).then(setInsights).catch(() => {});
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(null); }
  }

  return <main className="studio-customers">
    <div className="studio-page-heading"><div><span className="studio-eyebrow">CUSTOMERS</span><h1>สมาชิกของร้าน</h1><p>{activeBranch?.name}</p></div><Users size={30} strokeWidth={1.4} /></div>
    <div className="studio-kpi-grid studio-customer-kpis">
      <div><span><Users size={14} /> สมาชิกในสาขา</span><strong>{customers.length.toLocaleString("th-TH")}</strong></div>
      <div><span><Star size={14} /> คะแนนสะสมรวม</span><strong>{customers.reduce((sum, customer) => sum + customer.points, 0).toLocaleString("th-TH")}</strong></div>
      <div><span>ยอดสมาชิก 30 วัน</span><strong>{money(insights?.summary.recentSpendTotal ?? 0)}</strong></div>
      <div><span><Clock size={14} /> ไม่กลับมา 60 วัน</span><strong>{insights?.summary.inactiveCustomers ?? 0}</strong></div>
    </div>
    <div className="studio-inventory-toolbar">
      <div className="studio-tabs"><button className={tab === "branch" ? "is-active" : ""} onClick={() => setTab("branch")}>สมาชิกสาขานี้</button>{user?.role === "admin" && <button className={tab === "unassigned" ? "is-active" : ""} onClick={() => setTab("unassigned")}>รอจัดสาขา ({unassigned.length})</button>}</div>
      <label className="studio-search"><Search size={18} /><input aria-label="ค้นหาสมาชิก" placeholder="ค้นหาชื่อ / เบอร์โทร" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>
    {error && <p className="studio-page-error" role="alert">โหลดข้อมูลไม่สำเร็จ: {error}</p>}
    {tab === "unassigned" && <p className="studio-catalog-help">รายชื่อเดิมที่ยังระบุสาขาไม่ได้ ให้ตรวจประวัติแล้วเลือกสาขาประจำของสมาชิก โดยประวัติการซื้อและแต้มเดิมยังอยู่ครบ</p>}
    <section className="studio-member-list" aria-label={tab === "branch" ? "สมาชิกสาขานี้" : "สมาชิกรอจัดสาขา"}>
      {loading ? <div className="empty">กำลังโหลดสมาชิก...</div> : filtered.map((customer) => {
        const history = unassigned.find((row) => row.id === customer.id)?.historicalBranchIds ?? [];
        return <article className="studio-member-row" key={customer.id}>
          <span className="studio-member-avatar" aria-hidden="true">{customer.name.charAt(0)}</span>
          <div className="studio-member-name"><strong>{customer.name}</strong><span>{customer.phone}</span>{tab === "unassigned" && <small>{history.length ? `เคยซื้อ: ${history.map((id) => branches.find((branch) => branch.id === id)?.name || `สาขา ${id}`).join(" · ")}` : "ยังไม่มีประวัติการซื้อที่ระบุสาขา"}</small>}</div>
          {tab === "branch" ? <><span className="studio-member-points"><Star size={13} /> {customer.points.toLocaleString("th-TH")} แต้ม</span><span className="studio-member-date">สมัคร {date(customer.createdAt)}</span></> : <div className="studio-member-assign">
            <select className="input" aria-label={`สาขาประจำ ${customer.name}`} value={assignments[customer.id] || ""} onChange={(event) => setAssignments((values) => ({ ...values, [customer.id]: event.target.value }))} disabled={saving !== null}><option value="">เลือกสาขาประจำ</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
            <button className="btn btn--primary" onClick={() => assign(customer)} disabled={!assignments[customer.id] || saving !== null}><UserRoundCheck size={16} />{saving === customer.id ? "กำลังบันทึก" : "ผูกสาขา"}</button>
          </div>}
        </article>;
      })}
      {!loading && !filtered.length && <div className="empty">{tab === "unassigned" && !search ? "ไม่มีสมาชิกรอจัดสาขา" : "ไม่พบสมาชิก"}</div>}
    </section>
    {tab === "branch" && insights && <div className="studio-customer-insights">
      <section><h2>ลูกค้าที่ซื้อประจำ</h2><p>เรียงตามยอดซื้อสะสมของสาขานี้ · เฉลี่ย {money(insights.summary.averageSpendPerCustomer)} ต่อคน</p>{insights.highValueCustomers.map((customer) => <div key={customer.id}><span><strong>{customer.name}</strong><small>{customer.totalOrders} บิล · ล่าสุด {date(customer.lastOrderAt)}</small></span><strong>{money(customer.totalSpend)}</strong></div>)}{!insights.highValueCustomers.length && <div className="empty">ยังไม่มีประวัติซื้อของสมาชิก</div>}</section>
      <section><h2>สมาชิกที่ห่างหาย</h2><p>ไม่มีรายการซื้อในช่วง {insights.summary.inactiveDays} วัน</p>{insights.inactiveCustomers.map((customer) => <div key={customer.id}><span><strong>{customer.name}</strong><small>{customer.phone} · ล่าสุด {date(customer.lastOrderAt)}</small></span><span>{customer.points} แต้ม</span></div>)}{!insights.inactiveCustomers.length && <div className="empty">ยังไม่มีสมาชิกในกลุ่มนี้</div>}</section>
    </div>}
  </main>;
}
