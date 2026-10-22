// ─── Shift close slip ("รายงานปิดกะ / Z Report") for thermal printers ─────
// Same pipeline as the daily summary: a ReceiptPrintJob that goes through
// PrintCenter, so it follows the device's printer mode and the 58 / 80 mm
// paper width instead of printing the main page at a fixed 80 mm.
import type { ShiftSummary } from "../types";
import type { ReceiptPrintJob } from "./printJob";
import { getPaperWidth, PAPER_SPECS } from "./printerSettings";
import { ESCPOS, padRow } from "../components/ReceiptPrinter";

export type PrintableShiftSummary = ShiftSummary & {
  cashCountLines?: Array<{ denomination: number; count: number; total: number }>;
  closingNote?: string;
};

const PAYMENT_LABELS: Record<string, string> = { CASH: "เงินสด", QR: "QR", CARD: "บัตร", EWALLET: "E-Wallet" };

const moneyFormatter = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (v: number) => `${v < 0 ? "-" : ""}฿${moneyFormatter.format(Math.abs(v))}`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${money(v)}`;
const num = (v: number) => v.toLocaleString("th-TH");
const thaiDateTime = (value?: string | null) => value ? new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }) : "-";
const duration = (m: number) => Math.floor(m / 60) > 0 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m % 60} นาที`;
const cashStatus = (diff: number) => diff === 0 ? "ตรงยอด" : diff < 0 ? "เงินขาด" : "เงินเกิน";

function esc(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function noteOf(s: PrintableShiftSummary) {
  return s.closingNote ?? s.closeDetails?.note ?? "";
}

/** `device` = rendered by a printer bridge at the roll's printable width (fills 100%). */
export function buildShiftSummaryHtml(s: PrintableShiftSummary, widthMm: 58 | 80 = getPaperWidth(), device = false, printedAt = new Date().toISOString()) {
  const wide = widthMm === 80;
  const spec = PAPER_SPECS[widthMm];
  const row = (label: string, value: string, cls = "") => `<div class="row ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  const diff = s.cash.difference ?? 0;
  const note = noteOf(s);
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>รายงานปิดกะ #${esc(s.shift.id)}</title>
<style>
  @page { margin: 0; size: ${widthMm}mm auto; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  ${device ? "" : `body { width: ${widthMm}mm; }`}
  body { font-family: 'IBM Plex Sans Thai', 'Sarabun', 'Tahoma', sans-serif; color: #000; font-size: ${wide ? 12.5 : 10.5}px; line-height: 1.38; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-variant-numeric: tabular-nums; }
  .slip { width: ${device ? "100%" : `${spec.printableMm}mm`}; margin: 0 auto; padding: ${device ? `0 ${spec.gutterMm}mm 6mm` : `3mm ${spec.gutterMm}mm 9mm`}; overflow-wrap: anywhere; }
  p { margin: 0; }
  .head { text-align: center; }
  .branch { font-size: 1.35em; font-weight: 800; line-height: 1.25; }
  .doc { display: inline-block; margin: 1.2mm 0 1.4mm; padding: 0.5mm 3mm; border: 1.5px solid #000; border-radius: 3px; font-weight: 800; }
  .meta { font-size: 0.88em; }
  .hero { text-align: center; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 1.6mm 0 1.8mm; margin: 2.4mm 0 2mm; }
  .hero span { display: block; font-size: 0.92em; font-weight: 600; }
  .hero strong { display: block; font-size: ${wide ? 2.2 : 1.9}em; font-weight: 800; line-height: 1.15; }
  h2 { font-size: 1em; font-weight: 800; margin: 3.2mm 0 1mm; padding-bottom: 0.6mm; border-bottom: 1.5px solid #000; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; padding: 0.35mm 0; }
  .row span { min-width: 0; overflow-wrap: anywhere; }
  .row b { white-space: nowrap; text-align: right; }
  .row.strong { font-weight: 800; border-top: 1px dashed #000; margin-top: 0.8mm; padding-top: 1mm; }
  .row.sub { font-size: 0.9em; padding-left: 2mm; }
  .boxed { border: 1.5px solid #000; border-radius: 3px; padding: 1mm 1.6mm; margin-top: 1.2mm; font-size: 1.08em; }
  .note { font-size: 0.92em; overflow-wrap: anywhere; }
  .sign { text-align: center; border-top: 1px solid #000; padding-top: 1mm; margin-top: 12mm; font-size: 0.9em; }
  .foot { text-align: center; font-size: 0.84em; margin-top: 4mm; }
  ${device ? "" : `@media screen { body { background: #eceef0; padding: 12px 0; width: auto; } .slip { margin: 0 auto; background: #fff; box-shadow: 0 2px 10px #0002; outline: 1px dashed #bbb; outline-offset: ${(widthMm - spec.printableMm) / 2}mm; } }`}
</style>
</head>
<body><div class="slip">
  <div class="head">
    <p class="branch">${esc(s.branch.name)}</p>
    <p class="doc">รายงานปิดกะ #${esc(s.shift.id)}</p>
    <p class="meta">พิมพ์ ${esc(thaiDateTime(printedAt))}</p>
  </div>

  <div class="hero"><span>ยอดขายรวม</span><strong>${money(s.totals.totalSales)}</strong></div>
  ${row("จำนวนบิล", num(s.totals.totalOrders))}
  ${row("เฉลี่ย/บิล", money(s.totals.averageTicket))}
  ${row("ส่วนลด", money(s.totals.discountAmount))}

  <h2>กะ</h2>
  ${row("เปิด", thaiDateTime(s.openedAt))}
  ${row("ผู้เปิดกะ", s.user?.name ?? "-")}
  ${row("ปิด", thaiDateTime(s.closedAt))}
  ${row("ผู้ปิดกะ", s.closeDetails?.closedBy?.name ?? "-")}
  ${row("ระยะเวลา", duration(s.durationMinutes))}

  <h2>ช่องทางชำระเงิน</h2>
  ${s.payments.length ? s.payments.map((p) => row(PAYMENT_LABELS[p.method] ?? p.method, money(p.total))).join("") : `<p class="note">ไม่มีข้อมูลชำระเงิน</p>`}

  <h2>สรุปเงินสด</h2>
  ${row("เงินต้นกะ", money(s.cash.openingCash))}
  ${row("เงินสดรับ", money(s.cash.cashSales))}
  ${row("จ่ายออกจากลิ้นชัก", money(-(s.cash.paidOut ?? 0)))}
  ${(s.cash.paidIn ?? 0) > 0 ? row("เติมเข้าลิ้นชัก", `+${money(s.cash.paidIn ?? 0)}`) : ""}
  ${(s.cash.entries ?? []).map((e) => row(`· ${e.category}${e.note ? ` (${e.note})` : ""}`, `${e.type === "OUT" ? "-" : "+"}${money(e.amount)}`, "sub")).join("")}
  ${row("เงินสดที่ควรมี", money(s.cash.expectedCash), "strong")}
  ${row("นับเงินจริง", money(s.cash.closingCash ?? 0))}
  <div class="row boxed"><span><b>ส่วนต่าง · ${cashStatus(diff)}</b></span><b>${signed(diff)}</b></div>

  ${s.cashCountLines?.length ? `<h2>รายละเอียดเงินสด</h2>
  ${s.cashCountLines.map((l) => row(`${money(l.denomination)} x ${num(l.count)}`, money(l.total))).join("")}` : ""}

  ${note ? `<h2>หมายเหตุ</h2><p class="note">${esc(note)}</p>` : ""}

  <div class="sign">ลงชื่อผู้ปิดกะ</div>
  <p class="foot">Big B Coffee POS</p>
</div></body>
</html>`;
}

/** Plain ESC/POS text version for RawBT (48 columns on 80 mm, 32 on 58 mm). */
export function buildShiftSummaryEscPos(s: PrintableShiftSummary, widthMm: 58 | 80 = getPaperWidth(), printedAt = new Date().toISOString()) {
  const cols = widthMm === 80 ? 48 : 32;
  const row = (left: string, right: string) => padRow(left, right, cols) + "\n";
  const div = "-".repeat(cols) + "\n";
  const section = (title: string) => "\n" + ESCPOS.boldOn + title + ESCPOS.boldOff + "\n" + div;
  const diff = s.cash.difference ?? 0;
  const note = noteOf(s);

  let out = ESCPOS.init + ESCPOS.alignCenter;
  out += ESCPOS.boldOn + s.branch.name + ESCPOS.boldOff + "\n";
  out += `รายงานปิดกะ #${s.shift.id}\n`;
  out += `พิมพ์ ${thaiDateTime(printedAt)}\n`;
  out += ESCPOS.alignLeft + div;
  out += ESCPOS.alignCenter + "ยอดขายรวม\n" + ESCPOS.doubleOn + money(s.totals.totalSales) + ESCPOS.doubleOff + "\n" + ESCPOS.alignLeft + div;
  out += row("จำนวนบิล", num(s.totals.totalOrders));
  out += row("เฉลี่ย/บิล", money(s.totals.averageTicket));
  out += row("ส่วนลด", money(s.totals.discountAmount));

  out += section("กะ");
  out += row("เปิด", thaiDateTime(s.openedAt));
  out += row("ผู้เปิดกะ", s.user?.name ?? "-");
  out += row("ปิด", thaiDateTime(s.closedAt));
  out += row("ผู้ปิดกะ", s.closeDetails?.closedBy?.name ?? "-");
  out += row("ระยะเวลา", duration(s.durationMinutes));

  out += section("ช่องทางชำระเงิน");
  if (!s.payments.length) out += "ไม่มีข้อมูลชำระเงิน\n";
  s.payments.forEach((p) => { out += row(PAYMENT_LABELS[p.method] ?? p.method, money(p.total)); });

  out += section("สรุปเงินสด");
  out += row("เงินต้นกะ", money(s.cash.openingCash));
  out += row("เงินสดรับ", money(s.cash.cashSales));
  out += row("จ่ายออกจากลิ้นชัก", money(-(s.cash.paidOut ?? 0)));
  if ((s.cash.paidIn ?? 0) > 0) out += row("เติมเข้าลิ้นชัก", "+" + money(s.cash.paidIn ?? 0));
  (s.cash.entries ?? []).forEach((e) => { out += row(`  ${e.category}`, `${e.type === "OUT" ? "-" : "+"}${money(e.amount)}`); });
  out += ESCPOS.boldOn + row("เงินสดที่ควรมี", money(s.cash.expectedCash)) + ESCPOS.boldOff;
  out += row("นับเงินจริง", money(s.cash.closingCash ?? 0));
  out += ESCPOS.boldOn + row(`ส่วนต่าง (${cashStatus(diff)})`, signed(diff)) + ESCPOS.boldOff;

  if (s.cashCountLines?.length) {
    out += section("รายละเอียดเงินสด");
    s.cashCountLines.forEach((l) => { out += row(`${money(l.denomination)} x ${num(l.count)}`, money(l.total)); });
  }
  if (note) out += section("หมายเหตุ") + note + "\n";

  out += "\n\n\n" + ESCPOS.alignCenter + "-".repeat(Math.round(cols * 0.6)) + "\nลงชื่อผู้ปิดกะ\n\n\n\n" + ESCPOS.cut;
  return out;
}

export function createShiftSummaryJob(summary: PrintableShiftSummary, branchId: number): ReceiptPrintJob {
  const widthMm = getPaperWidth();
  const printedAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    branchId,
    billId: `กะ-${summary.shift.id}`,
    title: `รายงานปิดกะ #${summary.shift.id}`,
    html: buildShiftSummaryHtml(summary, widthMm, false, printedAt),
    documents: [buildShiftSummaryHtml(summary, widthMm, true, printedAt)],
    labels: ["รายงานปิดกะ"],
    escpos: buildShiftSummaryEscPos(summary, widthMm, printedAt),
    widthMm,
    createdAt: Date.now()
  };
}
