import { useEffect, useMemo, useState } from "react";
import { getInventory, getSalesSummary, getShifts } from "../api";
import { useBranch } from "../contexts/BranchContext";

type DashboardData = {
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
  topItems: { menuItemId: number; name: string; qty: number; revenue: number }[];
  daily: { date: string; orders: number; revenue: number }[];
};

type LowStockItem = {
  ingredientId: number;
  name: string;
  unit: string;
  stockQty: number;
  reorderLevel: number;
};

type Shift = {
  id: number;
  status: string;
  totalSales: number;
  totalOrders: number;
  cashSales: number;
  qrSales: number;
  cardSales: number;
  openedAt: string;
  closedAt: string | null;
};

function formatMoney(v: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function getWeekRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function DashboardPage({ branchId }: { branchId: number | null }) {
  const { activeBranch } = useBranch();
  const [summary, setSummary] = useState<DashboardData | null>(null);
  const [inventory, setInventory] = useState<LowStockItem[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const range = useMemo(getWeekRange, []);
  const resolvedBranchId = branchId ?? activeBranch?.id ?? null;

  useEffect(() => {
    getSalesSummary({ from: range.from, to: range.to, branchId: resolvedBranchId ?? undefined })
      .then(setSummary)
      .catch(() => setSummary(null));
    if (resolvedBranchId) {
      getInventory(resolvedBranchId)
        .then((items) => setInventory(items.filter((i) => i.stockQty <= i.reorderLevel)))
        .catch(() => setInventory([]));
      getShifts(resolvedBranchId)
        .then((items) => setShifts(items.slice(0, 5)))
        .catch(() => setShifts([]));
    } else {
      setInventory([]);
      setShifts([]);
    }
  }, [resolvedBranchId, range]);

  const maxRevenue = useMemo(() => Math.max(1, ...(summary?.daily.map(d => d.revenue) ?? [1])), [summary]);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <main className="dashboard-grid">
      {/* KPI Cards */}
      <section className="panel dash-kpi-row">
        <div className="dash-kpi">
          <span className="dash-kpi__icon">💰</span>
          <div>
            <p className="dash-kpi__label">ยอดขาย 7 วัน</p>
            <p className="dash-kpi__value">{summary ? formatMoney(summary.totalRevenue) : "—"}</p>
          </div>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi__icon">🧾</span>
          <div>
            <p className="dash-kpi__label">ออเดอร์ 7 วัน</p>
            <p className="dash-kpi__value">{summary?.totalOrders ?? "—"}</p>
          </div>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi__icon">📊</span>
          <div>
            <p className="dash-kpi__label">เฉลี่ย/บิล</p>
            <p className="dash-kpi__value">{summary ? formatMoney(summary.averageTicket) : "—"}</p>
          </div>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi__icon">⚠️</span>
          <div>
            <p className="dash-kpi__label">สต็อกต่ำ</p>
            <p className="dash-kpi__value">{inventory.length}</p>
          </div>
        </div>
      </section>

      {/* 7-day Chart */}
      <section className="panel">
        <div className="panel__header">
          <div><h2>ยอดขายรายวัน</h2><p className="muted">{range.from} — {range.to}</p></div>
        </div>
        <div className="dash-chart">
          {summary?.daily.map(d => (
            <div key={d.date} className={`dash-bar-col ${d.date === todayStr ? "dash-bar-col--today" : ""}`}>
              <span className="dash-bar-value">{formatMoney(d.revenue)}</span>
              <div className="dash-bar" style={{ height: `${Math.max(4, (d.revenue / maxRevenue) * 140)}px` }} />
              <span className="dash-bar-label">{new Date(d.date + "T00:00:00").toLocaleDateString("th-TH", { weekday: "short", day: "2-digit" })}</span>
              <span className="dash-bar-orders">{d.orders} บิล</span>
            </div>
          ))}
          {(!summary || summary.daily.length === 0) && <p className="muted" style={{ padding: 20 }}>ยังไม่มียอดขายในช่วงนี้</p>}
        </div>
      </section>

      {/* Top Items */}
      <section className="panel">
        <div className="panel__header">
          <div><h2>🏆 สินค้าขายดี</h2><p className="muted">Top 5 ตามยอดขาย</p></div>
        </div>
        <div className="dash-top-list">
          {summary?.topItems.map((item, idx) => (
            <div key={item.menuItemId} className="dash-top-row">
              <span className="dash-top-rank">{idx + 1}</span>
              <div className="dash-top-info">
                <strong>{item.name}</strong>
                <span className="muted">{item.qty} รายการ</span>
              </div>
              <strong>{formatMoney(item.revenue)}</strong>
            </div>
          ))}
          {summary && summary.topItems.length === 0 && <p className="muted" style={{ padding: 12 }}>ยังไม่มีข้อมูล</p>}
        </div>
      </section>

      {/* Low Stock */}
      <section className="panel">
        <div className="panel__header">
          <div><h2>⚠️ สต็อกใกล้หมด</h2><p className="muted">ต่ำกว่าขั้นต่ำที่ตั้งไว้</p></div>
        </div>
        <div className="dash-stock-list">
          {inventory.map(item => (
            <div key={item.ingredientId} className="inventory-row inventory-row--low">
              <div>
                <strong>{item.name}</strong>
                <span className="muted">{item.stockQty} {item.unit} (ขั้นต่ำ {item.reorderLevel})</span>
              </div>
            </div>
          ))}
          {inventory.length === 0 && <p className="muted" style={{ padding: 12 }}>สต็อกปกติดี 👍</p>}
        </div>
      </section>

      {/* Recent Shifts */}
      <section className="panel">
        <div className="panel__header">
          <div><h2>🕐 กะล่าสุด</h2><p className="muted">5 กะล่าสุด</p></div>
        </div>
        <div className="dash-shifts">
          {shifts.map(s => (
            <div key={s.id} className="dash-shift-row">
              <div>
                <strong>กะ #{s.id}</strong>
                <span className={`badge ${s.status === "OPEN" ? "badge--active" : ""}`}>{s.status === "OPEN" ? "เปิดอยู่" : "ปิดแล้ว"}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong>{formatMoney(s.totalSales)}</strong>
                <span className="muted">{s.totalOrders} บิล</span>
              </div>
            </div>
          ))}
          {shifts.length === 0 && <p className="muted" style={{ padding: 12 }}>ยังไม่มีประวัติกะ</p>}
        </div>
      </section>
    </main>
  );
}
