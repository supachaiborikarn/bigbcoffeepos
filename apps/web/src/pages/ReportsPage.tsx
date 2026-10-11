import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSalesSummary, getDailyCloseReport, getOrdersCsvUrl, downloadAuthedFile, API_URL } from "../api";
import type { PaymentMethod, ReportSource, SalesSummary } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";
import { useShift } from "../contexts/ShiftContext";
import { submitPrintJob } from "../utils/printJob";
import { getPaperWidth, getPrinterMode, setPaperWidth } from "../utils/printerSettings";
import { createDailySummaryJob } from "../utils/dailySummaryPrint";

function formatDateInput(date: Date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const formatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 0, maximumFractionDigits: 2 });
function formatMoney(v: number) { return formatter.format(v); }
const paymentLabels: Record<PaymentMethod | string, string> = {
  CASH: "เงินสด",
  QR: "QR",
  CARD: "บัตร",
  EWALLET: "E-Wallet"
};
const reportSourceLabels: Record<ReportSource, string> = {
  system: "ยอดขายในระบบ",
  pospos: "POSPOS sales-only",
  all: "ทั้งหมด"
};

const fetchAuth = async <T,>(url: string): Promise<T> => {
  const token = localStorage.getItem("bb_pos_token");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `โหลดไม่สำเร็จ (${res.status})`);
  return body as T;
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
  const [isPrintingDaily, setIsPrintingDaily] = useState(false);
  const [reportBranchId, setReportBranchId] = useState<number | null>(activeBranch?.id ?? null);
  const [reportSource, setReportSource] = useState<ReportSource>("system");
  const [reportRange, setReportRange] = useState(() => {
    const today = new Date();
    const from = new Date();
    from.setDate(today.getDate() - 6);
    return { from: formatDateInput(from), to: formatDateInput(today) };
  });

  // ใบส่งยอด: default = the day the branch's current shift was opened (Bangkok),
  // or today when no shift is open. Picking a date manually stops the auto-follow.
  const { activeShift } = useShift();
  const shiftDay = activeShift?.openedAt ? new Date(activeShift.openedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }) : null;
  const [summaryDate, setSummaryDate] = useState(() => shiftDay ?? formatDateInput(new Date()));
  const [summaryDateTouched, setSummaryDateTouched] = useState(false);
  const [paperWidth, setPaperWidthState] = useState(getPaperWidth);
  useEffect(() => {
    const sync = () => setPaperWidthState(getPaperWidth());
    window.addEventListener("bbpos-printer-settings", sync);
    return () => window.removeEventListener("bbpos-printer-settings", sync);
  }, []);
  useEffect(() => { if (shiftDay && !summaryDateTouched) setSummaryDate(shiftDay); }, [shiftDay, summaryDateTouched]);

  const queryStr = useMemo(() => {
    const params = new URLSearchParams();
    params.set("from", reportRange.from);
    params.set("to", reportRange.to);
    if (reportBranchId) params.set("branchId", String(reportBranchId));
    params.set("source", reportSource);
    return params.toString();
  }, [reportRange, reportBranchId, reportSource]);

  const rangeError = reportRange.from && reportRange.to && reportRange.from > reportRange.to ? "วันเริ่มต้องไม่หลังวันสิ้นสุด" : "";
  // toast changes identity on every toast; keep it out of refresh's deps or each error toast re-fetches
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    if (rangeError) return;
    // each part loads on its own: one failure no longer blanks the whole report
    const [s, p, st] = await Promise.allSettled([
      getSalesSummary({ from: reportRange.from, to: reportRange.to, branchId: reportBranchId ?? undefined, source: reportSource }),
      fetchAuth<any>(`${API_URL}/reports/profit?${queryStr}`),
      fetchAuth<any>(`${API_URL}/reports/staff?${queryStr}`)
    ]);
    if (s.status === "fulfilled") setSummary(s.value);
    if (p.status === "fulfilled") setProfitData(p.value);
    if (st.status === "fulfilled") setStaffData(st.value);
    const failed = [s, p, st].map((r, i) => r.status === "rejected" ? `${["ยอดขาย", "กำไร", "พนักงาน"][i]}: ${(r.reason as Error).message}` : null).filter(Boolean) as string[];
    setLoadErrors(failed);
    if (failed.length) toastRef.current.error(`โหลดรายงานบางส่วนไม่สำเร็จ (${failed.length})`);
  }, [reportRange, reportBranchId, reportSource, queryStr, rangeError]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleExportSales = () => {
    if (!summary) return;
    downloadCsv(`sales_${reportRange.from}_${reportRange.to}.csv`, summary.daily, [
      { key: "date", label: "วันที่" },
      { key: "orders", label: "จำนวนบิล" },
      { key: "revenue", label: "ยอดขาย" }
    ]);
  };

  const handleExportOrdersCsv = async () => {
    const url = getOrdersCsvUrl({ from: reportRange.from, to: reportRange.to, branchId: reportBranchId ?? undefined, source: reportSource });
    try {
      await downloadAuthedFile(url, `orders_${reportRange.from}_${reportRange.to}.csv`);
    } catch (error) {
      toast.error(`Export รายการออเดอร์ไม่สำเร็จ: ${(error as Error).message}`);
    }
  };

  const printDailySummary = async () => {
    if (!activeBranch) return;
    setIsPrintingDaily(true);
    // Browser printing needs the popup opened synchronously inside the click,
    // before the report fetch, or popup blockers swallow it. Printer bridges
    // (iOS app / PassPRNT / RawBT) don't use a window at all.
    let popup: Window | null = getPrinterMode() === "browser" ? window.open("", "bbpos_receipt", "width=420,height=760") : null;
    try {
      const report = await getDailyCloseReport({ date: summaryDate, branchId: reportBranchId ?? activeBranch.id, source: reportSource });
      if (!submitPrintJob(createDailySummaryJob(report, activeBranch.id), popup)) throw new Error("ระบบพิมพ์ยังไม่พร้อม ลองใหม่อีกครั้ง");
      popup = null;
    } catch (error) {
      popup?.close();
      toast.error((error as Error).message);
    } finally {
      setIsPrintingDaily(false);
    }
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
          <div style={{ display: "flex", gap: "12px", marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <select className="input" value={reportBranchId ?? ""} onChange={e => setReportBranchId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">ทุกสาขา</option>
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select className="input" value={reportSource} onChange={e => setReportSource(e.target.value as ReportSource)}>
              <option value="system">ยอดขายในระบบ</option>
              <option value="pospos">POSPOS sales-only</option>
              <option value="all">ทั้งหมด</option>
            </select>
            <input className="input" type="date" aria-label="ตั้งแต่วันที่" value={reportRange.from} max={reportRange.to} onChange={e => setReportRange({...reportRange, from: e.target.value})} aria-invalid={Boolean(rangeError)} />
            <input className="input" type="date" aria-label="ถึงวันที่" value={reportRange.to} min={reportRange.from} onChange={e => setReportRange({...reportRange, to: e.target.value})} aria-invalid={Boolean(rangeError)} />
            {rangeError && <span role="alert" className="negative" style={{ fontSize: 13, alignSelf: "center" }}>{rangeError}</span>}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
              วันที่ใบส่งยอด
              <input className="input" type="date" value={summaryDate} title={shiftDay === summaryDate ? "วันที่เปิดกะปัจจุบัน" : undefined} onChange={e => { setSummaryDateTouched(true); setSummaryDate(e.target.value); }} />
            </label>
            <div className="seg-paper" role="group" aria-label="ขนาดกระดาษ">
              {([58, 80] as const).map((w) => <button key={w} type="button" aria-pressed={paperWidth === w} className={paperWidth === w ? "is-active" : ""} onClick={() => setPaperWidth(w)}>{w} มม.</button>)}
            </div>
            <button className="btn btn--primary" onClick={printDailySummary} disabled={isPrintingDaily || !summaryDate}>
              {isPrintingDaily ? "กำลังเตรียม..." : "พิมพ์ใบส่งยอด"}
            </button>
          </div>
        </div>

        {loadErrors.length > 0 && <div className="bo-error" role="alert" style={{ margin: "0 24px 12px" }}>
          <span>โหลดไม่สำเร็จ: {loadErrors.join(" · ")}</span>
          <button type="button" className="btn btn--ghost" onClick={() => void refresh()}>ลองใหม่</button>
        </div>}

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
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: "16px" }}>
                <button className="btn btn--ghost" onClick={handleExportSales}>📥 Export CSV</button>
                <button className="btn btn--ghost" onClick={handleExportOrdersCsv}>Export Orders CSV</button>
              </div>
              <div style={{ marginBottom: "32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">{reportSourceLabels[summary.source]}</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(summary.totalRevenue)}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">จำนวนออเดอร์</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{summary.totalOrders}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">ยอดเฉลี่ย/บิล</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(summary.averageTicket)}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">ยอดขายในระบบ</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(summary.sourceBreakdown.system.revenue)}</strong>
                  <small className="muted">{summary.sourceBreakdown.system.orders.toLocaleString("th-TH")} บิล</small>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">POSPOS sales-only</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(summary.importedSalesOnlyRevenue)}</strong>
                  <small className="muted">{summary.importedSalesOnlyOrders.toLocaleString("th-TH")} บิล</small>
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
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">รายได้สุทธิ (หลังส่วนลด)</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(profitData.totalRevenue)}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">ต้นทุนรวม</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{formatMoney(profitData.totalCost)}</strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">กำไรสุทธิ</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px", color: profitData.totalProfit > 0 ? "#16a34a" : "#b5482b" }}>
                    {formatMoney(profitData.totalProfit)}
                  </strong>
                </div>
                <div style={{ padding: "20px", background: "var(--bg-muted)", borderRadius: "12px" }}>
                  <span className="muted">Margin</span>
                  <strong style={{ display: "block", fontSize: "24px", marginTop: "8px" }}>{profitData.marginPercent}%</strong>
                </div>
              </div>

              <h3>กำไรต่อเมนู</h3>
              <div style={{ marginTop: "16px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "13px" }}>
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
