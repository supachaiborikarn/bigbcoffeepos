// ─── Daily close summary ("ใบสรุปส่งยอดประจำวัน") for thermal printers ─────
// Built as a ReceiptPrintJob so it goes through PrintCenter exactly like a
// receipt: it follows the device's printer mode (iOS Star app / PassPRNT /
// RawBT / browser) and the 58 / 80 mm paper width from printer settings.
import type { DailyCloseReport, PaymentMethod } from "../types";
import type { ReceiptPrintJob } from "./printJob";
import { getPaperWidth, PAPER_SPECS } from "./printerSettings";
import { ESCPOS, padRow } from "../components/ReceiptPrinter";

const SOURCE_LABELS: Record<string, string> = { system: "ยอดขายในระบบ", pospos: "POSPOS sales-only", all: "ทั้งหมด" };
const PAYMENT_LABELS: Record<PaymentMethod | string, string> = { CASH: "เงินสด", QR: "QR", CARD: "บัตร", EWALLET: "E-Wallet" };
const TOP_ITEM_LIMIT = 10;

const moneyFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const money = (v: number) => `${v < 0 ? "-" : ""}฿${moneyFormatter.format(Math.abs(v))}`;
const num = (v: number) => v.toLocaleString("th-TH");
const thaiDate = (value: string) => new Date(`${value}T12:00:00+07:00`).toLocaleDateString("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" });
const thaiDateTime = (value?: string | null) => value ? new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }) : "-";
const thaiTime = (value?: string | null) => value ? new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "-";
const cashStatus = (diff: number) => diff === 0 ? "ตรงยอด" : diff < 0 ? "เงินขาด" : "เงินเกิน";
const signed = (v: number) => `${v > 0 ? "+" : ""}${money(v)}`;
const bangkokDay = (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
// Time only when it falls on the report day; otherwise include the date (shift crossed midnight).
const shiftTime = (value: string | null, reportDate: string) => !value ? "-" : bangkokDay(value) === reportDate ? thaiTime(value) : thaiDateTime(value);

function esc(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Cash reconciliation over CLOSED shifts only (an open shift has no counted
 * cash yet, so including it would show a false shortage):
 *   counted − opening float = cash actually taken from sales → compare with cash sales.
 */
function cashReconciliation(report: DailyCloseReport) {
  const closed = report.shifts.filter((s) => s.closedAt && s.closingCash != null);
  const counted = closed.reduce((sum, s) => sum + (s.closingCash ?? 0), 0);
  const opening = closed.reduce((sum, s) => sum + s.openingCash, 0);
  const cashSales = closed.reduce((sum, s) => sum + s.cashSales, 0);
  const net = counted - opening;
  return { closed, openShifts: report.shifts.filter((s) => !s.closedAt), counted, opening, net, cashSales, diff: Math.round((net - cashSales) * 100) / 100 };
}

/**
 * `device` = the document is rendered by a printer bridge (iOS app / PassPRNT)
 * at the roll's printable width, so the slip fills 100% instead of a fixed mm.
 */
export function buildDailySummaryHtml(report: DailyCloseReport, widthMm: 58 | 80 = getPaperWidth(), device = false) {
  const wide = widthMm === 80;
  const spec = PAPER_SPECS[widthMm];
  const cups = report.cups ?? [];
  const sourceLabel = SOURCE_LABELS[report.source] ?? SOURCE_LABELS.system;
  const row = (label: string, value: string, cls = "") => `<div class="row ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  const cash = cashReconciliation(report);
  const paymentTotal = report.payments.reduce((sum, p) => sum + p.total, 0);
  const paymentCount = report.payments.reduce((sum, p) => sum + p.count, 0);

  const sources = ([["ในระบบ", report.sourceBreakdown.system], ["POSPOS", report.sourceBreakdown.pospos], ["ทั้งหมด", report.sourceBreakdown.all]] as const)
    .map(([label, s]) => `<tr><td>${label}</td><td class="n">${num(s.orders)}</td><td class="n">${money(s.revenue)}</td></tr>`).join("");
  const payments = report.payments
    .map((p) => `<tr><td>${esc(PAYMENT_LABELS[p.method] ?? p.method)}</td><td class="n">${num(p.count)}</td><td class="n">${money(p.total)}</td></tr>`).join("");
  const shifts = report.shifts.map((s) => `
    <div class="shift">
      <div class="shift-head"><b>กะ #${s.id}</b><span>${s.closedAt ? "ปิดแล้ว" : "ยังเปิดอยู่"}</span></div>
      <table class="who"><tbody>
        <tr><td class="who-k">เปิดกะ</td><td class="who-t">${esc(shiftTime(s.openedAt, report.date))}</td><td class="who-n">${esc(s.userName)}</td></tr>
        <tr><td class="who-k">ปิดกะ</td><td class="who-t">${esc(shiftTime(s.closedAt, report.date))}</td><td class="who-n">${s.closedAt ? esc(s.closedByName || "-") : "—"}</td></tr>
      </tbody></table>
      ${row("เงินเปิดกะ", money(s.openingCash))}
      <div class="grid2">
        ${row("ยอดขาย", money(s.totalSales))}
        ${row("บิล", num(s.totalOrders))}
        ${row("เงินสด", money(s.cashSales))}
        ${row("QR/บัตร", money(s.qrSales + s.cardSales))}
        ${row("ควรมี", money(s.expectedCash))}
        ${row("นับได้", s.closingCash == null ? "-" : money(s.closingCash))}
      </div>
      ${s.difference == null ? "" : row(`ส่วนต่าง (${cashStatus(s.difference)})`, signed(s.difference), "strong")}
      ${s.note ? `<p class="note">หมายเหตุ: ${esc(s.note)}</p>` : ""}
    </div>`).join("");
  const items = report.topItems.slice(0, TOP_ITEM_LIMIT)
    .map((item, i) => `<tr><td class="idx">${i + 1}</td><td class="name">${esc(item.name)}</td><td class="n">${num(item.qty)}</td><td class="n">${money(item.revenue)}</td></tr>`).join("");
  const hiddenItems = Math.max(0, report.topItems.length - TOP_ITEM_LIMIT);

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="format-detection" content="telephone=no" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ใบสรุปส่งยอด ${esc(report.date)}</title>
<style>
  @page { margin: 0; size: ${widthMm}mm auto; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  ${device ? "" : `body { width: ${widthMm}mm; }`}
  body { font-family: 'IBM Plex Sans Thai', 'Sarabun', 'Tahoma', sans-serif; color: #000; font-size: ${wide ? 12.5 : 10.5}px; line-height: 1.38; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-variant-numeric: tabular-nums; }
  /* Printable width (not the roll width), centred, with an inner gutter so edge text isn't clipped. */
  .slip { width: ${device ? "100%" : `${spec.printableMm}mm`}; margin: 0 auto; padding: ${device ? `0 ${spec.gutterMm}mm 6mm` : `3mm ${spec.gutterMm}mm 9mm`}; overflow-wrap: anywhere; }
  p { margin: 0; }
  b { font-weight: 700; }
  .head { text-align: center; }
  .branch { font-size: 1.35em; font-weight: 800; line-height: 1.25; }
  .doc { display: inline-block; margin: 1.2mm 0 1.4mm; padding: 0.5mm 3mm; border: 1.5px solid #000; border-radius: 3px; font-weight: 800; letter-spacing: 0.3px; }
  .meta { font-size: 0.88em; }
  .rule { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  .hero { text-align: center; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 1.6mm 0 1.8mm; margin: 2.4mm 0 2mm; }
  .hero span { display: block; font-size: 0.92em; font-weight: 600; }
  .hero strong { display: block; font-size: ${wide ? 2.2 : 1.9}em; font-weight: 800; line-height: 1.15; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm ${wide ? "4mm" : "2.5mm"}; }
  .stat span { display: block; font-size: 0.84em; }
  .stat b { font-size: 1.08em; }
  h2 { font-size: 1em; font-weight: 800; margin: 3.2mm 0 1mm; padding-bottom: 0.6mm; border-bottom: 1.5px solid #000; display: flex; justify-content: space-between; align-items: baseline; }
  h2 small { font-size: 0.82em; font-weight: 600; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; padding: 0.35mm 0; }
  .row span { min-width: 0; overflow-wrap: anywhere; }
  .row b { white-space: nowrap; text-align: right; }
  .row.strong { font-weight: 800; border-top: 1px dashed #000; margin-top: 0.8mm; padding-top: 1mm; }
  .row.strong span { font-weight: 800; }
  .boxed { border: 1.5px solid #000; border-radius: 3px; padding: 1mm 1.6mm; margin-top: 1.2mm; font-size: 1.08em; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 0.84em; font-weight: 700; text-align: left; padding: 0 0 0.6mm; border-bottom: 1px dashed #000; }
  td { padding: 0.5mm 0; vertical-align: top; }
  th.n, td.n { text-align: right; white-space: nowrap; padding-left: 2mm; }
  td.idx { width: 1.6em; }
  td.name { overflow-wrap: anywhere; }
  tfoot td { font-weight: 800; border-top: 1px dashed #000; padding-top: 0.8mm; }
  .shift { padding: 1.2mm 0 1.4mm; border-bottom: 1px dotted #000; }
  .shift:last-child { border-bottom: 0; }
  .shift-head { display: flex; justify-content: space-between; gap: 2mm; }
  .shift-head span { overflow-wrap: anywhere; text-align: right; }
  .who { margin: 0.6mm 0 0.8mm; }
  .who td { padding: 0.3mm 0; }
  .who-k { width: 3.6em; font-weight: 700; }
  .who-t { white-space: nowrap; padding-right: 2mm !important; }
  .who-n { text-align: right; overflow-wrap: anywhere; }
  .grid2 { display: grid; grid-template-columns: ${wide ? "1fr 1fr" : "1fr"}; column-gap: 4mm; }
  .note { font-size: 0.88em; margin-top: 0.8mm; overflow-wrap: anywhere; }
  .muted { font-size: 0.88em; }
  .signs { display: grid; grid-template-columns: ${wide ? "1fr 1fr" : "1fr"}; gap: ${wide ? "5mm" : "7mm"}; margin-top: 10mm; }
  .sign { text-align: center; border-top: 1px solid #000; padding-top: 1mm; font-size: 0.9em; }
  .sign small { display: block; margin-top: 4mm; }
  .foot { text-align: center; font-size: 0.84em; margin-top: 5mm; }
  .cups td.n b { font-size: 1.12em; }
  ${device ? "" : `@media screen { body { background: #eceef0; padding: 12px 0; width: auto; } .slip { margin: 0 auto; background: #fff; box-shadow: 0 2px 10px #0002; outline: 1px dashed #bbb; outline-offset: ${(widthMm - spec.printableMm) / 2}mm; } }`}
</style>
</head>
<body><div class="slip">
  <div class="head">
    <p class="branch">${esc(report.branch?.name ?? "ทุกสาขา")}</p>
    <p class="doc">ใบสรุปส่งยอดประจำวัน</p>
    <p class="meta"><b>วันที่ ${esc(thaiDate(report.date))}</b></p>
    <p class="meta">ข้อมูล: ${esc(sourceLabel)} · พิมพ์ ${esc(thaiDateTime(report.generatedAt))}</p>
  </div>

  <div class="hero"><span>ยอดขายสุทธิ</span><strong>${money(report.totals.totalRevenue)}</strong></div>
  <div class="stats">
    <div class="stat"><span>จำนวนบิล</span><b>${num(report.totals.totalOrders)}</b></div>
    <div class="stat"><span>เฉลี่ย/บิล</span><b>${money(report.totals.averageTicket)}</b></div>
    <div class="stat"><span>ยอดก่อนส่วนลด</span><b>${money(report.totals.subtotal)}</b></div>
    <div class="stat"><span>ส่วนลดรวม</span><b>${money(report.totals.discountAmount)}</b></div>
  </div>

  ${cups.length ? `<h2>แก้ว <small>ณ เวลาพิมพ์</small></h2>
  <table class="cups"><thead><tr><th>แก้ว</th><th class="n">ขายวันนี้</th><th class="n">เหลือที่ร้าน</th></tr></thead><tbody>
    ${cups.map((c) => `<tr><td>${esc(c.label)}</td><td class="n">${num(c.sold)}</td><td class="n"><b>${num(c.remaining)}</b> ${esc(c.unit)}</td></tr>`).join("")}
  </tbody></table>` : ""}

  <h2>ช่องทางชำระเงิน</h2>
  ${payments ? `<table><thead><tr><th>ช่องทาง</th><th class="n">บิล</th><th class="n">ยอดเงิน</th></tr></thead><tbody>${payments}</tbody>
    <tfoot><tr><td>รวม</td><td class="n">${num(paymentCount)}</td><td class="n">${money(paymentTotal)}</td></tr></tfoot></table>` : `<p class="muted">ไม่มีข้อมูลชำระเงิน</p>`}

  <h2>สรุปเงินสด <small>กะที่ปิดแล้ว ${num(cash.closed.length)} กะ</small></h2>
  ${cash.closed.length ? `
  ${row("นับเงินในลิ้นชักได้", money(cash.counted))}
  ${row("หัก เงินทอนตอนเปิดกะ", money(-cash.opening))}
  ${row("= เงินสดจากการขาย", money(cash.net), "strong")}
  ${row("ยอดขายเงินสดตามระบบ", money(cash.cashSales))}
  <div class="row boxed"><span><b>ส่วนต่าง · ${cashStatus(cash.diff)}</b></span><b>${signed(cash.diff)}</b></div>` : `<p class="muted">ยังไม่มีกะที่ปิด · ขายเงินสดวันนี้ ${money(report.cash.cashSales)}</p>`}
  ${cash.openShifts.length ? `<p class="note">* กะ ${cash.openShifts.map((s) => `#${s.id}`).join(", ")} ยังไม่ปิด ไม่นับรวมในส่วนนี้</p>` : ""}

  <h2>รายละเอียดกะ <small>${num(report.shifts.length)} กะ</small></h2>
  ${shifts || `<p class="muted">ไม่มีข้อมูลกะ</p>`}

  <h2>เมนูขายดี <small>Top ${TOP_ITEM_LIMIT}</small></h2>
  ${items ? `<table><thead><tr><th class="idx">#</th><th>เมนู</th><th class="n">จำนวน</th><th class="n">ยอด</th></tr></thead><tbody>${items}</tbody></table>` : `<p class="muted">ไม่มีข้อมูลสินค้า</p>`}
  ${hiddenItems > 0 ? `<p class="muted">และสินค้าอื่นอีก ${num(hiddenItems)} รายการ</p>` : ""}

  <h2>แยกตามแหล่งข้อมูล</h2>
  <table><thead><tr><th>แหล่ง</th><th class="n">บิล</th><th class="n">ยอดเงิน</th></tr></thead><tbody>${sources}</tbody></table>

  <h2>หมายเหตุยอด</h2>
  ${row("ยกเลิก", `${num(report.totals.cancelledOrders)} บิล`)}
  ${row("คืนเงิน", `${num(report.totals.refundedOrders)} บิล`)}
  ${row("ใช้แต้มสะสม", `${num(report.totals.loyaltyPointsUsed)} แต้ม`)}

  <div class="signs">
    <div class="sign">ผู้ส่งยอด<small>วันที่ ____/____/______</small></div>
    <div class="sign">ผู้รับยอด<small>วันที่ ____/____/______</small></div>
  </div>
  <p class="foot">Big B Coffee POS</p>
</div></body>
</html>`;
}

/** Plain ESC/POS text version for RawBT (48 columns on 80 mm, 32 on 58 mm). */
export function buildDailySummaryEscPos(report: DailyCloseReport, widthMm: 58 | 80 = getPaperWidth()) {
  const cols = widthMm === 80 ? 48 : 32;
  const row = (left: string, right: string) => padRow(left, right, cols) + "\n";
  const div = "-".repeat(cols) + "\n";
  const section = (title: string) => "\n" + ESCPOS.boldOn + title + ESCPOS.boldOff + "\n" + div;

  let out = ESCPOS.init + ESCPOS.alignCenter;
  out += ESCPOS.boldOn + (report.branch?.name ?? "ทุกสาขา") + ESCPOS.boldOff + "\n";
  out += "ใบสรุปส่งยอดประจำวัน\n";
  out += `วันที่ ${thaiDate(report.date)}\n`;
  out += `พิมพ์ ${thaiDateTime(report.generatedAt)}\n`;
  out += ESCPOS.alignLeft + div;
  out += ESCPOS.alignCenter + "ยอดขายสุทธิ\n" + ESCPOS.doubleOn + money(report.totals.totalRevenue) + ESCPOS.doubleOff + "\n" + ESCPOS.alignLeft + div;
  out += row("จำนวนบิล", num(report.totals.totalOrders));
  out += row("เฉลี่ย/บิล", money(report.totals.averageTicket));
  out += row("ส่วนลดรวม", money(report.totals.discountAmount));

  if (report.cups?.length) {
    out += section("แก้ว (ขายวันนี้ / เหลือที่ร้าน)");
    report.cups.forEach((c) => { out += row(c.label, `${num(c.sold)} / ${num(c.remaining)} ${c.unit}`); });
  }

  out += section("ช่องทางชำระเงิน");
  if (!report.payments.length) out += "ไม่มีข้อมูลชำระเงิน\n";
  report.payments.forEach((p) => { out += row(PAYMENT_LABELS[p.method] ?? p.method, `${num(p.count)} บิล  ${money(p.total)}`); });

  const cash = cashReconciliation(report);
  out += section(`สรุปเงินสด (ปิดแล้ว ${cash.closed.length} กะ)`);
  if (cash.closed.length) {
    out += row("นับเงินในลิ้นชักได้", money(cash.counted));
    out += row("หัก เงินทอนตอนเปิดกะ", money(-cash.opening));
    out += ESCPOS.boldOn + row("= เงินสดจากการขาย", money(cash.net)) + ESCPOS.boldOff;
    out += row("ยอดขายเงินสดตามระบบ", money(cash.cashSales));
    out += ESCPOS.boldOn + row(`ส่วนต่าง (${cashStatus(cash.diff)})`, signed(cash.diff)) + ESCPOS.boldOff;
  } else out += `ยังไม่มีกะที่ปิด · ขายเงินสด ${money(report.cash.cashSales)}\n`;
  if (cash.openShifts.length) out += `* กะ ${cash.openShifts.map((s) => `#${s.id}`).join(", ")} ยังไม่ปิด ไม่นับรวม\n`;

  out += section("รายละเอียดกะ");
  if (!report.shifts.length) out += "ไม่มีข้อมูลกะ\n";
  report.shifts.forEach((s) => {
    out += ESCPOS.boldOn + `กะ #${s.id}` + ESCPOS.boldOff + (s.closedAt ? "" : " (ยังเปิดอยู่)") + "\n";
    out += row(`  เปิด ${shiftTime(s.openedAt, report.date)}`, s.userName);
    out += row(`  ปิด ${shiftTime(s.closedAt, report.date)}`, s.closedAt ? s.closedByName || "-" : "-");
    out += row("  เงินเปิดกะ", money(s.openingCash));
    out += row("  ยอดขาย", `${num(s.totalOrders)} บิล  ${money(s.totalSales)}`);
    out += row("  เงินนับ", s.closingCash == null ? "-" : money(s.closingCash));
    if (s.difference != null) out += row("  ส่วนต่าง", signed(s.difference));
    if (s.note) out += `  * ${s.note}\n`;
  });

  out += section("เมนูขายดี");
  if (!report.topItems.length) out += "ไม่มีข้อมูลสินค้า\n";
  report.topItems.slice(0, TOP_ITEM_LIMIT).forEach((item, i) => { out += row(`${i + 1}. ${item.name}`, `${num(item.qty)}  ${money(item.revenue)}`); });

  out += section("หมายเหตุยอด");
  out += row("ยกเลิก", `${num(report.totals.cancelledOrders)} บิล`);
  out += row("คืนเงิน", `${num(report.totals.refundedOrders)} บิล`);
  out += row("ใช้แต้มสะสม", `${num(report.totals.loyaltyPointsUsed)} แต้ม`);

  out += "\n\n\n" + ESCPOS.alignCenter + "-".repeat(Math.round(cols * 0.6)) + "\nผู้ส่งยอด\n\n\n";
  out += "-".repeat(Math.round(cols * 0.6)) + "\nผู้รับยอด\n\n\n\n" + ESCPOS.cut;
  return out;
}

export function createDailySummaryJob(report: DailyCloseReport, branchId: number): ReceiptPrintJob {
  const widthMm = getPaperWidth();
  return {
    id: crypto.randomUUID(),
    branchId,
    billId: `สรุป-${report.date}`,
    title: `ใบสรุปส่งยอด ${thaiDate(report.date)}`,
    html: buildDailySummaryHtml(report, widthMm),
    documents: [buildDailySummaryHtml(report, widthMm, true)],
    labels: ["ใบสรุปส่งยอด"],
    escpos: buildDailySummaryEscPos(report, widthMm),
    widthMm,
    createdAt: Date.now()
  };
}
