import { useEffect, useMemo, useState } from "react";
import { getInventory, getSalesSummary, getShifts, getUsers } from "../api";
import { useBranch } from "../contexts/BranchContext";
import { useShift } from "../contexts/ShiftContext";
import { TrendingUp, ShoppingCart, Receipt, AlertTriangle, Users, Sparkles, ArrowUpRight, ArrowDownRight, Package } from "lucide-react";

type DashboardData = {
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
  topItems: { menuItemId: number; name: string; qty: number; revenue: number }[];
  daily: { date: string; orders: number; revenue: number }[];
};

type LowStockItem = { ingredientId: number; name: string; unit: string; stockQty: number; reorderLevel: number };
type Shift = { id: number; status: string; totalSales: number; totalOrders: number; cashSales: number; qrSales: number; cardSales: number; openedAt: string; closedAt: string | null };

function formatMoney(v: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function getWeekRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function getTodayRange() {
  const d = new Date().toISOString().slice(0, 10);
  return { from: d, to: d };
}

export default function DashboardPage({ branchId }: { branchId: number | null }) {
  const { activeBranch } = useBranch();
  const { activeShift } = useShift();
  const [summary, setSummary] = useState<DashboardData | null>(null);
  const [todaySummary, setTodaySummary] = useState<DashboardData | null>(null);
  const [inventory, setInventory] = useState<LowStockItem[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staffCount, setStaffCount] = useState(0);
  const range = useMemo(getWeekRange, []);
  const todayRange = useMemo(getTodayRange, []);
  const resolvedBranchId = branchId ?? activeBranch?.id ?? null;

  useEffect(() => {
    getSalesSummary({ from: range.from, to: range.to, branchId: resolvedBranchId ?? undefined })
      .then(setSummary).catch(() => setSummary(null));
    getSalesSummary({ from: todayRange.from, to: todayRange.to, branchId: resolvedBranchId ?? undefined })
      .then(setTodaySummary).catch(() => setTodaySummary(null));
    getUsers().then((users) => setStaffCount(users.filter((u) => u.active !== false).length)).catch(() => {});
    if (resolvedBranchId) {
      getInventory(resolvedBranchId)
        .then((items) => setInventory(items.filter((i) => i.stockQty <= i.reorderLevel)))
        .catch(() => setInventory([]));
      getShifts(resolvedBranchId)
        .then((items) => setShifts(items.slice(0, 5)))
        .catch(() => setShifts([]));
    }
  }, [resolvedBranchId, range, todayRange]);

  const maxRevenue = useMemo(() => Math.max(1, ...(summary?.daily.map((d) => d.revenue) ?? [1])), [summary]);
  const todayStr = new Date().toISOString().slice(0, 10);

  // Calculate yesterday comparison
  const yesterdayData = summary?.daily.find((d) => {
    const yd = new Date(); yd.setDate(yd.getDate() - 1);
    return d.date === yd.toISOString().slice(0, 10);
  });
  const todayRevenue = todaySummary?.totalRevenue ?? 0;
  const yesterdayRevenue = yesterdayData?.revenue ?? 0;
  const revChange = yesterdayRevenue > 0 ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100) : 0;

  const kpis = [
    { label: "ยอดขายวันนี้", value: formatMoney(todayRevenue), icon: TrendingUp, change: revChange, color: "#10B981" },
    { label: "ออเดอร์วันนี้", value: String(todaySummary?.totalOrders ?? 0), icon: ShoppingCart, color: "#3B82F6" },
    { label: "เฉลี่ย/บิล", value: formatMoney(todaySummary?.averageTicket ?? 0), icon: Receipt, color: "#8B5CF6" },
    { label: "สต็อกต่ำ", value: String(inventory.length), icon: AlertTriangle, color: inventory.length > 0 ? "#F59E0B" : "#10B981" },
    { label: "พนักงาน", value: String(staffCount), icon: Users, color: "#6366F1" },
  ];

  // AI Insight cards
  const insights = [
    revChange > 0 && { icon: "📈", text: `รายได้ +${revChange}% เทียบกับเมื่อวาน`, type: "success" as const },
    inventory.length > 0 && { icon: "⚠️", text: `${inventory.length} รายการสต็อกใกล้หมด`, type: "warning" as const },
    todaySummary && todaySummary.topItems.length > 0 && { icon: "🏆", text: `${todaySummary.topItems[0]?.name} ขายดีสุดวันนี้`, type: "info" as const },
    activeShift && { icon: "🟢", text: `กะเปิดอยู่ · ยอดขาย ${formatMoney(activeShift.totalSales)}`, type: "success" as const },
  ].filter(Boolean) as { icon: string; text: string; type: "success" | "warning" | "info" }[];

  return (
    <main className="dashboard-grid">
      {/* Page Header */}
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>แดชบอร์ด</h1>
        <p className="muted" style={{ marginTop: 4 }}>{activeBranch?.name} · {new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>

      {/* KPI Cards */}
      <section className="dash-kpi-row">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="dash-kpi">
              <span className="dash-kpi__icon" style={{ background: `${kpi.color}12` }}>
                <Icon size={18} style={{ color: kpi.color }} />
              </span>
              <div>
                <p className="dash-kpi__label">{kpi.label}</p>
                <p className="dash-kpi__value">{summary || todaySummary ? kpi.value : "—"}</p>
                {kpi.change !== undefined && kpi.change !== 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: kpi.change > 0 ? "#10B981" : "#EF4444", display: "flex", alignItems: "center", gap: 2, marginTop: 2 }}>
                    {kpi.change > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {kpi.change > 0 ? "+" : ""}{kpi.change}% vs เมื่อวาน
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* AI Insights */}
      {insights.length > 0 && (
        <section style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {insights.map((ins, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
              borderRadius: 12, fontSize: 13, fontWeight: 500,
              background: ins.type === "success" ? "var(--success-bg)" : ins.type === "warning" ? "var(--warning-bg)" : "var(--info-bg)",
              color: ins.type === "success" ? "#047857" : ins.type === "warning" ? "#92400E" : "#1D4ED8",
              border: `1px solid ${ins.type === "success" ? "var(--success-border)" : ins.type === "warning" ? "var(--warning-border)" : "var(--info-border)"}`,
              animation: `slideUp 200ms ease ${i * 50}ms both`,
            }}>
              <Sparkles size={14} />
              <span>{ins.icon} {ins.text}</span>
            </div>
          ))}
        </section>
      )}

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }}>
        {/* 7-day Revenue Chart */}
        <section className="panel">
          <div className="panel__header">
            <div><h2>ยอดขายรายวัน</h2><p className="muted">{range.from} — {range.to}</p></div>
          </div>
          <div className="dash-chart">
            {summary?.daily.map((d) => (
              <div key={d.date} className={`dash-bar-col ${d.date === todayStr ? "dash-bar-col--today" : ""}`}>
                <span className="dash-bar-value">{formatMoney(d.revenue)}</span>
                <div className="dash-bar" style={{ height: `${Math.max(4, (d.revenue / maxRevenue) * 140)}px` }} />
                <span className="dash-bar-label">{new Date(d.date + "T00:00:00").toLocaleDateString("th-TH", { weekday: "short", day: "2-digit" })}</span>
                <span className="dash-bar-orders">{d.orders} บิล</span>
              </div>
            ))}
            {(!summary || summary.daily.length === 0) && <p className="muted" style={{ padding: 20, margin: "auto" }}>ยังไม่มียอดขายในช่วงนี้</p>}
          </div>
        </section>

        {/* Top Selling Items */}
        <section className="panel">
          <div className="panel__header">
            <div><h2>🏆 สินค้าขายดี</h2><p className="muted">Top 5 ตามยอดขาย</p></div>
          </div>
          <div className="dash-top-list">
            {summary?.topItems.map((item, idx) => (
              <div key={item.menuItemId} className="dash-top-row">
                <span className="dash-top-rank" style={idx === 0 ? { background: "var(--brand-subtle)", color: "var(--brand)" } : {}}>{idx + 1}</span>
                <div className="dash-top-info">
                  <strong>{item.name}</strong>
                  <span className="muted">{item.qty} รายการ</span>
                </div>
                <strong style={{ color: "var(--brand-hover)", fontSize: 14 }}>{formatMoney(item.revenue)}</strong>
              </div>
            ))}
            {summary && summary.topItems.length === 0 && <p className="muted" style={{ padding: 12 }}>ยังไม่มีข้อมูล</p>}
          </div>
        </section>
      </div>

      {/* Bottom Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Low Stock Alerts */}
        <section className="panel">
          <div className="panel__header">
            <div><h2><Package size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />สต็อกใกล้หมด</h2><p className="muted">ต่ำกว่าขั้นต่ำที่ตั้งไว้</p></div>
            {inventory.length > 0 && <span className="badge badge--warning">{inventory.length} รายการ</span>}
          </div>
          <div className="dash-stock-list">
            {inventory.map((item) => (
              <div key={item.ingredientId} className="inventory-row inventory-row--low">
                <div>
                  <strong style={{ fontSize: 13 }}>{item.name}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{item.stockQty} {item.unit} (ขั้นต่ำ {item.reorderLevel})</span>
                </div>
              </div>
            ))}
            {inventory.length === 0 && <p className="muted" style={{ padding: 12 }}>สต็อกปกติดี ✓</p>}
          </div>
        </section>

        {/* Recent Shifts */}
        <section className="panel">
          <div className="panel__header">
            <div><h2>กะล่าสุด</h2><p className="muted">5 กะล่าสุด</p></div>
          </div>
          <div className="dash-shifts">
            {shifts.map((s) => (
              <div key={s.id} className="dash-shift-row">
                <div>
                  <strong>กะ #{s.id}</strong>
                  <span className={`badge ${s.status === "OPEN" ? "badge--active" : ""}`} style={{ marginLeft: 8, marginTop: 0 }}>{s.status === "OPEN" ? "เปิดอยู่" : "ปิดแล้ว"}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong style={{ fontSize: 14 }}>{formatMoney(s.totalSales)}</strong>
                  <span className="muted" style={{ display: "block", fontSize: 11 }}>{s.totalOrders} บิล</span>
                </div>
              </div>
            ))}
            {shifts.length === 0 && <p className="muted" style={{ padding: 12 }}>ยังไม่มีประวัติกะ</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
