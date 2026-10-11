import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, PackageCheck, Plus, Search, Trash2 } from "lucide-react";
import { cancelStockTransfer, createStockTransfer, getStockTransfers, receiveStockTransfer } from "../../api";
import type { InventoryItem, StockTransfer } from "../../types";
import { useBranch } from "../../contexts/BranchContext";
import { useToast } from "../../contexts/ToastContext";

// Move stock between branches of the same business. Stock leaves the sender when
// the transfer is sent (never more than it has) and arrives when the receiving
// branch presses "รับของ"; the sender can cancel until then to get it back.

const fmt = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

export default function StockTransfers({ branchId, items, onChanged }: { branchId: number; items: InventoryItem[]; onChanged: () => void }) {
  const toast = useToast();
  const { branches } = useBranch();
  const myType = branches.find((b) => b.id === branchId)?.branchType;
  const others = branches.filter((b) => b.id !== branchId && b.active !== false && (!myType || b.branchType === myType));
  const [transfers, setTransfers] = useState<StockTransfer[] | null>(null);
  const [toBranchId, setToBranchId] = useState<number>(others[0]?.id ?? 0);
  const [lines, setLines] = useState<Array<{ ingredientId: number; qty: string }>>([]);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const branchName = (id: number) => branches.find((b) => b.id === id)?.name ?? `สาขา #${id}`;
  const byId = useMemo(() => new Map(items.map((item) => [item.ingredientId, item])), [items]);

  const load = useCallback(() => getStockTransfers(branchId).then(setTransfers).catch((err) => { setTransfers([]); toast.error((err as Error).message); }), [branchId, toast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toBranchId && others[0]) setToBranchId(others[0].id); }, [others, toBranchId]);

  const matches = useMemo(() => {
    const q = pick.trim().toLowerCase();
    if (!q) return [];
    return items.filter((item) => item.name.toLowerCase().includes(q) && !lines.some((l) => l.ingredientId === item.ingredientId)).slice(0, 8);
  }, [pick, items, lines]);

  const overStock = (l: { ingredientId: number; qty: string }) => Number(l.qty) > (byId.get(l.ingredientId)?.stockQty ?? 0);
  const valid = toBranchId > 0 && lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && !overStock(l));
  async function send() {
    if (!valid || busy) return;
    if (!window.confirm(`ส่งของ ${lines.length} รายการไป ${branchName(toBranchId)}?\nสต็อกสาขานี้จะถูกหักทันที และเข้าสาขาปลายทางเมื่อเขากด "รับของ"`)) return;
    setBusy(true);
    try {
      await createStockTransfer({ fromBranchId: branchId, toBranchId, note: note.trim() || undefined, items: lines.map((l) => ({ ingredientId: l.ingredientId, qty: Number(l.qty) })) });
      toast.success(`ส่งของไป ${branchName(toBranchId)} แล้ว · รอปลายทางกด "รับของ"`);
      setLines([]); setNote("");
      await load();
      onChanged();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  async function cancel(t: StockTransfer) {
    if (!window.confirm(`ยกเลิกใบโอน #${t.id} ไป ${branchName(t.toBranchId)}?\nของจะกลับเข้าสต็อกสาขานี้`)) return;
    setBusy(true);
    try { await cancelStockTransfer(t.id); toast.success(`ยกเลิกใบโอน #${t.id} แล้ว ของกลับเข้าสต็อก`); await load(); onChanged(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  async function receive(t: StockTransfer) {
    if (!window.confirm(`รับของจาก ${branchName(t.fromBranchId)} (${t.items?.length ?? 0} รายการ) เข้าสต็อกสาขานี้?`)) return;
    setBusy(true);
    try { await receiveStockTransfer(t.id); toast.success(`รับของใบโอน #${t.id} แล้ว`); await load(); onChanged(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  const pending = (t: StockTransfer) => t.status !== "RECEIVED" && t.status !== "CANCELLED";
  const incoming = (transfers ?? []).filter((t) => t.toBranchId === branchId && pending(t));
  const outgoing = (transfers ?? []).filter((t) => t.fromBranchId === branchId && pending(t));
  const done = (transfers ?? []).filter((t) => t.status === "RECEIVED" || t.status === "CANCELLED").slice(0, 15);
  const itemList = (t: StockTransfer) => (t.items ?? []).map((i) => `${i.ingredient?.name ?? `#${i.ingredientId}`} ${fmt(i.qty)}${i.ingredient?.unit ? ` ${i.ingredient.unit}` : ""}`).join(" · ");

  return <div className="xfer">
    {incoming.length > 0 && <section className="xfer-card is-incoming">
      <h3><PackageCheck size={17} /> รอรับเข้าสาขานี้ ({incoming.length})</h3>
      {incoming.map((t) => <div key={t.id} className="xfer-row">
        <div><strong>#{t.id} · จาก {branchName(t.fromBranchId)}</strong><small>{when(t.createdAt)}{t.note ? ` · ${t.note}` : ""}</small><p>{itemList(t)}</p></div>
        <button className="btn btn--primary" disabled={busy} onClick={() => receive(t)}>รับของ</button>
      </div>)}
    </section>}

    <section className="xfer-card">
      <h3><ArrowRight size={17} /> สร้างใบโอนออก</h3>
      {others.length === 0 ? <p className="stk-hint">ไม่มีสาขาอื่นให้โอน</p> : <>
        <label className="stk-field"><span>ส่งไปสาขา</span>
          <select className="input" value={toBranchId} onChange={(e) => setToBranchId(Number(e.target.value))}>{others.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
        <div className="stk-field"><span>เพิ่มสินค้า</span>
          <label className="studio-search"><Search size={18} /><input value={pick} onChange={(e) => setPick(e.target.value)} placeholder="พิมพ์ชื่อสินค้าที่จะโอน" aria-label="ค้นหาสินค้าที่จะโอน" /></label>
          {matches.length > 0 && <div className="xfer-matches">{matches.map((item) => <button type="button" key={item.ingredientId} onClick={() => { setLines((l) => [...l, { ingredientId: item.ingredientId, qty: "" }]); setPick(""); }}>
            <Plus size={14} /> {item.name} <small>คงเหลือ {fmt(item.stockQty)} {item.unit}</small></button>)}</div>}
        </div>
        {lines.length > 0 && <div className="xfer-lines">{lines.map((line) => {
          const item = byId.get(line.ingredientId);
          return <div key={line.ingredientId} className="xfer-line">
            <span><strong>{item?.name}</strong><small className={overStock(line) ? "negative" : undefined}>คงเหลือ {fmt(item?.stockQty ?? 0)} {item?.unit}{overStock(line) ? " · โอนเกินยอดคงเหลือไม่ได้" : ""}</small></span>
            <input className={`input${overStock(line) ? " is-invalid" : ""}`} type="number" inputMode="decimal" min="0" max={item?.stockQty} step="any" value={line.qty} placeholder="จำนวน" aria-label={`จำนวนโอน ${item?.name}`} aria-invalid={overStock(line)} onChange={(e) => setLines((ls) => ls.map((l) => l.ingredientId === line.ingredientId ? { ...l, qty: e.target.value } : l))} />
            <button type="button" className="studio-icon-button" aria-label={`เอา ${item?.name} ออก`} onClick={() => setLines((ls) => ls.filter((l) => l.ingredientId !== line.ingredientId))}><Trash2 size={16} /></button>
          </div>;
        })}</div>}
        <label className="stk-field"><span>หมายเหตุ (ไม่บังคับ)</span><input className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ฝากรถส่งของรอบบ่าย" /></label>
        <button className="btn btn--primary btn--full" disabled={!valid || busy} onClick={send}>ส่งใบโอน {lines.length ? `(${lines.length} รายการ)` : ""}</button>
      </>}
    </section>

    {outgoing.length > 0 && <section className="xfer-card">
      <h3>ส่งออกแล้ว · รอปลายทางรับ ({outgoing.length})</h3>
      {outgoing.map((t) => <div key={t.id} className="xfer-row"><div><strong>#{t.id} · ไป {branchName(t.toBranchId)}</strong><small>{when(t.createdAt)} · หักสต็อกแล้ว ระหว่างส่ง</small><p>{itemList(t)}</p></div>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="stk-badge is-low">รอรับ</span><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => cancel(t)}>ยกเลิก</button></span></div>)}
    </section>}

    <section className="xfer-card">
      <h3>ประวัติการโอน</h3>
      {transfers === null ? <p className="stk-hint">กำลังโหลด...</p> : done.length ? done.map((t) => <div key={t.id} className="xfer-row">
        <div><strong>#{t.id} · {t.fromBranchId === branchId ? `ส่งไป ${branchName(t.toBranchId)}` : `รับจาก ${branchName(t.fromBranchId)}`}</strong><small>{t.status === "CANCELLED" ? "ยกเลิกแล้ว · ของกลับต้นทาง" : `รับเมื่อ ${when(t.receivedAt)}`}</small><p>{itemList(t)}</p></div>
        {t.status === "CANCELLED" ? <span className="stk-badge is-out">ยกเลิก</span> : <span className="stk-badge is-ok">รับแล้ว</span>}
      </div>) : <p className="stk-hint">ยังไม่มีประวัติการโอน</p>}
    </section>
  </div>;
}
