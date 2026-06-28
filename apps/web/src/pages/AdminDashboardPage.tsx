import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getSalesSummary,
  getCurrentShift,
  getInventory,
  getUsers,
  getPurchases,
  approvePurchase,
  getIntegrationStatus,
  getIntegrationOutboxSummary,
  getIntegrationEvents,
  retryIntegrationEvent,
  processIntegrationOutbox,
  getOfflinePendingCount,
  getOfflineFailedCount,
  retryFailedOfflineOrders,
} from "../api";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";
import type {
  Branch,
  InventoryItem,
  IntegrationEvent,
  IntegrationOutboxSummary,
  IntegrationStatus,
  PurchaseOrder,
  SalesSummary,
  User,
} from "../types";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ClipboardList,
  Coffee,
  Database,
  Package,
  Pencil,
  RefreshCw,
  Settings,
  ShoppingCart,
  Store,
  TrendingUp,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";

const COFFEE = "#8B5E3C";
const ALERT = "#B07514";

type BranchStat = {
  branch: Branch;
  revenue: number;
  orders: number;
  cups: number;
  lowStock: number;
  shiftOpen: boolean;
};

const ROLE_LABEL: Record<User["role"], string> = {
  admin: "แอดมิน",
  manager: "ผู้จัดการ",
  cashier: "แคชเชียร์",
};

function formatMoney(v: number) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

function isoDaysAgo(daysBack: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const { branches } = useBranch();
  const toast = useToast();
  const navigate = useNavigate();

  const isAdmin = user?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [todaySummary, setTodaySummary] = useState<SalesSummary | null>(null);
  const [weekSummary, setWeekSummary] = useState<SalesSummary | null>(null);
  const [branchStats, setBranchStats] = useState<BranchStat[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pendingPOs, setPendingPOs] = useState<PurchaseOrder[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [outbox, setOutbox] = useState<IntegrationOutboxSummary | null>(null);
  const [failedEvents, setFailedEvents] = useState<IntegrationEvent[]>([]);
  const [offline, setOffline] = useState({ pending: 0, failed: 0 });
  const [busy, setBusy] = useState<string | null>(null);

  const loadPurchases = useCallback(async () => {
    const items = await getPurchases().catch(() => [] as PurchaseOrder[]);
    setPendingPOs(items.filter((p) => p.status === "RECEIVED"));
  }, []);

  const loadSystem = useCallback(async () => {
    const [ints, ob, evts] = await Promise.all([
      getIntegrationStatus().catch(() => [] as IntegrationStatus[]),
      getIntegrationOutboxSummary().catch(() => null),
      getIntegrationEvents(30).catch(() => [] as IntegrationEvent[]),
    ]);
    setIntegrations(ints);
    setOutbox(ob);
    setFailedEvents(evts.filter((e) => e.status === "FAILED").slice(0, 4));
    setOffline({ pending: getOfflinePendingCount(), failed: getOfflineFailedCount() });
  }, []);

  const load = useCallback(async () => {
    if (!branches.length) return;
    setLoading(true);
    const today = isoDaysAgo(0);
    const weekAgo = isoDaysAgo(6);
    const [todayS, weekS, usersList, perBranch] = await Promise.all([
      getSalesSummary({ from: today, to: today }).catch(() => null),
      getSalesSummary({ from: weekAgo, to: today }).catch(() => null),
      getUsers().catch(() => [] as User[]),
      Promise.all(
        branches.map(async (b): Promise<BranchStat> => {
          const [sum, shift, inv] = await Promise.all([
            getSalesSummary({ from: today, to: today, branchId: b.id }).catch(() => null),
            getCurrentShift(b.id).catch(() => null),
            getInventory(b.id).catch(() => [] as InventoryItem[]),
          ]);
          const cups = sum?.topItems.reduce((a, i) => a + i.qty, 0) ?? 0;
          const lowStock = inv.filter((i) => i.reorderLevel > 0 && i.stockQty <= i.reorderLevel).length;
          return {
            branch: b,
            revenue: sum?.totalRevenue ?? 0,
            orders: sum?.totalOrders ?? 0,
            cups,
            lowStock,
            shiftOpen: shift?.status === "OPEN",
          };
        })
      ),
    ]);
    await Promise.all([loadPurchases(), loadSystem()]);
    setTodaySummary(todayS);
    setWeekSummary(weekS);
    setUsers(usersList);
    setBranchStats(perBranch);
    setLoading(false);
  }, [branches, loadPurchases, loadSystem]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const cups = useMemo(
    () => todaySummary?.topItems.reduce((a, i) => a + i.qty, 0) ?? 0,
    [todaySummary]
  );
  const totalLowStock = useMemo(
    () => branchStats.reduce((a, s) => a + s.lowStock, 0),
    [branchStats]
  );
  const maxBranchRevenue = useMemo(
    () => Math.max(1, ...branchStats.map((s) => s.revenue)),
    [branchStats]
  );
  const maxDailyRevenue = useMemo(
    () => Math.max(1, ...(weekSummary?.daily.map((d) => d.revenue) ?? [1])),
    [weekSummary]
  );

  const todayRevenue = todaySummary?.totalRevenue ?? 0;
  const yesterdayRevenue =
    weekSummary?.daily.find((d) => d.date === isoDaysAgo(1))?.revenue ?? 0;
  const revChange =
    yesterdayRevenue > 0 ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100) : 0;

  const outboxCount = useCallback(
    (status: IntegrationEvent["status"]) =>
      outbox?.byStatus.find((s) => s.status === status)?.count ?? 0,
    [outbox]
  );
  const outPending = outboxCount("PENDING");
  const outSent = outboxCount("SENT");
  const outFailed = outboxCount("FAILED");
  const systemOk = outFailed === 0 && offline.failed === 0;

  const activeStaff = users.filter((u) => u.active !== false);
  const todayStr = isoDaysAgo(0);

  async function handleApprove(po: PurchaseOrder) {
    setBusy(`po-${po.id}`);
    try {
      await approvePurchase(po.id);
      setPendingPOs((prev) => prev.filter((p) => p.id !== po.id));
      toast.success(`อนุมัติใบสั่งซื้อ #${po.id} แล้ว`);
    } catch (e) {
      toast.error((e as Error).message || "อนุมัติไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function handleProcessOutbox() {
    setBusy("outbox");
    try {
      const r = await processIntegrationOutbox();
      toast.success(`ประมวลผลแล้ว · ส่ง ${r.sent} · ลองใหม่ ${r.retried}`);
      await loadSystem();
    } catch (e) {
      toast.error((e as Error).message || "ประมวลผลไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function handleRetryEvent(id: number) {
    setBusy(`evt-${id}`);
    try {
      await retryIntegrationEvent(id);
      toast.success("ส่งรายการซ้ำแล้ว");
      await loadSystem();
    } catch (e) {
      toast.error((e as Error).message || "ลองใหม่ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function handleRetryOffline() {
    setBusy("offline");
    try {
      const r = await retryFailedOfflineOrders();
      toast.success(`ส่งออเดอร์ออฟไลน์ ${r.sent} · ค้าง ${r.remaining}`);
      setOffline({ pending: getOfflinePendingCount(), failed: getOfflineFailedCount() });
    } catch (e) {
      toast.error((e as Error).message || "ลองใหม่ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin) {
    return (
      <main className="dashboard-grid">
        <div className="panel" style={{ padding: 48, alignItems: "center", textAlign: "center" }}>
          <AlertTriangle size={36} style={{ color: "var(--warning)", marginBottom: 12 }} />
          <h2>เฉพาะแอดมินเท่านั้น</h2>
          <p className="muted" style={{ marginTop: 6 }}>หน้านี้สงวนไว้สำหรับผู้ดูแลระบบ (แอดมิน) เท่านั้น</p>
        </div>
      </main>
    );
  }

  const kpis = [
    { label: "ยอดขายวันนี้", value: formatMoney(todayRevenue), icon: TrendingUp, color: COFFEE, change: revChange },
    { label: "ออเดอร์วันนี้", value: String(todaySummary?.totalOrders ?? 0), icon: ShoppingCart, color: COFFEE, sub: `บิลเฉลี่ย ${formatMoney(todaySummary?.averageTicket ?? 0)}` },
    { label: "แก้วที่ขายได้", value: String(cups), icon: Coffee, color: COFFEE, sub: `${branches.length} สาขา` },
    { label: "สต็อกต่ำ", value: String(totalLowStock), icon: AlertTriangle, color: ALERT, sub: totalLowStock > 0 ? "ต้องสั่งเพิ่ม" : "ปกติดี" },
    { label: "รออนุมัติ", value: String(pendingPOs.length), icon: ClipboardList, color: ALERT, sub: "ใบสั่งซื้อ" },
    { label: "สถานะระบบ", value: systemOk ? "ปกติ" : "เตือน", icon: Wifi, color: systemOk ? "#10B981" : ALERT, sub: `ออฟไลน์ ${offline.pending} · ล้มเหลว ${outFailed + offline.failed}` },
  ];

  const quickActions = [
    { label: "เพิ่มพนักงาน", icon: UserPlus, to: "/staff" },
    { label: "จัดการเมนู/สต็อก", icon: Package, to: "/inventory?tab=products&manage=menu" },
    { label: "ดูรายงาน", icon: BarChart3, to: "/reports" },
    { label: "ย้ายข้อมูล", icon: Database, to: "/migration" },
    { label: "ตั้งค่าระบบ", icon: Settings, to: "/settings" },
  ];

  const branchGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1.4fr 76px 112px 52px 60px 96px",
    alignItems: "center",
    gap: 10,
  };

  return (
    <main className="dashboard-grid">
      {/* Brand header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: COFFEE,
          borderRadius: 16,
          padding: "16px 20px",
          color: "#fff",
        }}
      >
        <span
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: "rgba(255,255,255,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Coffee size={22} />
        </span>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, color: "#fff" }}>ศูนย์ควบคุมแอดมิน</h1>
          <p style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
            ภาพรวมทุกสาขา ({branches.length}) ·{" "}
            {new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <button
          className="btn"
          onClick={() => load()}
          disabled={loading}
          style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}
        >
          <RefreshCw size={15} className={loading ? "spin" : undefined} />
          {loading ? "กำลังโหลด" : "รีเฟรช"}
        </button>
      </div>

      {/* KPI cards */}
      <section className="dash-kpi-row">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="dash-kpi">
              <span className="dash-kpi__icon" style={{ background: `${kpi.color}1A` }}>
                <Icon size={18} style={{ color: kpi.color }} />
              </span>
              <div>
                <p className="dash-kpi__label">{kpi.label}</p>
                <p className="dash-kpi__value">{loading && !todaySummary ? "—" : kpi.value}</p>
                {kpi.change !== undefined && kpi.change !== 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: kpi.change > 0 ? "#10B981" : "#EF4444",
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      marginTop: 2,
                    }}
                  >
                    {kpi.change > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {kpi.change > 0 ? "+" : ""}
                    {kpi.change}% vs เมื่อวาน
                  </span>
                )}
                {kpi.sub && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "block" }}>
                    {kpi.sub}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Quick actions */}
      <section style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {quickActions.map((a) => {
          const Icon = a.icon;
          return (
            <button key={a.label} className="btn btn--outline" onClick={() => navigate(a.to)}>
              <Icon size={15} />
              {a.label}
            </button>
          );
        })}
      </section>

      {/* 7-day trend */}
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>ยอดขายรวม 7 วัน</h2>
            <p className="muted">ทุกสาขา · {isoDaysAgo(6)} — {todayStr}</p>
          </div>
        </div>
        <div className="dash-chart">
          {weekSummary?.daily.map((d) => (
            <div key={d.date} className={`dash-bar-col ${d.date === todayStr ? "dash-bar-col--today" : ""}`}>
              <span className="dash-bar-value">{formatMoney(d.revenue)}</span>
              <div className="dash-bar" style={{ height: `${Math.max(4, (d.revenue / maxDailyRevenue) * 140)}px` }} />
              <span className="dash-bar-label">
                {new Date(d.date + "T00:00:00").toLocaleDateString("th-TH", { weekday: "short", day: "2-digit" })}
              </span>
              <span className="dash-bar-orders">{d.orders} บิล</span>
            </div>
          ))}
          {(!weekSummary || weekSummary.daily.length === 0) && (
            <p className="muted" style={{ padding: 20, margin: "auto" }}>ยังไม่มียอดขายในช่วงนี้</p>
          )}
        </div>
      </section>

      {/* Multi-branch overview */}
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>
              <Store size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
              ภาพรวมทุกสาขา
            </h2>
            <p className="muted">ยอดวันนี้ · สถานะกะ · สต็อก</p>
          </div>
        </div>
        <div style={{ padding: "0 24px 20px" }}>
          <div
            style={{
              ...branchGrid,
              padding: "8px 4px",
              fontSize: 12,
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span>สาขา</span>
            <span>กะ</span>
            <span style={{ textAlign: "right" }}>ยอดขาย</span>
            <span style={{ textAlign: "right" }}>บิล</span>
            <span style={{ textAlign: "right" }}>สต็อก</span>
            <span style={{ textAlign: "right" }}>สัดส่วน</span>
          </div>
          {branchStats.map((s) => (
            <div
              key={s.branch.id}
              style={{ ...branchGrid, padding: "12px 4px", fontSize: 13, borderBottom: "1px solid var(--border-light)" }}
            >
              <div>
                <strong style={{ fontSize: 13 }}>{s.branch.name}</strong>
                <span className="muted" style={{ display: "block", fontSize: 11 }}>{s.branch.location}</span>
              </div>
              <span className={`badge ${s.shiftOpen ? "badge--active" : "badge--warning"}`}>
                {s.shiftOpen ? "เปิด" : "ปิด"}
              </span>
              <strong style={{ textAlign: "right" }}>{formatMoney(s.revenue)}</strong>
              <span style={{ textAlign: "right" }}>{s.orders}</span>
              <span style={{ textAlign: "right", color: s.lowStock > 0 ? ALERT : "var(--text-muted)", fontWeight: s.lowStock > 0 ? 600 : 400 }}>
                {s.lowStock}
              </span>
              <span>
                <span style={{ display: "block", height: 6, borderRadius: 999, background: "var(--bg-muted)", overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${Math.round((s.revenue / maxBranchRevenue) * 100)}%`,
                      background: COFFEE,
                      borderRadius: 999,
                    }}
                  />
                </span>
                <span className="muted" style={{ fontSize: 10, display: "block", textAlign: "right", marginTop: 2 }}>
                  {Math.round((s.revenue / maxBranchRevenue) * 100)}%
                </span>
              </span>
            </div>
          ))}
          {!loading && branchStats.length === 0 && (
            <p className="muted" style={{ padding: 16 }}>ยังไม่มีข้อมูลสาขา</p>
          )}
        </div>
      </section>

      {/* Staff + Approvals */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Staff & roles */}
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>
                <Users size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                พนักงาน &amp; สิทธิ์
              </h2>
              <p className="muted">{activeStaff.length} คนใช้งานอยู่</p>
            </div>
            <button className="btn btn--ghost" onClick={() => navigate("/staff")}>
              <UserPlus size={14} />
              จัดการ
            </button>
          </div>
          <div style={{ padding: "0 24px 20px", display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "auto" }}>
            {activeStaff.slice(0, 8).map((u) => (
              <div
                key={u.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border-light)",
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: u.role === "admin" ? COFFEE : "var(--brand-muted)",
                    color: u.role === "admin" ? "#fff" : "var(--text-secondary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {u.name.charAt(0)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13, display: "block" }}>{u.name}</strong>
                  <span className="muted" style={{ fontSize: 11 }}>{u.branch?.name ?? "ทุกสาขา"}</span>
                </div>
                <span className={`badge ${u.role === "admin" ? "badge--info" : ""}`}>{ROLE_LABEL[u.role]}</span>
                <button className="btn btn--outline" onClick={() => navigate("/staff")} aria-label="แก้ไขพนักงาน" style={{ padding: 8 }}>
                  <Pencil size={14} />
                </button>
              </div>
            ))}
            {!loading && activeStaff.length === 0 && <p className="muted" style={{ padding: 12 }}>ยังไม่มีพนักงาน</p>}
          </div>
        </section>

        {/* Pending approvals */}
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>
                <ClipboardList size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                รออนุมัติ — ใบสั่งซื้อ
              </h2>
              <p className="muted">อนุมัติได้ในคลิกเดียว</p>
            </div>
            {pendingPOs.length > 0 && <span className="badge badge--warning">{pendingPOs.length} ใบ</span>}
          </div>
          <div style={{ padding: "0 24px 20px", display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {pendingPOs.slice(0, 8).map((po) => (
              <div
                key={po.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  border: "1px solid var(--border-light)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-subtle)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13, display: "block" }}>{po.supplier}</strong>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {po.branchName ?? `สาขา #${po.branchId}`}
                    {po.itemCount ? ` · ${po.itemCount} รายการ` : ""}
                  </span>
                </div>
                <strong style={{ fontSize: 14, whiteSpace: "nowrap" }}>{formatMoney(po.totalCost)}</strong>
                <button
                  className="btn btn--primary"
                  onClick={() => handleApprove(po)}
                  disabled={busy === `po-${po.id}`}
                  style={{ padding: "8px 14px" }}
                >
                  <Check size={14} />
                  อนุมัติ
                </button>
              </div>
            ))}
            {!loading && pendingPOs.length === 0 && (
              <p className="muted" style={{ padding: 12 }}>ไม่มีใบสั่งซื้อรออนุมัติ ✓</p>
            )}
          </div>
        </section>
      </div>

      {/* System & sync health */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Integrations */}
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>
                <Wifi size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                การเชื่อมต่อ
              </h2>
              <p className="muted">สถานะการซิงค์ข้อมูล</p>
            </div>
          </div>
          <div style={{ padding: "0 24px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
            {integrations.map((it) => {
              const dot =
                it.failedEvents > 0 ? "#EF4444" : !it.configured ? "var(--text-muted)" : it.pendingEvents > 0 ? "#F59E0B" : "#10B981";
              const status =
                it.failedEvents > 0
                  ? `ล้มเหลว ${it.failedEvents}`
                  : !it.configured
                  ? "ยังไม่ตั้งค่า"
                  : it.pendingEvents > 0
                  ? `รอ ${it.pendingEvents}`
                  : "ปกติ";
              return (
                <div key={it.provider} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13 }}>{it.label}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{status}</span>
                </div>
              );
            })}
            {!loading && integrations.length === 0 && <p className="muted" style={{ padding: 12 }}>ยังไม่มีการเชื่อมต่อ</p>}
          </div>
        </section>

        {/* Outbox & offline */}
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>
                <RefreshCw size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                Outbox &amp; ออฟไลน์
              </h2>
              <p className="muted">คิวการส่งข้อมูล</p>
            </div>
          </div>
          <div style={{ padding: "0 24px 20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[
                { label: "รอส่ง", value: outPending, color: "var(--text-primary)" },
                { label: "ส่งแล้ว", value: outSent, color: "var(--text-primary)" },
                { label: "ล้มเหลว", value: outFailed, color: outFailed > 0 ? "#EF4444" : "var(--text-primary)" },
              ].map((t) => (
                <div key={t.label} style={{ background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                  <span className="muted" style={{ fontSize: 11 }}>{t.label}</span>
                  <strong style={{ display: "block", fontSize: 18, color: t.color }}>{t.value.toLocaleString("th-TH")}</strong>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", border: "1px solid var(--border-light)", borderRadius: "var(--radius-sm)", marginBottom: 8, background: "var(--bg-subtle)" }}>
              <span style={{ fontSize: 12 }}>
                ออเดอร์ออฟไลน์: รอส่ง {offline.pending} · ล้มเหลว {offline.failed}
              </span>
              {(offline.pending > 0 || offline.failed > 0) && (
                <button className="btn btn--outline" onClick={handleRetryOffline} disabled={busy === "offline"} style={{ padding: "6px 10px" }}>
                  <RefreshCw size={13} />
                  ลองใหม่
                </button>
              )}
            </div>

            {failedEvents.map((e) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                <AlertTriangle size={15} style={{ color: "#EF4444", flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.eventType} #{e.entityId ?? ""} ({e.provider})
                </span>
                <button className="btn btn--outline" onClick={() => handleRetryEvent(e.id)} disabled={busy === `evt-${e.id}`} style={{ padding: "6px 10px" }}>
                  <RefreshCw size={13} />
                  ลองใหม่
                </button>
              </div>
            ))}

            <button className="btn btn--ghost btn--full" onClick={handleProcessOutbox} disabled={busy === "outbox"} style={{ marginTop: 8 }}>
              <RefreshCw size={15} />
              ประมวลผล Outbox
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
