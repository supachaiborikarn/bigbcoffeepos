import { useCallback, useEffect, useMemo, useState } from "react";
import { getSalesSummary, API_URL } from "../api";
import type { SalesSummary } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";

function formatDateInput(date: Date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const formatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
function formatMoney(v: number) { return formatter.format(v); }

const fetchAuth = async <T,>(url: string): Promise<T> => {
  const token = localStorage.getItem("bb_pos_token");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  return res.json();
};

function downloadCsv(filename: string, rows: Record<string, any>[], columns: { key: string; label: string }[]) {
  const header = columns.map(c => c.label).join(",");
  const body = rows.map(r => columns.map(c => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const csv = "\uFEFF" + header + "\n" + body; // BOM for Excel Thai
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type Tab = "sales" | "profit" | "staff";

export default function ReportsPage() {
  const { activeBranch, branches } = useBranch();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("sales");
  
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [profitData, setProfitData] = useState<any>(null);
  const [staffData, setStaffData] = useState<any>(null);
  const [reportBranchId, setReportBranchId] = useState<number | null>(activeBranch?.id ?? null);
  const [reportRange, setReportRange] = useState(() => {
    const today = new Date();
    const from = new Date();
    from.setDate(today.getDate() - 6);
    return { from: formatDateInput(from), to: formatDateInput(today) };
  });

  const queryStr = useMemo(() => {
    const params = new URLSearchParams();
    params.set("from", reportRange.from);
    params.set("to", reportRange.to);
    if (reportBranchId) params.set("branchId", String(reportBranchId));
    return params.toString();
  }, [reportRange, reportBranchId]);

  const refresh = useCallback(async () => {
    try {
      const [s, p, st] = await Promise.all([
        getSalesSummary({ from: reportRange.from, to: reportRange.to, branchId: reportBranchId ?? undefined }),
        fetchAuth<any>(`${API_URL}/reports/profit?${queryStr}`),
        fetchAuth<any>(`${API_URL}/reports/staff?${queryStr}`)
      ]);
      setSummary(s);
      setProfitData(p);
      setStaffData(st);
    } catch (e: any) { toast.error("โหลดรายงานไม่สำเร็จ"); }
  }, [reportRange, reportBranchId, queryStr, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleExportSales = () => {
    if (!summary) return;
    downloadCsv(`sales_${reportRange.from}_${reportRange.to}.csv`, summary.daily, [
      { key: "date", label: "วันที่" },
      { key: "orders", label: "จำนวนบิล" },
      { key: "revenue", label: "ยอดขาย" }
    ]);
  };

  const handleExportProfit = () => {
    if (!profitData?.items) return;
    downloadCsv(`profit_${reportRange.from}_${reportRange.to}.csv`, profitData.items, [
      { key: "name", label: "เมนู" },
      { key: "totalQty", label: "จำนวนขาย" },
      { key: "revenue", label: "รายได้" },
      { key: "totalCost", label: "ต้นทุนรวม" },
      { key: "profit", label: "กำไร" }
    ]);
  };

  const handleExportStaff = () => {
    if (!staffData?.staff) return;
    downloadCsv(`staff_${reportRange.from}_${reportRange.to}.csv`, staffData.staff, [
      { key: "name", label: "พนักงาน" },
      { key: "totalOrders", label: "จำนวนบิล" },
      { key: "totalRevenue", label: "ยอดขาย" },
      { key: "avgTicket", label: "เฉลี่ย/บิล" }
    ]);
  };

  return (
    <main className="app__grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
      <section className="panel">
        <div className="panel__header" style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center" }}>
          <div>
            <h2>รายงาน</h2>
            <p className="muted">สรุปยอดขาย, กำไร, และผลงานพนักงาน</p>
          </div>
          <div style={{ display: "flex", gap: "12px", marginLeft: "auto" }}>
            <select className="input" value={reportBranchId ?? ""} onChange={e => setReportBranchId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">ทุกสาขา</option>
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input className="input" type="date" value={reportRange.from} onChange={e => setReportRange({...reportRange, from: e.target.value})} />
            <input className="input" type="date" value={reportRange.to} onChange={e => setReportRange({...reportRange, to: e.target.value})} />
          </div>
        </div>

        {/* Tabs */}
        <div className="tab-row" style={{ padding: "0 24px", borderBottom: "1px solid var(--border)" }}>
          {([["sales", "📊 ยอดขาย"], ["profit", "💰 กำไร"], ["staff", "👥 พนักงาน"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} className={`tab ${tab === t ? "tab--active" : ""}`} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: "24px" }}>
          {/* Sales Tab */}
          {tab === "sales" && summary && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
                <button className="btn btn--ghost" onClick={handleExportSales}>📥 Export CSV</button>
              </div>
              <div style={{ marginBottom: "32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                <div style={{ padding: "20px", background: "var(--bg-alt)", borderRadius: "12px" }}>
                  <span className="muted">ยอดขายรวม</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(summary.totalRevenue)}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-alt)", borderRadius: "12px" }}>
                  <span className="muted">จำนวนออเดอร์</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{summary.totalOrders}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-alt)", borderRadius: "12px" }}>
                  <span className="muted">ยอดเฉลี่ย/บิล</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(summary.averageTicket)}</strong>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                <div>
                  <h3>เมนูขายดี</h3>
                  <div style={{ marginTop: "16px" }}>
                    {summary.topItems.map((item: any, i: number) => (
                      <div key={item.menuItemId} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                        <div>
                          <strong>{i+1}. {item.name}</strong>
                          <div className="muted" style={{ fontSize: "12px" }}>ขายได้ {item.qty} รายการ</div>
                        </div>
                        <strong>{formatMoney(item.revenue)}</strong>
                      </div>
                    ))}
                    {summary.topItems.length === 0 && <div className="muted">ไม่มีข้อมูลการขาย</div>}
                  </div>
                </div>
                <div>
                  <h3>รายวัน</h3>
                  <div style={{ marginTop: "16px" }}>
                    {summary.daily.map((item: any) => (
                      <div key={item.date} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                        <div>
                          <strong>{item.date}</strong>
                          <div className="muted" style={{ fontSize: "12px" }}>{item.orders} บิล</div>
                        </div>
                        <strong>{formatMoney(item.revenue)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Profit Tab */}
          {tab === "profit" && profitData && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
                <button className="btn btn--ghost" onClick={handleExportProfit}>📥 Export CSV</button>
              </div>
              <div style={{ marginBottom: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
                <div style={{ padding: "20px", background: "var(--bg-alt)", borderRadius: "12px" }}>
                  <span className="muted">รายได้รวม</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(profitData.totalRevenue)}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-alt)", borderRadius: "12px" }}>
                  <span className="muted">ต้นทุนรวม</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(profitData.totalCost)}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-alt)", borderRadius: "12px" }}>
                  <span className="muted">กำไรสุทธิ</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px", color: profitData.totalProfit > 0 ? "#16a34a" : "#b5482b" }}>
                    {formatMoney(profitData.totalProfit)}
                  </strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-alt)", borderRadius: "12px" }}>
                  <span className="muted">Margin</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{profitData.marginPercent}%</strong>
                </div>
              </div>

              <h3>กำไรต่อเมนู</h3>
              <div style={{ marginTop: "16px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: "13px" }}>
                      <th style={{ padding: "10px 8px" }}>เมนู</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>ขาย</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>รายได้</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>ต้นทุน</th>
                      <th style={{ padding: "10px 8px", textAlign: "right" }}>กำไร</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitData.items.map((item: any) => (
                      <tr key={item.menuItemId} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "12px 8px" }}><strong>{item.name}</strong></td>
                        <td style={{ padding: "12px 8px", textAlign: "right" }}>{item.totalQty}</td>
                        <td style={{ padding: "12px 8px", textAlign: "right" }}>{formatMoney(item.revenue)}</td>
                        <td style={{ padding: "12px 8px", textAlign: "right" }}>{formatMoney(item.totalCost)}</td>
                        <td style={{ padding: "12px 8px", textAlign: "right", color: item.profit > 0 ? "#16a34a" : "#b5482b", fontWeight: 600 }}>
                          {formatMoney(item.profit)}
                        </td>
                      </tr>
                    ))}
                    {profitData.items.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: "24px", textAlign: "center" }} className="muted">ไม่มีข้อมูล</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Staff Tab */}
          {tab === "staff" && staffData && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
                <button className="btn btn--ghost" onClick={handleExportStaff}>📥 Export CSV</button>
              </div>
              <h3>ผลงานพนักงาน</h3>
              <div style={{ marginTop: "16px" }}>
                {staffData.staff.map((s: any) => (
                  <div key={s.userId ?? "unknown"} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <strong style={{ fontSize: "16px" }}>{s.name || "ไม่ระบุ"}</strong>
                      <div className="muted" style={{ fontSize: "12px" }}>{s.totalOrders} บิล · เฉลี่ย {formatMoney(s.avgTicket)}/บิล</div>
                    </div>
                    <strong style={{ fontSize: "20px" }}>{formatMoney(s.totalRevenue)}</strong>
                  </div>
                ))}
                {staffData.staff.length === 0 && <div className="muted">ไม่มีข้อมูล</div>}
              </div>
            </>
          )}

          {!summary && <div className="empty" style={{ padding: "48px" }}>กำลังโหลดข้อมูล...</div>}
        </div>
      </section>
    </main>
  );
}
