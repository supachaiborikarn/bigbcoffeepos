import { useCallback, useEffect, useMemo, useState } from "react";
import { getSalesSummary, getDailyCloseReport, getOrdersCsvUrl, API_URL } from "../api";
import type { DailyCloseReport, PaymentMethod, ReportSource, SalesSummary } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";

function formatDateInput(date: Date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const formatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
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

function formatThaiDate(value: string) {
  return new Date(`${value}T12:00:00+07:00`).toLocaleDateString("th-TH", { dateStyle: "medium" });
}

function formatThaiDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  const [isPrintingDaily, setIsPrintingDaily] = useState(false);
  const [reportBranchId, setReportBranchId] = useState<number | null>(activeBranch?.id ?? null);
  const [reportSource, setReportSource] = useState<ReportSource>("system");
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
    params.set("source", reportSource);
    return params.toString();
  }, [reportRange, reportBranchId, reportSource]);

  const refresh = useCallback(async () => {
    try {
      const [s, p, st] = await Promise.all([
        getSalesSummary({ from: reportRange.from, to: reportRange.to, branchId: reportBranchId ?? undefined, source: reportSource }),
        fetchAuth<any>(`${API_URL}/reports/profit?${queryStr}`),
        fetchAuth<any>(`${API_URL}/reports/staff?${queryStr}`)
      ]);
      setSummary(s);
      setProfitData(p);
      setStaffData(st);
    } catch (e: any) { toast.error("โหลดรายงานไม่สำเร็จ"); }
  }, [reportRange, reportBranchId, reportSource, queryStr, toast]);

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
      const token = localStorage.getItem("bb_pos_token");
      const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `orders_${reportRange.from}_${reportRange.to}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error("Export รายการออเดอร์ไม่สำเร็จ");
    }
  };

  const printDailySummary = async () => {
    setIsPrintingDaily(true);
    let printWindow: Window | null = null;
    try {
      printWindow = window.open("", "_blank", "width=360,height=700");
      if (!printWindow) throw new Error("ไม่สามารถเปิดหน้าพิมพ์ได้");
      const report = await getDailyCloseReport({ date: reportRange.to, branchId: reportBranchId ?? activeBranch?.id, source: reportSource });
      const sourceLabel = reportSourceLabels[report.source] ?? reportSourceLabels.system;
      const row = (label: string, value: string, className = "") => `
        <div class="row ${className}">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>`;
      const sourceRows = [
        ["ยอดขายในระบบ", report.sourceBreakdown.system],
        ["POSPOS sales-only", report.sourceBreakdown.pospos],
        ["ทั้งหมด", report.sourceBreakdown.all]
      ].map(([label, source]) => {
        const item = source as DailyCloseReport["sourceBreakdown"]["system"];
        return row(String(label), `${item.orders.toLocaleString("th-TH")} บิล / ${formatMoney(item.revenue)}`);
      }).join("");
      const paymentRows = report.payments.map((payment) => (
        row(paymentLabels[payment.method] ?? payment.method, `${payment.count.toLocaleString("th-TH")} บิล / ${formatMoney(payment.total)}`)
      )).join("");
      const shiftRows = report.shifts.map((shift) => `
        <div class="mini-block">
          <p class="mini-title">กะ #${shift.id} · ${escapeHtml(shift.userName)}</p>
          ${row("เปิด", formatThaiDateTime(shift.openedAt))}
          ${row("ปิด", formatThaiDateTime(shift.closedAt))}
          ${row("ยอดขาย", formatMoney(shift.totalSales))}
          ${row("จำนวนบิล", shift.totalOrders.toLocaleString("th-TH"))}
          ${row("เงินนับ", shift.closingCash == null ? "-" : formatMoney(shift.closingCash))}
          ${row("ส่วนต่าง", shift.difference == null ? "-" : formatMoney(shift.difference), Number(shift.difference ?? 0) < 0 ? "neg" : "pos")}
          ${shift.note ? `<p class="note">หมายเหตุ: ${escapeHtml(shift.note)}</p>` : ""}
        </div>
      `).join("");
      const itemRows = report.topItems.slice(0, 10).map((item, index) => (
        row(`${index + 1}. ${item.name}`, `${item.qty.toLocaleString("th-TH")} / ${formatMoney(item.revenue)}`)
      )).join("");
      const hiddenItemCount = Math.max(0, report.topItems.length - 10);
      printWindow.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>ใบสรุปส่งยอด ${escapeHtml(report.date)}</title>
  <style>
    * { box-sizing: border-box; }
    @page { margin: 0; size: 80mm auto; }
    body {
      width: 80mm;
      margin: 0;
      padding: 8px;
      color: #111827;
      background: #fff;
      font-family: "IBM Plex Sans Thai", "Tahoma", sans-serif;
      font-size: 11px;
      line-height: 1.35;
    }
    .sheet { width: 100%; }
    header { text-align: center; border-bottom: 1px dashed #111827; padding-bottom: 8px; margin-bottom: 8px; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    h2 { font-size: 12px; margin: 10px 0 4px; padding-top: 6px; border-top: 1px dashed #111827; }
    p { margin: 0; }
    .muted { color: #667085; }
    .row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; align-items: baseline; }
    .row span { min-width: 0; overflow-wrap: anywhere; }
    .row strong { text-align: right; white-space: nowrap; }
    .total { border-top: 1px dashed #111827; margin-top: 4px; padding-top: 6px; font-size: 13px; }
    .mini-block { padding: 5px 0; border-bottom: 1px dotted #d0d5dd; }
    .mini-title { font-weight: 700; margin-bottom: 2px; }
    .note { color: #475467; margin-top: 3px; overflow-wrap: anywhere; }
    .pos { color: #047857; }
    .neg { color: #b42318; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 24px; }
    .sign { text-align: center; padding-top: 20px; border-top: 1px solid #111827; }
    .footer { text-align: center; margin-top: 10px; border-top: 1px dashed #111827; padding-top: 6px; }
    @media screen {
      body { background: #f2f4f7; padding: 12px; }
      .sheet { background: #fff; max-width: 320px; margin: 0 auto; padding: 8px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12); }
    }
    @media print { body { padding: 8px; background: #fff; } .sheet { box-shadow: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="sheet">
    <header>
      <h1>ใบสรุปส่งยอดประจำวัน</h1>
      <p><strong>${escapeHtml(report.branch?.name ?? "ทุกสาขา")}</strong></p>
      <p class="muted">วันที่ ${formatThaiDate(report.date)}</p>
      <p class="muted">ชุดข้อมูล: ${escapeHtml(sourceLabel)}</p>
      <p class="muted">พิมพ์ ${formatThaiDateTime(report.generatedAt)}</p>
    </header>

    ${row("ยอดขายสุทธิ", formatMoney(report.totals.totalRevenue), "total")}
    ${row("จำนวนบิล", report.totals.totalOrders.toLocaleString("th-TH"))}
    ${row("เฉลี่ย/บิล", formatMoney(report.totals.averageTicket))}
    ${row("ส่วนลดรวม", formatMoney(report.totals.discountAmount))}

    <h2>แยกตามแหล่งข้อมูล</h2>
    ${sourceRows}

    <h2>สรุปช่องทางชำระเงิน</h2>
    ${paymentRows || `<p class="muted">ไม่มีข้อมูลชำระเงิน</p>`}

    <h2>สรุปเงินสด</h2>
    ${row("ขายเงินสด", formatMoney(report.cash.cashSales))}
    ${row("เงินสดที่ควรมี", formatMoney(report.cash.expectedCash))}
    ${row("นับเงินจริง", formatMoney(report.cash.countedCash))}
    ${row("ส่วนต่าง", formatMoney(report.cash.difference), report.cash.difference < 0 ? "neg total" : "pos total")}

    <h2>รายละเอียดกะ</h2>
    ${shiftRows || `<p class="muted">ไม่มีข้อมูลกะ</p>`}

    <h2>เมนูขายดี</h2>
    ${itemRows || `<p class="muted">ไม่มีข้อมูลสินค้า</p>`}
    ${hiddenItemCount > 0 ? `<p class="muted">มีสินค้าเพิ่มเติมอีก ${hiddenItemCount.toLocaleString("th-TH")} รายการ</p>` : ""}

    <h2>หมายเหตุยอด</h2>
    ${row("ยกเลิก", `${report.totals.cancelledOrders.toLocaleString("th-TH")} บิล`)}
    ${row("คืนเงิน", `${report.totals.refundedOrders.toLocaleString("th-TH")} บิล`)}
    ${row("ใช้แต้ม", `${report.totals.loyaltyPointsUsed.toLocaleString("th-TH")} แต้ม`)}

    <section class="signatures">
      <div class="sign">ผู้ส่งยอด</div>
      <div class="sign">ผู้รับยอด</div>
    </section>
    <p class="footer">Big B Coffee POS</p>
  </div>
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };</script>
</body>
</html>`);
      printWindow.document.close();
    } catch (error) {
      printWindow?.close();
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
            <input className="input" type="date" value={reportRange.from} onChange={e => setReportRange({...reportRange, from: e.target.value})} />
            <input className="input" type="date" value={reportRange.to} onChange={e => setReportRange({...reportRange, to: e.target.value})} />
            <button className="btn btn--primary" onClick={printDailySummary} disabled={isPrintingDaily}>
              {isPrintingDaily ? "กำลังเตรียม..." : "พิมพ์ใบส่งยอด"}
            </button>
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
                  <span className="muted">รายได้รวม</span>
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
