import { useState } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "../../utils/useDialogFocus";

// Cancelling or refunding a bill moves money and stock: make it a deliberate two-step
// action with a written reason instead of one tap on a red button.

const QUICK_REASONS = ["ลูกค้ายกเลิก", "คีย์ผิด / สั่งซ้ำ", "ของหมด ทำให้ไม่ได้", "ลูกค้าไม่พอใจสินค้า"];

export default function ConfirmReasonDialog({ title, detail, confirmLabel, busy, onConfirm, onClose }: {
  title: string;
  detail: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const ref = useDialogFocus(() => !busy && onClose());
  const [reason, setReason] = useState("");
  const ready = reason.trim().length > 0 && !busy;

  return <div className="stk-backdrop stk-backdrop--center" onClick={() => !busy && onClose()}>
    <div ref={ref} className="stk-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-reason-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
      <div className="stk-drawer__head">
        <div><span className="stk-eyebrow">ยืนยันก่อนทำรายการ</span><h3 id="confirm-reason-title">{title}</h3></div>
        <button className="studio-icon-button" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
      </div>
      <p className="stk-hint" style={{ whiteSpace: "pre-line", fontSize: 14 }}>{detail}</p>
      <label style={{ display: "grid", gap: 6 }}>
        <strong style={{ fontSize: 14 }}>เหตุผล (จำเป็น)</strong>
        <textarea className="input" rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้ายกเลิก" disabled={busy} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {QUICK_REASONS.map((r) => <button key={r} type="button" className="btn btn--ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setReason(r)} disabled={busy}>{r}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button className="btn btn--ghost" onClick={onClose} disabled={busy}>ไม่ใช่ กลับไป</button>
        <button className="btn btn--danger" onClick={() => ready && onConfirm(reason.trim())} disabled={!ready}>{busy ? "กำลังบันทึก..." : confirmLabel}</button>
      </div>
    </div>
  </div>;
}
