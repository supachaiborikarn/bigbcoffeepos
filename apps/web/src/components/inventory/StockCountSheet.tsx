import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Search } from "lucide-react";
import { createStockCount, postStockCount } from "../../api";
import type { InventoryItem } from "../../types";
import { useToast } from "../../contexts/ToastContext";

// Count many items in one pass (e.g. at closing). Typed counts are kept as a
// per-branch draft in this browser so a count can be paused and resumed.
// Saving creates a stock-count round and posts it: each counted item is set to
// the counted quantity and the difference is logged (STOCKTAKE#id).

const fmt = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const draftKey = (branchId: number) => `bbpos.stockcount.draft:${branchId}`;
function loadDraft(branchId: number): Record<number, string> {
  try { return JSON.parse(localStorage.getItem(draftKey(branchId)) || "{}"); } catch { return {}; }
}
function saveDraft(branchId: number, draft: Record<number, string>) {
  try { Object.keys(draft).length ? localStorage.setItem(draftKey(branchId), JSON.stringify(draft)) : localStorage.removeItem(draftKey(branchId)); } catch { /* draft is a convenience */ }
}

export default function StockCountSheet({ branchId, items, onPosted }: { branchId: number; items: InventoryItem[]; onPosted: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<number, string>>(() => loadDraft(branchId));
  const [search, setSearch] = useState("");
  const [onlyStocked, setOnlyStocked] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { saveDraft(branchId, draft); }, [branchId, draft]);

  const byId = useMemo(() => new Map(items.map((item) => [item.ingredientId, item])), [items]);
  const counted = Object.entries(draft)
    .filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0)
    .map(([id, v]) => ({ item: byId.get(Number(id)), qty: Number(v) }))
    .filter((row): row is { item: InventoryItem; qty: number } => Boolean(row.item));
  const changed = counted.filter((row) => Math.abs(row.qty - row.item.stockQty) > 1e-9);
  // typed but unusable (negative / not a number): block saving until fixed
  const invalid = Object.entries(draft).filter(([, v]) => v.trim() !== "" && !(Number.isFinite(Number(v)) && Number(v) >= 0));

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    // a search always looks through everything, including items at 0 (e.g. counting a new delivery)
    return items.filter((item) => (q ? `${item.name} ${item.barcode ?? ""}`.toLowerCase().includes(q) : !onlyStocked || item.stockQty !== 0 || draft[item.ingredientId] !== undefined));
  }, [items, search, onlyStocked, draft]);

  async function submit() {
    if (!counted.length || saving) return;
    if (!window.confirm(`บันทึกผลนับ ${counted.length} รายการ (ยอดเปลี่ยน ${changed.length} รายการ)?\nระบบจะตั้งยอดคงเหลือเป็นจำนวนที่นับได้`)) return;
    setSaving(true);
    try {
      const round = await createStockCount({ branchId, note: note.trim() || "นับสต็อกจากหน้าสต็อกสาขา", items: counted.map(({ item, qty }) => ({ ingredientId: item.ingredientId, countedQty: qty })) });
      await postStockCount(round.id);
      setDraft({}); setNote("");
      toast.success(`บันทึกผลนับแล้ว ${counted.length} รายการ · ปรับยอด ${changed.length} รายการ`);
      onPosted();
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }

  return <div className="count-sheet">
    <p className="stk-hint">นับของจริงแล้วกรอกเฉพาะรายการที่นับ ช่องที่เว้นว่างจะไม่ถูกเปลี่ยน · ระบบจำค่าที่กรอกไว้ในเครื่องนี้จนกว่าจะบันทึก</p>
    <div className="count-sheet__tools">
      <label className="studio-search stk-search"><Search size={18} /><input aria-label="ค้นหาในใบนับ" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อสินค้า" /></label>
      <label className="count-sheet__toggle"><input type="checkbox" checked={onlyStocked} onChange={(e) => setOnlyStocked(e.target.checked)} /> ซ่อนรายการที่ยอดเป็น 0 (ค้นหาจะเห็นทุกรายการ)</label>
    </div>
    <div className="stk-table count-table" role="table" aria-label="ใบนับสต็อก">
      <div className="count-row count-row--head" role="row"><span role="columnheader">สินค้า</span><span role="columnheader">ในระบบ</span><span role="columnheader">นับได้</span><span role="columnheader">ส่วนต่าง</span></div>
      {visible.map((item) => {
        const raw = draft[item.ingredientId] ?? "";
        const bad = raw.trim() !== "" && !(Number.isFinite(Number(raw)) && Number(raw) >= 0);
        const has = raw.trim() !== "" && !bad;
        const diff = has ? Math.round((Number(raw) - item.stockQty) * 1000) / 1000 : null;
        return <div className={`count-row${has ? " is-filled" : ""}`} role="row" key={item.ingredientId}>
          <span role="cell" className="stk-name"><strong>{item.name}</strong><small>หน่วย: {item.unit}</small></span>
          <span role="cell" className="stk-cell" data-label="ในระบบ">{fmt(item.stockQty)}</span>
          <span role="cell"><input className={`input count-input${bad ? " is-invalid" : ""}`} aria-invalid={bad} type="number" inputMode="decimal" min="0" step="any" aria-label={`นับได้ ${item.name}`} value={raw} placeholder="—"
            onChange={(e) => setDraft((d) => { const next = { ...d }; if (e.target.value === "") delete next[item.ingredientId]; else next[item.ingredientId] = e.target.value; return next; })} /></span>
          <span role="cell" className={`stk-cell count-diff ${diff === null ? "" : diff > 0 ? "positive" : diff < 0 ? "negative" : ""}`} data-label="ส่วนต่าง">{bad ? "ต้องไม่ติดลบ" : diff === null ? "" : diff === 0 ? "ตรง" : `${diff > 0 ? "+" : ""}${fmt(diff)}`}</span>
        </div>;
      })}
      {!visible.length && <div className="empty">ไม่มีรายการ</div>}
    </div>
    <div className="count-sheet__bar">
      <div><strong>กรอกแล้ว {counted.length} รายการ</strong><span className={invalid.length ? "negative" : undefined}>{invalid.length ? `ค่าที่ใช้ไม่ได้ ${invalid.length} รายการ (ติดลบ) แก้ก่อนบันทึก` : `ยอดจะเปลี่ยน ${changed.length} รายการ`}</span></div>
      <input className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุรอบนับ (ไม่บังคับ)" aria-label="หมายเหตุรอบนับ" />
      {Object.keys(draft).length > 0 && <button type="button" className="btn btn--ghost" disabled={saving} onClick={() => { if (window.confirm("ล้างค่าที่กรอกทั้งหมด?")) setDraft({}); }}>ล้าง</button>}
      <button type="button" className="btn btn--primary" disabled={!counted.length || invalid.length > 0 || saving} onClick={submit}><ClipboardCheck size={16} /> {saving ? "กำลังบันทึก..." : "บันทึกผลนับ"}</button>
    </div>
  </div>;
}
