import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowUpFromLine, X } from "lucide-react";
import { addCashEntry, getCashEntries, getCashEntryCategories, getShiftSummary, voidCashEntry } from "../../api";
import type { CashEntry } from "../../types";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useDialogFocus } from "../../utils/useDialogFocus";

// Record cash taken out of (ice, deliveries, petty purchases) or put into the
// drawer during the open shift, so the close-shift count reconciles correctly.

const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 });
const QUICK = [20, 50, 100, 500];
const FALLBACK = { out: ["ซื้อของเข้าร้าน", "ค่าน้ำแข็ง", "ค่าขนส่ง", "ค่าแรง/เบิกเงิน", "ฝากธนาคาร", "อื่นๆ"], in: ["เติมเงินทอน", "อื่นๆ"] };

export default function CashDrawerDialog({ shiftId, onClose, onChanged }: { shiftId: number; onClose: () => void; onChanged?: () => void }) {
  const ref = useDialogFocus(onClose);
  const toast = useToast();
  const { user } = useAuth();
  const canVoid = user?.role === "admin" || user?.role === "manager";
  const [type, setType] = useState<"OUT" | "IN">("OUT");
  const [amount, setAmount] = useState("");
  const [categories, setCategories] = useState(FALLBACK);
  const [category, setCategory] = useState(FALLBACK.out[0]);
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<CashEntry[] | null>(null);
  const [saving, setSaving] = useState(false);

  // cash that should be in the drawer now = opening float + cash sales + in − out (same figure the server checks a pay-out against)
  const [drawerCash, setDrawerCash] = useState<number | null>(null);
  const load = useCallback(() => Promise.all([
    getCashEntries(shiftId).then(setEntries).catch(() => setEntries([])),
    getShiftSummary(shiftId).then((s) => setDrawerCash(s.cash.expectedCash)).catch(() => setDrawerCash(null))
  ]), [shiftId]);
  useEffect(() => { void load(); getCashEntryCategories().then(setCategories).catch(() => { /* fallback list */ }); }, [load]);

  const switchType = (next: "OUT" | "IN") => { setType(next); setCategory((next === "OUT" ? categories.out : categories.in)[0]); };
  const value = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(value) && value > 0;
  const active = (entries ?? []).filter((e) => !e.voided);
  const totalOut = active.filter((e) => e.type === "OUT").reduce((s, e) => s + e.amount, 0);
  const totalIn = active.filter((e) => e.type === "IN").reduce((s, e) => s + e.amount, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    if (category === "อื่นๆ" && !note.trim()) return toast.error("ระบุรายละเอียดสำหรับหมวด อื่นๆ");
    setSaving(true);
    try {
      await addCashEntry(shiftId, { type, amount: value, category, note: note.trim() || undefined });
      toast.success(`${type === "OUT" ? "จ่ายออก" : "เติมเข้า"} ${money.format(value)} · ${category}`);
      setAmount(""); setNote("");
      await load();
      onChanged?.();
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }

  async function voidEntry(entry: CashEntry) {
    if (!window.confirm(`ยกเลิกรายการ ${entry.category} ${money.format(entry.amount)} ?`)) return;
    try { await voidCashEntry(entry.id); await load(); onChanged?.(); toast.success("ยกเลิกรายการแล้ว"); }
    catch (err) { toast.error((err as Error).message); }
  }

  const list = type === "OUT" ? categories.out : categories.in;
  return <div className="stk-backdrop stk-backdrop--center" onClick={() => !saving && onClose()}>
    <div ref={ref} className="stk-dialog cash-dialog" role="dialog" aria-modal="true" aria-labelledby="cash-dialog-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
      <div className="stk-drawer__head">
        <div><span className="stk-eyebrow">กะ #{shiftId}</span><h3 id="cash-dialog-title">เงินเข้า / ออกลิ้นชัก</h3></div>
        <button className="studio-icon-button" onClick={onClose} disabled={saving} aria-label="ปิด"><X size={18} /></button>
      </div>
      <p className="stk-hint">ใช้เมื่อหยิบเงินสดออกจากลิ้นชักไปจ่าย หรือเติมเงินทอนเข้า ระบบจะนำไปคำนวณ "เงินสดที่ควรมี" ตอนปิดกะ</p>
      {drawerCash !== null && <p className="stk-hint"><strong>เงินสดในลิ้นชักตามระบบตอนนี้ {money.format(drawerCash)}</strong> (รวมเงินทอนตั้งต้น · จ่ายออกได้ไม่เกินยอดนี้)</p>}

      <form onSubmit={submit} className="stk-form" noValidate>
        <div className="stk-modes cash-modes" role="tablist" aria-label="ประเภท">
          <button type="button" role="tab" aria-selected={type === "OUT"} className={`is-out${type === "OUT" ? " is-active" : ""}`} onClick={() => switchType("OUT")}><ArrowUpFromLine size={16} />จ่ายออก</button>
          <button type="button" role="tab" aria-selected={type === "IN"} className={`is-in${type === "IN" ? " is-active" : ""}`} onClick={() => switchType("IN")}><ArrowDownToLine size={16} />เติมเข้า</button>
        </div>
        <label className="stk-field"><span>จำนวนเงิน (บาท)</span>
          <input className="input stk-amount" type="number" inputMode="decimal" min="0" step="any" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
        <div className="stk-quick">{QUICK.map((n) => <button type="button" key={n} onClick={() => setAmount(String((Number(amount) || 0) + n))}>+{n}</button>)}</div>
        <div className="stk-field"><span>หมวด</span><div className="stk-chips">{list.map((c) => <button type="button" key={c} aria-pressed={category === c} className={category === c ? "is-active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div></div>
        <label className="stk-field"><span>รายละเอียด{category === "อื่นๆ" ? " *" : " (ไม่บังคับ)"}</span><input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ร้านน้ำแข็ง 2 ถุง, เลขบิล" /></label>
        <button className="btn btn--primary btn--full" disabled={!valid || saving}>{saving ? "กำลังบันทึก..." : `บันทึก${type === "OUT" ? "จ่ายออก" : "เติมเข้า"}${valid ? ` ${money.format(value)}` : ""}`}</button>
      </form>

      <div className="stk-item-history">
        <h4>รายการในกะนี้ · ออก {money.format(totalOut)} · เข้า {money.format(totalIn)}</h4>
        {entries === null ? <p className="stk-hint">กำลังโหลด...</p> : entries.length ? <ul className="stk-log">
          {entries.map((e) => <li key={e.id} className={`stk-log__row${e.voided ? " is-voided" : ""}`}>
            <span className="stk-log__when">{new Date(e.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="stk-log__what"><strong>{e.category}{e.voided ? " (ยกเลิกแล้ว)" : ""}</strong><span>{[e.note, e.userName].filter(Boolean).join(" · ")}</span></span>
            <span className="cash-entry-amount">
              <strong className={e.type === "OUT" ? "negative" : "positive"}>{e.type === "OUT" ? "−" : "+"}{money.format(e.amount)}</strong>
              {canVoid && !e.voided && <button type="button" className="btn btn--ghost cash-void" onClick={() => voidEntry(e)}>ยกเลิก</button>}
            </span>
          </li>)}
        </ul> : <p className="stk-hint">ยังไม่มีรายการ</p>}
      </div>
    </div>
  </div>;
}
