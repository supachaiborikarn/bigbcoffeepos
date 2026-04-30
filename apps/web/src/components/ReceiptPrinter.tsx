import { useState } from "react";
import type { CartItem, DiscountRule, Order } from "../types";
import Numpad from "./ui/Numpad";

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
};

function formatMoney(v: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(v);
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

export function printReceipt(data: ReceiptData, branchName: string, targetWindow?: Window | null) {
  const W = 32; // 80mm thermal ≈ 32 chars
  const LINE = "─".repeat(W);
  const DLINE = "═".repeat(W);

  const now = new Date();
  const dateStr = now.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

  const lines: string[] = [];
  const add = (s: string) => lines.push(s);
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((W - s.length) / 2));
    add(" ".repeat(pad) + s);
  };

  center("☕ Big B Coffee");
  center(branchName);
  add(LINE);
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
  add("");

  const methodLabel = data.paymentMethod === "CASH" ? "เงินสด" : data.paymentMethod === "QR" ? "โอนเงิน" : data.paymentMethod === "CARD" ? "บัตรเครดิต" : "E-Wallet";
  add(`ชำระ: ${methodLabel}`);

  if (data.cashReceived && data.changeAmount !== undefined) {
    add(`รับเงิน: ${formatMoney(data.cashReceived)}`);
    add(`เงินทอน: ${formatMoney(data.changeAmount)}`);
  }

  add(LINE);
  center("ขอบคุณที่อุดหนุนค่ะ 🙏");
  center("Big B Coffee");
  add("");

  // Build print HTML
  const receiptHtml = lines.map(l => `<div>${l ? escapeHtml(l) : "&nbsp;"}</div>`).join("\n");

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>Receipt #${data.order.id}</title>
  <style>
    @page { margin: 0; size: 80mm auto; }
    body {
      margin: 0; padding: 8px;
      font-family: 'Courier New', monospace;
      font-size: 12px; line-height: 1.4;
      width: 80mm;
    }
    div { white-space: pre; }
    @media screen {
      body { max-width: 320px; margin: 20px auto; border: 1px dashed #ccc; padding: 16px; background: #fff; }
    }
  </style>
</head>
<body>
${receiptHtml}
</body>
</html>`;

  if (targetWindow) {
    targetWindow.document.write(html);
    targetWindow.document.close();
    window.setTimeout(() => {
      targetWindow.focus();
      targetWindow.print();
      targetWindow.onafterprint = () => targetWindow.close();
    }, 50);
    return true;
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
  window.setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, 50);
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
