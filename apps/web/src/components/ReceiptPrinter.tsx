import { useState } from "react";
import type { CartItem, DiscountRule, Order, StoreSetting } from "../types";
import Numpad from "./ui/Numpad";
import { logoUrl } from "./BrandLogo";
import { isNativePrintAvailable, sendReceiptToNative } from "../utils/nativePrinter";
import { isRawbtEnabled, sendRawbtText } from "../utils/rawbtPrinter";

type ReceiptData = {
  order: Order;
  cart: CartItem[];
  discountRules: DiscountRule[];
  subtotal: number;
  discountAmount: number;
  total: number;
  pointsUsed: number;
  paymentMethod: string;
  cashReceived?: number;
  changeAmount?: number;
  storeSetting?: StoreSetting | null;
  copies?: number;
  copyLabels?: string[];
};

function formatMoney(v: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(v);
}

function formatMoney2(v: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function paymentLabel(method: string) {
  if (method === "CASH") return "เงินสด";
  if (method === "QR") return "QR / โอนเงิน";
  if (method === "CARD") return "บัตรเครดิต/เดบิต";
  return "e-Wallet";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSlip(data: ReceiptData, branchName: string, copyLabel?: string) {
  const ss = data.storeSetting ?? null;
  const shopName = escapeHtml(ss?.shopName?.trim() || "Big B Coffee");
  const hasTaxId = Boolean(ss?.taxId?.trim());
  const now = new Date();
  const dateStr = now.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

  const sub: string[] = [];
  if (ss?.branchLabel?.trim()) sub.push(escapeHtml(ss.branchLabel.trim()));
  if (ss?.addressLine?.trim()) sub.push(escapeHtml(ss.addressLine.trim()));
  if (ss?.phone?.trim()) sub.push("โทร. " + escapeHtml(ss.phone.trim()));
  if (hasTaxId) sub.push("เลขภาษี " + escapeHtml(ss!.taxId.trim()));
  if (ss?.receiptHeader?.trim()) sub.push(escapeHtml(ss.receiptHeader.trim()));

  const itemsHtml = data.cart.map((item) => {
    const modTotal = item.modifiers.reduce((s, m) => s + (m.price || 0), 0);
    const unit = item.basePrice + modTotal;
    const line = unit * item.qty;
    const parts = [`x${item.qty} @ ${formatMoney(unit)}`];
    const mods = item.modifiers.map((m) => escapeHtml(m.value)).filter(Boolean).join(" · ");
    if (mods) parts.push(mods);
    if (item.note) parts.push(escapeHtml(item.note));
    return `<div class="r-item">
      <div class="r-item-top"><span class="r-item-name">${escapeHtml(item.name)}</span><span>${formatMoney(line)}</span></div>
      <div class="r-item-sub">${parts.join(" · ")}</div>
    </div>`;
  }).join("");

  const rows: string[] = [`<div class="r-row"><span>ยอดรวม</span><span>${formatMoney(data.subtotal)}</span></div>`];
  if (data.discountAmount > 0) rows.push(`<div class="r-row"><span>ส่วนลด</span><span>-${formatMoney(data.discountAmount)}</span></div>`);
  if (data.pointsUsed > 0) rows.push(`<div class="r-row"><span>แลกแต้ม</span><span>-${formatMoney(data.pointsUsed)}</span></div>`);

  const vatMode = ss?.vatMode ?? "INCLUSIVE";
  const vatRate = ss?.vatRate ?? 0;
  let vatHtml = "";
  if (vatMode !== "NONE" && vatRate > 0 && data.total > 0) {
    const vat = Math.round((data.total * vatRate / (100 + vatRate)) * 100) / 100;
    const base = Math.round((data.total - vat) * 100) / 100;
    vatHtml = `<div class="r-row r-muted"><span>มูลค่าสินค้า</span><span>${formatMoney2(base)}</span></div>` +
      `<div class="r-row r-muted"><span>VAT ${vatRate}%</span><span>${formatMoney2(vat)}</span></div>`;
  }

  let payHtml = `<div class="r-row"><span>ชำระโดย</span><span>${paymentLabel(data.paymentMethod)}</span></div>`;
  if (data.cashReceived != null && data.changeAmount != null) {
    payHtml += `<div class="r-row"><span>รับเงิน</span><span>${formatMoney(data.cashReceived)}</span></div>` +
      `<div class="r-row"><span>เงินทอน</span><span>${formatMoney(data.changeAmount)}</span></div>`;
  }

  const copyHtml = copyLabel ? `<div class="r-copy">${escapeHtml(copyLabel)}</div>` : "";
  const title = hasTaxId ? "ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ" : "ใบเสร็จรับเงิน";
  const footer = escapeHtml(ss?.receiptFooter?.trim() || "ขอบคุณที่ใช้บริการ");

  return `
    <img class="r-logo" src="${escapeHtml(logoUrl)}" alt="" />
    <div class="r-shop">${shopName}</div>
    <div class="r-sub">${escapeHtml(branchName)}</div>
    ${sub.map((s) => `<div class="r-sub">${s}</div>`).join("")}
    <div class="r-title">${title}</div>
    ${copyHtml}
    <div class="r-meta"><span>บิล #${data.order.id}</span><span>${dateStr} ${timeStr}</span></div>
    <div class="r-div"></div>
    ${itemsHtml}
    <div class="r-div"></div>
    ${rows.join("")}
    <div class="r-total"><span>ยอดสุทธิ</span><span>฿${formatMoney(data.total)}</span></div>
    ${vatHtml}
    <div class="r-div"></div>
    ${payHtml}
    <div class="r-foot">${footer}<br/>${shopName}</div>
  `;
}

function printWhenReady(printWindow: Window, printDocument: Document) {
  const images = Array.from(printDocument.images);
  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 50);
  };

  const pending = images.filter((image) => !image.complete);
  if (pending.length === 0) {
    doPrint();
    return;
  }

  let remaining = pending.length;
  const markDone = () => {
    remaining -= 1;
    if (remaining <= 0) doPrint();
  };
  pending.forEach((image) => {
    image.addEventListener("load", markDone, { once: true });
    image.addEventListener("error", markDone, { once: true });
  });
  window.setTimeout(doPrint, 700);
}

// ─── ESC/POS plain-text receipt (for RawBT → Bluetooth printers) ────────────
// RawBT relays raw bytes to the printer and converts UTF-8 Thai to its code
// page, so we render the receipt as a 58mm (32-column) ESC/POS text slip.
const ESC = "\x1B";
const GS = "\x1D";
const ESCPOS = {
  init: ESC + "@",
  alignLeft: ESC + "a" + "\x00",
  alignCenter: ESC + "a" + "\x01",
  boldOn: ESC + "E" + "\x01",
  boldOff: ESC + "E" + "\x00",
  doubleOn: GS + "!" + "\x11",
  doubleOff: GS + "!" + "\x00",
  cut: GS + "V" + "\x42" + "\x00"
};
const RECEIPT_COLS = 32;

// Thai vowels/tone marks stack on the base glyph → zero printed columns.
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const zeroWidth = code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e);
    if (!zeroWidth) width += 1;
  }
  return width;
}

function padRow(left: string, right: string, cols = RECEIPT_COLS): string {
  const rightWidth = displayWidth(right);
  let leftStr = left;
  while (displayWidth(leftStr) + rightWidth + 1 > cols && leftStr.length > 0) {
    leftStr = leftStr.slice(0, -1);
  }
  const gap = Math.max(1, cols - displayWidth(leftStr) - rightWidth);
  return leftStr + " ".repeat(gap) + right;
}

function escposSlip(data: ReceiptData, branchName: string, copyLabel?: string): string {
  const ss = data.storeSetting ?? null;
  const shopName = ss?.shopName?.trim() || "Big B Coffee";
  const hasTaxId = Boolean(ss?.taxId?.trim());
  const now = new Date();
  const dateStr = now.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  const div = "-".repeat(RECEIPT_COLS) + "\n";

  let out = ESCPOS.init + ESCPOS.alignCenter;
  out += ESCPOS.doubleOn + shopName + ESCPOS.doubleOff + "\n";
  out += branchName + "\n";
  if (ss?.branchLabel?.trim()) out += ss.branchLabel.trim() + "\n";
  if (ss?.addressLine?.trim()) out += ss.addressLine.trim() + "\n";
  if (ss?.phone?.trim()) out += "โทร. " + ss.phone.trim() + "\n";
  if (hasTaxId) out += "เลขภาษี " + ss!.taxId.trim() + "\n";
  if (ss?.receiptHeader?.trim()) out += ss.receiptHeader.trim() + "\n";
  out += (hasTaxId ? "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" : "ใบเสร็จรับเงิน") + "\n";
  if (copyLabel) out += "[" + copyLabel + "]\n";

  out += ESCPOS.alignLeft;
  out += padRow("บิล #" + data.order.id, dateStr + " " + timeStr) + "\n" + div;

  for (const item of data.cart) {
    const modTotal = item.modifiers.reduce((s, m) => s + (m.price || 0), 0);
    const unit = item.basePrice + modTotal;
    out += padRow(item.name, formatMoney(unit * item.qty)) + "\n";
    let detail = "  x" + item.qty + " @ " + formatMoney(unit);
    const mods = item.modifiers.map((m) => m.value).filter(Boolean).join(" ");
    if (mods) detail += " " + mods;
    out += detail + "\n";
    if (item.note) out += "  * " + item.note + "\n";
  }

  out += div;
  out += padRow("ยอดรวม", formatMoney(data.subtotal)) + "\n";
  if (data.discountAmount > 0) out += padRow("ส่วนลด", "-" + formatMoney(data.discountAmount)) + "\n";
  if (data.pointsUsed > 0) out += padRow("แลกแต้ม", "-" + formatMoney(data.pointsUsed)) + "\n";
  out += ESCPOS.boldOn + padRow("ยอดสุทธิ", "฿" + formatMoney(data.total)) + ESCPOS.boldOff + "\n";

  const vatMode = ss?.vatMode ?? "INCLUSIVE";
  const vatRate = ss?.vatRate ?? 0;
  if (vatMode !== "NONE" && vatRate > 0 && data.total > 0) {
    const vat = Math.round((data.total * vatRate / (100 + vatRate)) * 100) / 100;
    const base = Math.round((data.total - vat) * 100) / 100;
    out += padRow("มูลค่าสินค้า", formatMoney2(base)) + "\n";
    out += padRow("VAT " + vatRate + "%", formatMoney2(vat)) + "\n";
  }

  out += div;
  out += padRow("ชำระโดย", paymentLabel(data.paymentMethod)) + "\n";
  if (data.cashReceived != null && data.changeAmount != null) {
    out += padRow("รับเงิน", formatMoney(data.cashReceived)) + "\n";
    out += padRow("เงินทอน", formatMoney(data.changeAmount)) + "\n";
  }

  out += "\n" + ESCPOS.alignCenter;
  out += (ss?.receiptFooter?.trim() || "ขอบคุณที่ใช้บริการ") + "\n";
  out += shopName + "\n\n\n";
  return out;
}

export function buildReceiptEscPos(data: ReceiptData, branchName: string): string {
  const copies = Math.max(1, Math.floor(data.copies ?? 1));
  const labels = data.copyLabels ?? [];
  let out = "";
  for (let i = 0; i < copies; i++) {
    out += escposSlip(data, branchName, labels[i]) + ESCPOS.cut;
  }
  return out;
}

export function printReceipt(data: ReceiptData, branchName: string, targetWindow?: Window | null) {
  const copies = Math.max(1, Math.floor(data.copies ?? 1));
  const labels = data.copyLabels ?? [];
  const slips: string[] = [];
  for (let i = 0; i < copies; i++) {
    const breakClass = i < copies - 1 ? " r-slip--break" : "";
    slips.push(`<div class="r-slip${breakClass}">${renderSlip(data, branchName, labels[i])}</div>`);
  }

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>Receipt #${data.order.id}</title>
  <style>
    @page { margin: 0; size: 58mm auto; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: 'IBM Plex Sans Thai', 'Sarabun', 'Prompt', sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .r-slip { width: 58mm; padding: 4mm 2mm 7mm; }
    .r-slip--break { page-break-after: always; }
    .r-logo { display: block; width: 18mm; height: auto; margin: 0 auto 1mm; image-rendering: auto; }
    .r-shop { text-align: center; font-size: 18px; font-weight: 700; line-height: 1.2; }
    .r-sub { text-align: center; font-size: 11px; line-height: 1.35; }
    .r-title { text-align: center; font-size: 12px; font-weight: 700; margin-top: 2mm; }
    .r-copy { text-align: center; font-size: 13px; font-weight: 800; border: 1.5px solid #000; border-radius: 4px; padding: 1mm 0; margin: 1.5mm 0 0; letter-spacing: 1px; }
    .r-meta { display: flex; justify-content: space-between; font-size: 11px; margin-top: 1.5mm; }
    .r-div { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .r-item { margin: 1.2mm 0; }
    .r-item-top { display: flex; justify-content: space-between; gap: 6px; font-size: 13px; font-weight: 600; }
    .r-item-name { overflow-wrap: anywhere; }
    .r-item-sub { font-size: 10.5px; color: #333; margin-top: 0.3mm; }
    .r-row { display: flex; justify-content: space-between; font-size: 12.5px; line-height: 1.5; }
    .r-muted { color: #444; font-size: 11px; }
    .r-total { display: flex; justify-content: space-between; align-items: center; font-size: 18px; font-weight: 800; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 1.2mm 0; margin: 1.2mm 0; }
    .r-foot { text-align: center; font-size: 11px; margin-top: 3mm; line-height: 1.5; }
    @media screen { body { background: #f3f4f6; } .r-slip { background: #fff; margin: 12px auto; box-shadow: 0 1px 6px rgba(0,0,0,0.15); } }
  </style>
</head>
<body>${slips.join("")}</body>
</html>`;

  // Native iOS wrapper present → hand the rendered receipt HTML to the Star
  // printer SDK (USB) instead of the browser's AirPrint-only window.print().
  // The native side rasterises this exact HTML, so Thai text prints perfectly.
  if (isNativePrintAvailable()) {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const sent = sendReceiptToNative({ type: "receipt", html, widthMm: 58, copies, baseUrl, billId: data.order.id });
    if (sent) {
      targetWindow?.close();
      return true;
    }
  }

  // Android + Bluetooth printer: hand the receipt to RawBT as ESC/POS text. The
  // OS-paired BT printer is invisible to the browser, so window.print() can't see
  // it — RawBT is the bridge. Falls through to the normal path if the hand-off
  // can't be attempted (e.g. not actually on Android).
  if (isRawbtEnabled()) {
    const sent = sendRawbtText(buildReceiptEscPos(data, branchName));
    if (sent) {
      targetWindow?.close();
      return true;
    }
  }

  if (targetWindow) {
    try {
      targetWindow.document.open();
      targetWindow.document.write(html);
      targetWindow.document.close();
      printWhenReady(targetWindow, targetWindow.document);
      targetWindow.onafterprint = () => targetWindow.close();
      return true;
    } catch {
      // If writing to the pre-opened window fails, fall through to the iframe method.
    }
  }

  const iframe = document.createElement("iframe");
  iframe.title = "Receipt print frame";
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument ?? frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    return false;
  }

  const cleanup = () => iframe.remove();
  frameWindow.onafterprint = cleanup;
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
  printWhenReady(frameWindow, frameDocument);
  window.setTimeout(cleanup, 60_000);
  return true;
}

type CashDrawerProps = {
  total: number;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onConfirm: (cashReceived: number, change: number) => void | Promise<void>;
  onCancel: () => void;
};

const QUICK_AMOUNTS = [20, 50, 100, 500, 1000];

export function CashDrawerModal({ total, isSubmitting = false, errorMessage = null, onConfirm, onCancel }: CashDrawerProps) {
  const [received, setReceived] = useState("");
  const receivedNum = Number(received) || 0;
  const change = Math.max(0, receivedNum - total);
  const isValid = receivedNum >= total;
  const submitPayment = () => {
    if (!isValid || isSubmitting) return;
    onConfirm(receivedNum, change);
  };

  return (
    <div
      className="modal-backdrop modal-backdrop--scroll"
      onClick={() => { if (!isSubmitting) onCancel(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 9999, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "16px" }}
    >
      <div className="panel cash-modal" onClick={e => e.stopPropagation()} style={{ width: "min(420px, calc(100vw - 32px))", margin: "auto", background: "var(--bg-surface)" }}>
        <h2 className="cash-modal__title">💰 รับเงินสด</h2>
        <p className="muted cash-modal__total">ยอดที่ต้องชำระ: <strong>฿{formatMoney(total)}</strong></p>

        <div className="cash-modal__quick">
          {QUICK_AMOUNTS.map(amt => (
            <button key={amt} className="btn btn--ghost"
              disabled={isSubmitting}
              onClick={() => setReceived(String(amt))}
            >
              ฿{amt}
            </button>
          ))}
          <button className="btn btn--ghost"
            disabled={isSubmitting}
            onClick={() => setReceived(String(total))}
          >
            พอดี
          </button>
        </div>

        <input
          className="input cash-modal__display"
          type="text"
          readOnly
          value={received}
          placeholder="จำนวนเงินที่รับ"
        />

        <Numpad
          value={received}
          onChange={setReceived}
          onEnter={submitPayment}
          enterLabel="ยืนยันรับเงิน"
        />

        <div className="cash-modal__change">
          <p className="muted">เงินทอน</p>
          <strong className={isValid ? "is-ok" : "is-low"}>
            ฿{formatMoney(change)}
          </strong>
        </div>

        {errorMessage && (
          <div role="alert" style={{ margin: "4px 0 12px", padding: "10px 12px", borderRadius: 8, background: "#fef3f2", border: "1px solid #fda29b", color: "#b42318", fontSize: 14, lineHeight: 1.45 }}>
            ⚠️ ชำระเงินไม่สำเร็จ: {errorMessage}
          </div>
        )}
        <div className="cash-modal__actions">
          <button className="btn btn--ghost btn--full" onClick={onCancel} disabled={isSubmitting}>ยกเลิก</button>
          <button className="btn btn--primary btn--full" onClick={submitPayment} disabled={!isValid || isSubmitting}>
            {isSubmitting ? "กำลังบันทึก..." : "รับเงินและพิมพ์ใบเสร็จ"}
          </button>
        </div>
      </div>
    </div>
  );
}
