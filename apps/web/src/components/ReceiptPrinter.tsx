import { useState } from "react";
import type { CartItem, DiscountRule, Order, StoreSetting } from "../types";
import Numpad from "./ui/Numpad";
import { logoUrl } from "./BrandLogo";

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
};

function formatMoney(v: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(v);
}

function formatMoney2(v: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function wrapText(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if ((line + " " + word).length <= width) {
      line += " " + word;
    } else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function padRight(s: string, len: number) {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number) {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function fitLine(s: string, len: number) {
  return s.length <= len ? s : s.slice(0, len);
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

export function printReceipt(data: ReceiptData, branchName: string, targetWindow?: Window | null) {
  const W = 30; // 58mm card-slip width at small thermal text
  const LINE = "─".repeat(W);
  const DLINE = "═".repeat(W);

  const now = new Date();
  const dateStr = now.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

  const lines: string[] = [];
  const add = (s: string) => lines.push(s);
  const center = (s: string) => {
    const text = fitLine(s, W);
    const pad = Math.max(0, Math.floor((W - text.length) / 2));
    add(" ".repeat(pad) + text);
  };

  const ss = data.storeSetting ?? null;
  const shopName = ss?.shopName?.trim() || "Big B Coffee";
  const hasTaxId = Boolean(ss?.taxId?.trim());

  center(shopName);
  center(branchName);
  if (ss?.branchLabel?.trim()) center(ss.branchLabel);
  if (ss?.addressLine?.trim()) wrapText(ss.addressLine, W).forEach((l) => center(l));
  if (ss?.phone?.trim()) center(`โทร. ${ss.phone.trim()}`);
  if (hasTaxId) center(`เลขภาษี ${ss!.taxId.trim()}`);
  if (ss?.receiptHeader?.trim()) wrapText(ss.receiptHeader, W).forEach((l) => center(l));
  add(LINE);
  center(hasTaxId ? "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" : "ใบเสร็จรับเงิน");
  add(`บิล #${data.order.id}`);
  add(`${dateStr} ${timeStr}`);
  add(DLINE);

  for (const item of data.cart) {
    const name = padRight(item.name, W - 12);
    const qty = `x${item.qty}`;
    const price = padLeft(`${formatMoney(item.basePrice * item.qty)}`, 8);
    add(`${name}`);
    add(`  ${qty}${padLeft(price, W - qty.length - 2)}`);
  }

  add(LINE);
  add(`${padRight("ยอดรวม", W - 10)}${padLeft(formatMoney(data.subtotal), 10)}`);

  if (data.discountAmount > 0) {
    add(`${padRight("ส่วนลด", W - 10)}${padLeft("-" + formatMoney(data.discountAmount), 10)}`);
  }
  if (data.pointsUsed > 0) {
    add(`${padRight("แลกแต้ม", W - 10)}${padLeft("-" + formatMoney(data.pointsUsed), 10)}`);
  }

  add(DLINE);
  add(`${padRight("ยอดสุทธิ", W - 10)}${padLeft(formatMoney(data.total), 10)}`);

  // VAT breakdown (embedded VAT) for abbreviated tax invoice
  const vatMode = ss?.vatMode ?? "INCLUSIVE";
  const vatRate = ss?.vatRate ?? 0;
  if (vatMode !== "NONE" && vatRate > 0 && data.total > 0) {
    const vat = Math.round((data.total * vatRate / (100 + vatRate)) * 100) / 100;
    const base = Math.round((data.total - vat) * 100) / 100;
    add(`${padRight("มูลค่าสินค้า", W - 12)}${padLeft(formatMoney2(base), 12)}`);
    add(`${padRight(`VAT ${vatRate}%`, W - 12)}${padLeft(formatMoney2(vat), 12)}`);
  }
  add("");

  const methodLabel = data.paymentMethod === "CASH" ? "เงินสด" : data.paymentMethod === "QR" ? "โอนเงิน" : data.paymentMethod === "CARD" ? "บัตรเครดิต" : "E-Wallet";
  add(`ชำระ: ${methodLabel}`);

  if (data.cashReceived && data.changeAmount !== undefined) {
    add(`รับเงิน: ${formatMoney(data.cashReceived)}`);
    add(`เงินทอน: ${formatMoney(data.changeAmount)}`);
  }

  add(LINE);
  center(ss?.receiptFooter?.trim() || "ขอบคุณที่อุดหนุนค่ะ");
  center(shopName);
  add("");

  // Build print HTML
  const receiptHtml = lines.map(l => `<div>${l ? escapeHtml(l) : "&nbsp;"}</div>`).join("\n");
  const safeLogoUrl = escapeHtml(logoUrl);

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>Receipt #${data.order.id}</title>
  <style>
    @page { margin: 0; size: 58mm auto; }
    body {
      box-sizing: border-box;
      margin: 0; padding: 3mm 2mm;
      font-family: 'Courier New', monospace;
      font-size: 10.5px; line-height: 1.35;
      width: 58mm;
    }
    .receipt-logo {
      display: block;
      width: 22mm;
      height: auto;
      margin: 0 auto 1.5mm;
      image-rendering: auto;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    div { white-space: pre; }
    @media screen {
      body { max-width: 220px; margin: 20px auto; border: 1px dashed #ccc; padding: 12px; background: #fff; }
    }
  </style>
</head>
<body>
<img class="receipt-logo" src="${safeLogoUrl}" alt="Big B Coffee" />
${receiptHtml}
</body>
</html>`;

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
  onConfirm: (cashReceived: number, change: number) => void | Promise<void>;
  onCancel: () => void;
};

const QUICK_AMOUNTS = [20, 50, 100, 500, 1000];

export function CashDrawerModal({ total, isSubmitting = false, onConfirm, onCancel }: CashDrawerProps) {
  const [received, setReceived] = useState("");
  const receivedNum = Number(received) || 0;
  const change = Math.max(0, receivedNum - total);
  const isValid = receivedNum >= total;
  const submitPayment = () => {
    if (!isValid || isSubmitting) return;
    onConfirm(receivedNum, change);
  };

  return (
    <div className="modal-backdrop" onClick={() => { if (!isSubmitting) onCancel(); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div className="panel" onClick={e => e.stopPropagation()} style={{ width: "min(420px, calc(100vw - 32px))", padding: "32px", borderRadius: "16px", background: "var(--surface)" }}>
        <h2 style={{ marginBottom: "8px" }}>💰 รับเงินสด</h2>
        <p className="muted" style={{ marginBottom: "16px" }}>ยอดที่ต้องชำระ: <strong style={{ color: "var(--accent-dark)", fontSize: "20px" }}>฿{formatMoney(total)}</strong></p>

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
          {QUICK_AMOUNTS.map(amt => (
            <button key={amt} className="btn btn--ghost" style={{ flex: 1, minWidth: "60px" }}
              disabled={isSubmitting}
              onClick={() => setReceived(String(amt))}
            >
              ฿{amt}
            </button>
          ))}
          <button className="btn btn--ghost" style={{ flex: 1, minWidth: "60px" }}
            disabled={isSubmitting}
            onClick={() => setReceived(String(total))}
          >
            พอดี
          </button>
        </div>

        <input
          className="input"
          type="text"
          readOnly
          value={received}
          placeholder="จำนวนเงินที่รับ"
          style={{ width: "100%", fontSize: "32px", padding: "16px", textAlign: "right", marginBottom: "8px", fontWeight: "bold" }}
        />

        <Numpad
          value={received}
          onChange={setReceived}
          onEnter={submitPayment}
          enterLabel="ยืนยันรับเงิน"
        />

        <div style={{ background: "var(--pos-bg)", padding: "20px", borderRadius: "12px", textAlign: "center", marginTop: "16px" }}>
          <p className="muted" style={{ margin: 0 }}>เงินทอน</p>
          <strong style={{ fontSize: "36px", color: isValid ? "var(--success)" : "#b5482b" }}>
            ฿{formatMoney(change)}
          </strong>
        </div>

        <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
          <button className="btn btn--ghost btn--full" onClick={onCancel} disabled={isSubmitting}>ยกเลิก</button>
          <button className="btn btn--primary btn--full" onClick={submitPayment} disabled={!isValid || isSubmitting}>
            {isSubmitting ? "กำลังบันทึก..." : "รับเงินและพิมพ์ใบเสร็จ"}
          </button>
        </div>
      </div>
    </div>
  );
}
