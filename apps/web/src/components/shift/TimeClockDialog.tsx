import { useCallback, useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { closeTimeEntry, getTimeClock, punchTimeClock } from "../../api";
import type { TimeEntry } from "../../types";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useDialogFocus } from "../../utils/useDialogFocus";
import Numpad from "../ui/Numpad";

// Staff punch in/out with their own PIN on the shared POS device. The same PIN
// toggles: first punch = clock in, next = clock out. Hours appear on the day summary.

const time = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "—";
export const formatMinutes = (m: number) => `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;

export default function TimeClockDialog({ branchId, onClose }: { branchId: number; onClose: () => void }) {
  const ref = useDialogFocus(onClose);
  const toast = useToast();
  const { user } = useAuth();
  const canFix = user?.role === "admin" || user?.role === "manager";
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ action: "in" | "out"; name: string; entry: TimeEntry } | null>(null);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [fixing, setFixing] = useState<{ id: number; time: string } | null>(null);

  const load = useCallback(() => getTimeClock(branchId).then((r) => setEntries(r.items)).catch(() => setEntries([])), [branchId]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!pin || busy) return;
    setBusy(true);
    try {
      const r = await punchTimeClock(branchId, pin);
      setResult({ action: r.action, name: r.staff.name, entry: r.entry });
      setPin("");
      await load();
    } catch (err) { toast.error((err as Error).message); setPin(""); } finally { setBusy(false); }
  }

  async function fix(entry: TimeEntry) {
    if (!fixing) return;
    const [h, m] = fixing.time.split(":").map(Number);
    const out = new Date(entry.clockIn);
    out.setHours(h, m, 0, 0);
    if (out <= new Date(entry.clockIn)) out.setDate(out.getDate() + 1);
    try { await closeTimeEntry(entry.id, out.toISOString()); setFixing(null); toast.success(`ลงเวลาออกให้ ${entry.userName} แล้ว`); await load(); }
    catch (err) { toast.error((err as Error).message); }
  }

  const working = (entries ?? []).filter((e) => !e.clockOut);
  const done = (entries ?? []).filter((e) => e.clockOut);
  return <div className="stk-backdrop stk-backdrop--center" onClick={() => !busy && onClose()}>
    <div ref={ref} className="stk-dialog timeclock" role="dialog" aria-modal="true" aria-labelledby="timeclock-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
      <div className="stk-drawer__head">
        <div><span className="stk-eyebrow">พนักงาน</span><h3 id="timeclock-title">ลงเวลาเข้า / ออกงาน</h3></div>
        <button className="studio-icon-button" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
      </div>

      {result ? <div className={`timeclock-result is-${result.action}`} role="status">
        <Clock size={28} />
        <strong>{result.action === "in" ? `สวัสดี ${result.name}` : `ขอบคุณ ${result.name}`}</strong>
        <span>{result.action === "in" ? `เข้างาน ${time(result.entry.clockIn)} น.` : `ออกงาน ${time(result.entry.clockOut)} น. · ทำงาน ${formatMinutes(result.entry.minutes ?? 0)}`}</span>
        <button className="btn btn--primary" onClick={() => setResult(null)}>ลงเวลาคนถัดไป</button>
      </div> : <div className="timeclock-pin">
        <p className="stk-hint">ใส่ PIN ของตัวเอง · กดครั้งแรก = เข้างาน, กดอีกครั้ง = ออกงาน</p>
        <div className="timeclock-dots" aria-label={`ใส่แล้ว ${pin.length} หลัก`}>{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <span key={i} className={i < pin.length ? "is-filled" : ""} />)}</div>
        <Numpad value={pin} onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))} onEnter={submit} enterLabel={busy ? "กำลังบันทึก..." : "ลงเวลา"} disabled={busy} />
      </div>}

      <div className="stk-item-history">
        <h4>กำลังทำงาน ({working.length})</h4>
        {entries === null ? <p className="stk-hint">กำลังโหลด...</p> : working.length ? <ul className="stk-log">{working.map((e) => <li key={e.id} className="stk-log__row timeclock-row">
          <span className="stk-log__when">เข้า {time(e.clockIn)}</span>
          <span className="stk-log__what"><strong>{e.userName}</strong><span>{new Date(e.clockIn).toDateString() !== new Date().toDateString() ? `เข้างานตั้งแต่ ${new Date(e.clockIn).toLocaleDateString("th-TH", { day: "numeric", month: "short" })} · ลืมลงเวลาออก?` : "ยังไม่ลงเวลาออก"}</span></span>
          {canFix && (fixing?.id === e.id
            ? <span className="timeclock-fix"><input className="input" type="time" value={fixing.time} onChange={(ev) => setFixing({ id: e.id, time: ev.target.value })} aria-label="เวลาออก" /><button className="btn btn--primary" onClick={() => fix(e)}>บันทึก</button></span>
            : <button className="btn btn--ghost cash-void" onClick={() => setFixing({ id: e.id, time: new Date().toTimeString().slice(0, 5) })}>ลงเวลาออกแทน</button>)}
        </li>)}</ul> : <p className="stk-hint">ยังไม่มีใครลงเวลาเข้างาน</p>}
        {done.length > 0 && <>
          <h4 style={{ marginTop: 12 }}>ออกงานแล้ววันนี้</h4>
          <ul className="stk-log">{done.map((e) => <li key={e.id} className="stk-log__row timeclock-row"><span className="stk-log__when">{time(e.clockIn)}–{time(e.clockOut)}</span><span className="stk-log__what"><strong>{e.userName}</strong><span>{formatMinutes(e.minutes ?? 0)}{e.note ? ` · ${e.note}` : ""}</span></span></li>)}</ul>
        </>}
      </div>
    </div>
  </div>;
}
