import { useCallback, useEffect, useMemo, useState } from "react";
import { getSalesSummary, getDailyCloseReport, getOrdersCsvUrl, API_URL } from "../api";
import type { DailyCloseReport, PaymentMethod, SalesSummary } from "../types";
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

  const handleExportOrdersCsv = async () => {
    const url = getOrdersCsvUrl({ from: reportRange.from, to: reportRange.to, branchId: reportBranchId ?? undefined });
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
    try {
      const report = await getDailyCloseReport({ date: reportRange.to, branchId: reportBranchId ?? activeBranch?.id });
      const printWindow = window.open("", "_blank", "width=900,height=1000");
      if (!printWindow) throw new Error("ไม่สามารถเปิดหน้าพิมพ์ได้");
      const paymentRows = report.payments.map((payment) => `
        <tr>
          <td>${escapeHtml(paymentLabels[payment.method])}</td>
          <td class="num">${payment.count.toLocaleString("th-TH")}</td>
          <td class="num">${formatMoney(payment.total)}</td>
        </tr>
      `).join("");
      const shiftRows = report.shifts.map((shift) => `
        <tr>
          <td>#${shift.id}<br><small>${escapeHtml(shift.userName)}</small></td>
          <td>${formatThaiDateTime(shift.openedAt)}<br><small>ปิด ${formatThaiDateTime(shift.closedAt)}</small></td>
          <td class="num">${formatMoney(shift.totalSales)}</td>
          <td class="num">${shift.totalOrders.toLocaleString("th-TH")}</td>
          <td class="num">${shift.closingCash == null ? "-" : formatMoney(shift.closingCash)}</td>
          <td class="num ${Number(shift.difference ?? 0) < 0 ? "neg" : "pos"}">${shift.difference == null ? "-" : formatMoney(shift.difference)}</td>
          <td>${escapeHtml(shift.note ?? "")}</td>
        </tr>
      `).join("");
      const itemRows = report.topItems.map((item, index) => `
        <tr>
          <td>${index + 1}. ${escapeHtml(item.name)}</td>
          <td class="num">${item.qty.toLocaleString("th-TH")}</td>
          <td class="num">${formatMoney(item.revenue)}</td>
        </tr>
      `).join("");
      printWindow.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>ใบสรุปส่งยอด ${escapeHtml(report.date)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "IBM Plex Sans Thai", "Tahoma", sans-serif; color: #1f2933; margin: 0; padding: 24px; background: #fff; }
    .sheet { max-width: 820px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 18px; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 24px 0 8px; }
    p { margin: 0; }
    small, .muted { color: #667085; }
    .stamp { text-align: right; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
    .box { border: 1px solid #d0d5dd; padding: 10px; min-height: 72px; }
    .box span { display: block; color: #667085; font-size: 12px; }
    .box strong { display: block; font-size: 20px; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 13px; }
    th, td { border: 1px solid #d0d5dd; padding: 7px 8px; text-align: left; vertical-align: top; }
    th { background: #f2f4f7; font-weight: 700; }
    .num { text-align: right; white-space: nowrap; }
    .pos { color: #047857; }
    .neg { color: #b42318; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 44px; }
    .sign { text-align: center; padding-top: 34px; border-top: 1px solid #111827; }
    @page { margin: 12mm; }
    @media print { body { padding: 0; } button { display: none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <header>
      <div>
        <h1>ใบสรุปส่งยอดประจำวัน</h1>
        <p><strong>${escapeHtml(report.branch?.name ?? "ทุกสาขา")}</strong></p>
        <p class="muted">วันที่ ${formatThaiDate(report.date)}</p>
      </div>
      <div class="stamp">
        <p>พิมพ์เมื่อ</p>
        <strong>${formatThaiDateTime(report.generatedAt)}</strong>
      </div>
    </header>

    <section class="grid">
      <div class="box"><span>ยอดขายสุทธิ</span><strong>${formatMoney(report.totals.totalRevenue)}</strong></div>
      <div class="box"><span>จำนวนบิล</span><strong>${report.totals.totalOrders.toLocaleString("th-TH")}</strong></div>
      <div class="box"><span>เฉลี่ย/บิล</span><strong>${formatMoney(report.totals.averageTicket)}</strong></div>
      <div class="box"><span>ส่วนลดรวม</span><strong>${formatMoney(report.totals.discountAmount)}</strong></div>
    </section>

    <h2>สรุปช่องทางชำระเงิน</h2>
    <table>
      <thead><tr><th>ช่องทาง</th><th class="num">บิล</th><th class="num">ยอดรวม</th></tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>

    <h2>สรุปเงินสด</h2>
    <section class="grid">
      <div class="box"><span>ขายเงินสด</span><strong>${formatMoney(report.cash.cashSales)}</strong></div>
      <div class="box"><span>เงินสดที่ควรมี</span><strong>${formatMoney(report.cash.expectedCash)}</strong></div>
      <div class="box"><span>นับเงินจริง</span><strong>${formatMoney(report.cash.countedCash)}</strong></div>
      <div class="box"><span>ส่วนต่าง</span><strong class="${report.cash.difference < 0 ? "neg" : "pos"}">${formatMoney(report.cash.difference)}</strong></div>
    </section>

    <h2>รายละเอียดกะ</h2>
    <table>
      <thead><tr><th>กะ / ผู้ขาย</th><th>เวลา</th><th class="num">ยอดขาย</th><th class="num">บิล</th><th class="num">เงินนับ</th><th class="num">ต่าง</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${shiftRows || `<tr><td colspan="7" class="muted">ไม่มีข้อมูลกะ</td></tr>`}</tbody>
    </table>

    <h2>เมนูขายดี</h2>
    <table>
      <thead><tr><th>สินค้า</th><th class="num">จำนวน</th><th class="num">ยอดขาย</th></tr></thead>
      <tbody>${itemRows || `<tr><td colspan="3" class="muted">ไม่มีข้อมูลสินค้า</td></tr>`}</tbody>
    </table>

    <p class="muted" style="margin-top: 14px;">ยกเลิก ${report.totals.cancelledOrders.toLocaleString("th-TH")} บิล · คืนเงิน ${report.totals.refundedOrders.toLocaleString("th-TH")} บิล · ใช้แต้ม ${report.totals.loyaltyPointsUsed.toLocaleString("th-TH")} แต้ม</p>

    <section class="signatures">
      <div class="sign">ผู้ส่งยอด</div>
      <div class="sign">ผู้รับยอด</div>
    </section>
  </div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`);
      printWindow.document.close();
    } catch (error) {
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
