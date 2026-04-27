import { useBranch } from "../contexts/BranchContext";
import type { CartItem, DiscountRule, Order } from "../types";

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

function padRight(s: string, len: number) {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number) {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

export function printReceipt(data: ReceiptData, branchName: string) {
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
  const receiptHtml = lines.map(l => `<div>${l || "&nbsp;"}</div>`).join("\n");

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
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=360,height=600");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

type CashDrawerProps = {
  total: number;
  onConfirm: (cashReceived: number, change: number) => void;
  onCancel: () => void;
};

const QUICK_AMOUNTS = [20, 50, 100, 500, 1000];

export function CashDrawerModal({ total, onConfirm, onCancel }: CashDrawerProps) {
  const [received, setReceived] = useState("");
  const receivedNum = Number(received) || 0;
  const change = Math.max(0, receivedNum - total);
  const isValid = receivedNum >= total;

  return (
    <div className="modal-backdrop" onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div className="panel" onClick={e => e.stopPropagation()} style={{ width: "420px", padding: "32px", borderRadius: "16px" }}>
        <h2 style={{ marginBottom: "8px" }}>💰 รับเงินสด</h2>
        <p className="muted" style={{ marginBottom: "24px" }}>ยอดที่ต้องชำระ: <strong style={{ color: "var(--accent)", fontSize: "20px" }}>฿{formatMoney(total)}</strong></p>

        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={received}
          onChange={e => setReceived(e.target.value)}
          placeholder="จำนวนเงินที่รับ"
          autoFocus
          style={{ width: "100%", fontSize: "24px", padding: "16px", textAlign: "center", marginBottom: "16px" }}
          onKeyDown={e => { if (e.key === "Enter" && isValid) onConfirm(receivedNum, change); }}
        />

        <div style={{ display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
          {QUICK_AMOUNTS.map(amt => (
            <button key={amt} className="btn btn--ghost" style={{ flex: 1, minWidth: "60px" }}
              onClick={() => setReceived(String(amt))}
            >
              ฿{amt}
            </button>
          ))}
          <button className="btn btn--ghost" style={{ flex: 1, minWidth: "60px" }}
            onClick={() => setReceived(String(total))}
          >
            พอดี
          </button>
        </div>

        <div style={{ background: "var(--bg-alt)", padding: "20px", borderRadius: "12px", textAlign: "center", marginBottom: "24px" }}>
          <p className="muted" style={{ margin: 0 }}>เงินทอน</p>
          <strong style={{ fontSize: "36px", color: isValid ? "var(--accent)" : "#b5482b" }}>
            ฿{formatMoney(change)}
          </strong>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          <button className="btn btn--ghost" onClick={onCancel} style={{ flex: 1, padding: "14px" }}>ยกเลิก</button>
          <button className="btn btn--primary" onClick={() => onConfirm(receivedNum, change)} disabled={!isValid} style={{ flex: 2, padding: "14px", fontSize: "16px" }}>
            ✅ ยืนยันรับเงิน (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
