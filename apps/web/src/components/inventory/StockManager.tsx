import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeftRight, ClipboardCheck, ClipboardList, History, Minus, Package, Plus, Search, Settings2, X } from "lucide-react";
import { createIngredient, createStockAdjustment, getInventory, getMenu, getRecipes, getStockMovements, updateInventoryItem } from "../../api";
import type { InventoryItem, StockMovement } from "../../types";
import { useBranch } from "../../contexts/BranchContext";
import { useToast } from "../../contexts/ToastContext";
import { useDialogFocus } from "../../utils/useDialogFocus";
import StockCountSheet from "./StockCountSheet";
import { useCupStock } from "../pos/CupStockStrip";
import { isCupVariantMenuItem, shouldUseModifierModal } from "../../utils/menuRules";
import StockTransfers from "./StockTransfers";

// Branch stock screen shared by admins (InventoryPage) and branch managers
// (BranchInventoryPage). Every number carries a label, and stock changes go
// through three explicit actions — receive / remove / count — each logged as a
// stock movement with a readable reason.

type Status = "ok" | "low" | "out";
type Filter = "all" | "low" | "out";
type Mode = "in" | "out" | "count";

const qtyFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 3 });
const moneyFormatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 });
const fmtQty = (v: number) => qtyFormatter.format(v);
const fmtSigned = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtQty(Math.abs(v))}`;
const fmtMoney = (v: number) => moneyFormatter.format(v);
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

function stockStatus(item: InventoryItem): Status {
  if (item.stockQty <= 0) return "out";
  if (item.reorderLevel > 0 && item.stockQty <= item.reorderLevel) return "low";
  return "ok";
}
const STATUS_LABEL: Record<Status, string> = { ok: "ปกติ", low: "ใกล้หมด", out: "หมดแล้ว" };

const MODES: Record<Mode, { tab: string; help: string; field: string; reasons: string[]; verb: string }> = {
  in: { tab: "รับเข้า", help: "ของเข้าร้านเพิ่ม เช่น ซื้อมา หรือรับจากคลัง", field: "จำนวนที่รับเข้า", reasons: ["ซื้อเข้า", "รับจากคลัง", "อื่นๆ"], verb: "บันทึกรับเข้า" },
  out: { tab: "ตัดออก", help: "ของออกที่ไม่ได้ขายผ่าน POS เช่น เสีย หมดอายุ ใช้ในร้าน", field: "จำนวนที่ตัดออก", reasons: ["ของเสีย/หมดอายุ", "ใช้ในร้าน", "แจก/ชิม", "อื่นๆ"], verb: "บันทึกตัดออก" },
  count: { tab: "นับสต็อกจริง", help: "นับของจริงแล้วกรอกจำนวนที่นับได้ ระบบคำนวณส่วนต่างให้เอง", field: "จำนวนที่นับได้", reasons: [], verb: "บันทึกยอดนับ" }
};
const MODE_CODE: Record<Mode, string> = { in: "RECEIVE", out: "OUT", count: "COUNT" };
const QUICK_ADD = [1, 5, 10, 24];
const UNIT_SUGGESTIONS = ["ชิ้น", "ขวด", "กระป๋อง", "แพ็ค", "กรัม", "มล.", "ลิตร", "กก."];

/** Turn stored movement reasons (SALE-12, PO#3, OUT: ของเสีย · note …) into Thai labels. */
export function describeMovement(reason: string): { label: string; note?: string } {
  const ref = (prefix: string) => reason.slice(prefix.length);
  if (reason.startsWith("SALE-")) return { label: `ขาย · บิล #${ref("SALE-")}` };
  if (reason.startsWith("CANCELLED-")) return { label: `คืนสต็อก · ยกเลิกบิล #${ref("CANCELLED-")}` };
  if (reason.startsWith("REFUNDED-")) return { label: `คืนสต็อก · คืนเงินบิล #${ref("REFUNDED-")}` };
  if (reason.startsWith("PO#")) return { label: `รับเข้าจากใบสั่งซื้อ #${ref("PO#")}` };
  if (reason.startsWith("TRANSFER_IN#")) return { label: `โอนเข้าจากสาขาอื่น #${ref("TRANSFER_IN#")}` };
  if (reason.startsWith("TRANSFER_OUT#")) return { label: `โอนออกไปสาขาอื่น #${ref("TRANSFER_OUT#")}` };
  if (reason.startsWith("RESTOCK_RECEIVE#")) return { label: `รับของจากคลัง #${ref("RESTOCK_RECEIVE#")}` };
  if (reason === "RESTOCK_DISPATCH") return { label: "ส่งของจากคลัง" };
  if (reason === "STOCK_EDIT") return { label: "แก้ยอดคงเหลือ" };
  if (reason.startsWith("STOCKTAKE#")) return { label: `นับสต็อก (รอบ #${ref("STOCKTAKE#")})` };
  if (reason === "ADJUSTMENT") return { label: "ปรับสต็อก" };
  const match = /^(RECEIVE|OUT|COUNT)(?::\s*(.*))?$/.exec(reason);
  if (match) return { label: { RECEIVE: "รับเข้า", OUT: "ตัดออก", COUNT: "นับสต็อก" }[match[1] as "RECEIVE" | "OUT" | "COUNT"], note: match[2] || undefined };
  return { label: reason };
}

/** Changes whenever the item list reloads, so cup counts refresh with it. */
const loadedAtKey = (items: InventoryItem[]) => items.length + ":" + items.reduce((sum, item) => sum + item.stockQty, 0);

export default function StockManager({ canEditDetails, onChanged }: { canEditDetails: boolean; onChanged?: () => void }) {
  const { activeBranch } = useBranch();
  const toast = useToast();
  const branchId = activeBranch?.id;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [view, setView] = useState<"stock" | "count" | "transfer" | "history">("stock");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<StockMovement[] | null>(null);
  // Prepared drinks (ลาเต้เย็น, คาปูเย็น …) are limited by cups, not by their own
  // stock. Their old per-menu stock rows (999.x imported from POSPOS) are hidden.
  const [drinkNames, setDrinkNames] = useState<Set<string>>(new Set());
  const [recipeIngredientIds, setRecipeIngredientIds] = useState<Set<number>>(new Set());
  const [showDrinks, setShowDrinks] = useState(false);
  const cups = useCupStock(activeBranch?.branchType === "coffee" ? branchId : undefined, loadedAtKey(items));

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      const [inventory, menu, recipes] = await Promise.all([getInventory(branchId), getMenu().catch(() => []), getRecipes().catch(() => [])]);
      setRecipeIngredientIds(new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.ingredientId))));
      setDrinkNames(new Set(menu.filter((m) => (!activeBranch?.branchType || m.branchType === activeBranch.branchType) && (shouldUseModifierModal(m) || isCupVariantMenuItem(m))).map((m) => m.name.trim())));
      setItems(inventory);
      setLoadedAt(new Date());
      setError("");
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }, [branchId, activeBranch?.branchType]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  // Never hide something a recipe still deducts — that stock is real.
  const isDrink = useCallback((item: InventoryItem) => drinkNames.has(item.name.trim()) && !recipeIngredientIds.has(item.ingredientId), [drinkNames, recipeIngredientIds]);
  const stockItems = useMemo(() => showDrinks ? items : items.filter((item) => !isDrink(item)), [items, isDrink, showDrinks]);
  const hiddenDrinks = useMemo(() => items.filter(isDrink).length, [items, isDrink]);

  useEffect(() => {
    if (view !== "history" || !branchId) return;
    let cancelled = false;
    setHistory(null);
    getStockMovements(branchId, { manualOnly: true, limit: 60 })
      .then((rows) => { if (!cancelled) setHistory(rows); })
      .catch((err) => { if (!cancelled) { setHistory([]); toast.error((err as Error).message); } });
    return () => { cancelled = true; };
  }, [view, branchId, toast]);

  const counts = useMemo(() => {
    let low = 0, out = 0, value = 0;
    stockItems.forEach((item) => {
      const s = stockStatus(item);
      if (s === "low") low += 1;
      if (s === "out") out += 1;
      value += Math.max(0, item.stockQty) * item.costPerUnit;
    });
    return { low, out, value };
  }, [stockItems]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stockItems.filter((item) => {
      if (filter !== "all" && stockStatus(item) !== filter) return false;
      return !q || `${item.name} ${item.unit} ${item.barcode ?? ""}`.toLowerCase().includes(q);
    });
  }, [stockItems, filter, search]);

  const nameById = useMemo(() => new Map(items.map((item) => [item.ingredientId, item])), [items]);
  const selected = selectedId == null ? null : nameById.get(selectedId) ?? null;

  const applyUpdate = (updated: InventoryItem | null) => {
    if (updated) setItems((list) => list.map((item) => item.ingredientId === updated.ingredientId ? updated : item));
    setHistory(null);
    if (view === "history") setView("stock");
    onChanged?.();
  };

  return <section className="stk">
    <header className="stk-head">
      <div>
        <h2>สต็อกสาขา</h2>
        <p>{activeBranch?.name}{loadedAt ? ` · ข้อมูล ณ ${loadedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.` : ""}</p>
      </div>
      <div className="stk-head__actions">
        <div className="stk-seg" role="tablist" aria-label="มุมมองสต็อก">
          <button role="tab" aria-selected={view === "stock"} className={view === "stock" ? "is-active" : ""} onClick={() => setView("stock")}><Package size={15} /> รายการสต็อก</button>
          <button role="tab" aria-selected={view === "count"} className={view === "count" ? "is-active" : ""} onClick={() => setView("count")}><ClipboardList size={15} /> นับสต็อก</button>
          <button role="tab" aria-selected={view === "transfer"} className={view === "transfer" ? "is-active" : ""} onClick={() => setView("transfer")}><ArrowLeftRight size={15} /> โอนสต็อก</button>
          <button role="tab" aria-selected={view === "history"} className={view === "history" ? "is-active" : ""} onClick={() => setView("history")}><History size={15} /> ประวัติการปรับ</button>
        </div>
        {canEditDetails && <button className="btn btn--primary" onClick={() => setCreating(true)}><Plus size={16} /> เพิ่มรายการใหม่</button>}
      </div>
    </header>

    {view === "stock" ? <>
      {hiddenDrinks > 0 && <div className="stk-drink-note" role="note">
        <div><strong>เมนูชง {fmtQty(hiddenDrinks)} รายการ ขายตามยอดแก้ว ไม่นับสต็อกแยก</strong>
          <span>{[cups["แก้วเย็น"] && `แก้วเย็นเหลือ ${fmtQty(cups["แก้วเย็น"]!.qty)} ${cups["แก้วเย็น"]!.unit}`, cups["แก้วเดินทาง"] && `แก้วร้อนเหลือ ${fmtQty(cups["แก้วเดินทาง"]!.qty)} ${cups["แก้วเดินทาง"]!.unit}`].filter(Boolean).join(" · ") || "ดูยอดแก้วได้ที่รายการแก้วเย็น cold / แก้วร้อน HOT"}</span></div>
        <button type="button" className="btn btn--ghost" onClick={() => setShowDrinks((v) => !v)}>{showDrinks ? "ซ่อนเมนูชง" : "แสดงเมนูชง"}</button>
      </div>}
      <div className="stk-kpis">
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}><span>ทั้งหมด</span><strong>{fmtQty(stockItems.length)}</strong><small>รายการ</small></button>
        <button aria-pressed={filter === "low"} className="is-low" onClick={() => setFilter(filter === "low" ? "all" : "low")}><span><AlertTriangle size={13} /> ใกล้หมด</span><strong>{fmtQty(counts.low)}</strong><small>ถึงจุดแจ้งเตือน</small></button>
        <button aria-pressed={filter === "out"} className="is-out" onClick={() => setFilter(filter === "out" ? "all" : "out")}><span>หมดแล้ว</span><strong>{fmtQty(counts.out)}</strong><small>คงเหลือ 0</small></button>
        <div><span>มูลค่าสต็อก</span><strong>{fmtMoney(counts.value)}</strong><small>คงเหลือ × ต้นทุน</small></div>
      </div>

      <label className="studio-search stk-search"><Search size={18} /><input aria-label="ค้นหาสินค้าในสต็อก" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อสินค้า / วัตถุดิบ / บาร์โค้ด" /></label>

      {error && <p role="alert" className="negative">{error}</p>}
      {loading ? <div className="empty">กำลังโหลดสต็อก...</div> : <div className="stk-table" role="table" aria-label="รายการสต็อก">
        <div className="stk-row stk-row--head" role="row">
          <span role="columnheader">สินค้า / วัตถุดิบ</span>
          <span role="columnheader">คงเหลือ</span>
          <span role="columnheader">แจ้งเตือนเมื่อเหลือ</span>
          <span role="columnheader">ต้นทุน / หน่วย</span>
          <span role="columnheader">สถานะ</span>
          <span role="columnheader"><span className="sr-only">จัดการ</span></span>
        </div>
        {visible.map((item) => {
          const status = stockStatus(item);
          return <div className={`stk-row is-${status}${isDrink(item) ? " is-drink" : ""}`} role="row" key={item.ingredientId} onClick={() => setSelectedId(item.ingredientId)}>
            <span role="cell" className="stk-name"><strong>{item.name}</strong><small>{isDrink(item) ? "เมนูชง · ขายตามยอดแก้ว (ตัวเลขนี้ไม่ใช้แล้ว)" : `หน่วย: ${item.unit}${item.barcode ? ` · ${item.barcode}` : ""}`}</small></span>
            <span role="cell" className="stk-cell stk-qty" data-label="คงเหลือ"><strong>{fmtQty(item.stockQty)}</strong> {item.unit}</span>
            <span role="cell" className="stk-cell" data-label="แจ้งเตือนเมื่อเหลือ">{item.reorderLevel > 0 ? `${fmtQty(item.reorderLevel)} ${item.unit}` : <em>ไม่ได้ตั้ง</em>}</span>
            <span role="cell" className="stk-cell" data-label="ต้นทุน / หน่วย">{fmtMoney(item.costPerUnit)}</span>
            <span role="cell" className="stk-status-cell"><span className={`stk-badge is-${status}`}>{STATUS_LABEL[status]}</span></span>
            <span role="cell" className="stk-action-cell"><button className="btn btn--ghost stk-adjust-btn" onClick={(e) => { e.stopPropagation(); setSelectedId(item.ingredientId); }}>ปรับสต็อก</button></span>
          </div>;
        })}
        {!visible.length && <div className="empty">{items.length ? "ไม่มีรายการที่ตรงกับการค้นหา" : "ยังไม่มีสินค้าในสต็อกสาขานี้"}</div>}
      </div>}
    </> : view === "count" && branchId ? <StockCountSheet branchId={branchId} items={items.filter((item) => !isDrink(item))} onPosted={() => { void load(); onChanged?.(); }} />
    : view === "transfer" && branchId ? <StockTransfers branchId={branchId} items={items.filter((item) => !isDrink(item))} onChanged={() => { void load(); onChanged?.(); }} />
    : <div className="stk-history">
      <p className="stk-hint">การรับเข้า ตัดออก นับสต็อก โอน และรับจากใบสั่งซื้อ ล่าสุด 60 รายการ (ไม่รวมการตัดสต็อกจากการขาย)</p>
      {history === null ? <div className="empty">กำลังโหลดประวัติ...</div> : history.length ? <ul className="stk-log">
        {history.map((m) => <MovementRow key={m.id} movement={m} unit={nameById.get(m.ingredientId)?.unit} name={nameById.get(m.ingredientId)?.name ?? `สินค้า #${m.ingredientId}`} />)}
      </ul> : <div className="empty">ยังไม่มีประวัติการปรับสต็อก</div>}
    </div>}

    {selected && branchId && <AdjustDrawer key={selected.ingredientId} item={selected} branchId={branchId} canEditDetails={canEditDetails} onClose={() => setSelectedId(null)} onSaved={applyUpdate} />}
    {creating && branchId && <CreateDialog branchId={branchId} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); onChanged?.(); }} />}
  </section>;
}

function MovementRow({ movement, name, unit }: { movement: StockMovement; name?: string; unit?: string }) {
  const { label, note } = describeMovement(movement.reason);
  return <li className="stk-log__row">
    <span className="stk-log__when">{fmtWhen(movement.createdAt)}</span>
    <span className="stk-log__what">{name && <strong>{name}</strong>}<span>{label}{note ? ` · ${note}` : ""}</span></span>
    <strong className={`stk-log__qty ${movement.qty >= 0 ? "positive" : "negative"}`}>{fmtSigned(movement.qty)}{unit ? ` ${unit}` : ""}</strong>
  </li>;
}

function AdjustDrawer({ item, branchId, canEditDetails, onClose, onSaved }: { item: InventoryItem; branchId: number; canEditDetails: boolean; onClose: () => void; onSaved: (item: InventoryItem | null) => void }) {
  const toast = useToast();
  const ref = useDialogFocus(onClose);
  const [mode, setMode] = useState<Mode>("in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState(MODES.in.reasons[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<StockMovement[] | null>(null);
  const [details, setDetails] = useState({ name: item.name, unit: item.unit, costPerUnit: String(item.costPerUnit), barcode: item.barcode ?? "", reorderLevel: String(item.reorderLevel) });
  const status = stockStatus(item);

  useEffect(() => {
    let cancelled = false;
    getStockMovements(branchId, { ingredientId: item.ingredientId, limit: 10 })
      .then((rows) => { if (!cancelled) setHistory(rows); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [branchId, item.ingredientId, item.stockQty]);

  const switchMode = (next: Mode) => { setMode(next); setAmount(""); setReason(MODES[next].reasons[0] ?? ""); };
  const value = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(value) && (mode === "count" ? value >= 0 : value > 0);
  const delta = !valid ? 0 : mode === "in" ? value : mode === "out" ? -value : value - item.stockQty;
  const after = item.stockQty + delta;
  const tooMuch = mode === "out" && valid && value > item.stockQty;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    if (tooMuch) return toast.error(`ตัดออกได้ไม่เกินคงเหลือ ${fmtQty(item.stockQty)} ${item.unit}`);
    setSaving(true);
    try {
      let change = delta;
      let current = item.stockQty;
      if (mode === "count") {
        // Re-read just before saving so sales made while counting don't skew the difference.
        const fresh = (await getInventory(branchId)).find((row) => row.ingredientId === item.ingredientId);
        current = fresh?.stockQty ?? item.stockQty;
        change = Math.round((value - current) * 1000) / 1000;
        if (change === 0) { toast.success("ยอดนับตรงกับระบบ ไม่มีการเปลี่ยนแปลง"); onSaved(fresh ?? null); setAmount(""); return; }
      }
      const parts = mode === "count" ? [`นับได้ ${fmtQty(value)} (ระบบ ${fmtQty(current)})`, note.trim()] : [reason === "อื่นๆ" ? "" : reason, note.trim()];
      const detail = parts.filter(Boolean).join(" · ");
      const { inventoryItem } = await createStockAdjustment({ branchId, ingredientId: item.ingredientId, qty: change, reason: detail ? `${MODE_CODE[mode]}: ${detail}` : MODE_CODE[mode] });
      toast.success(`${MODES[mode].tab} ${item.name} ${fmtSigned(change)} ${item.unit} · คงเหลือ ${fmtQty(inventoryItem?.stockQty ?? current + change)} ${item.unit}`);
      setAmount(""); setNote("");
      onSaved(inventoryItem);
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    const costPerUnit = Number(details.costPerUnit), reorderLevel = Number(details.reorderLevel);
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0) return toast.error("จุดแจ้งเตือนต้องเป็นตัวเลขตั้งแต่ 0");
    if (canEditDetails && (!details.name.trim() || !details.unit.trim() || !Number.isFinite(costPerUnit) || costPerUnit < 0)) return toast.error("กรอกชื่อ หน่วย และต้นทุนให้ถูกต้อง");
    setSaving(true);
    try {
      const updated = await updateInventoryItem(item.ingredientId, canEditDetails
        ? { branchId, name: details.name.trim(), unit: details.unit.trim(), costPerUnit, barcode: details.barcode.trim() || null, reorderLevel }
        : { branchId, reorderLevel });
      toast.success("บันทึกการตั้งค่าแล้ว");
      onSaved(updated);
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }

  const cfg = MODES[mode];
  return <div className="stk-backdrop" onClick={() => !saving && onClose()}>
    <div ref={ref} className="stk-drawer" role="dialog" aria-modal="true" aria-labelledby="stk-drawer-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
      <div className="stk-drawer__head">
        <div><span className="stk-eyebrow">ปรับสต็อก</span><h3 id="stk-drawer-title">{item.name}</h3></div>
        <button className="studio-icon-button" onClick={onClose} disabled={saving} aria-label="ปิด"><X size={18} /></button>
      </div>

      <div className={`stk-current is-${status}`}>
        <div><span>คงเหลือตอนนี้</span><strong>{fmtQty(item.stockQty)} <small>{item.unit}</small></strong></div>
        <div className="stk-current__meta"><span className={`stk-badge is-${status}`}>{STATUS_LABEL[status]}</span><small>{item.reorderLevel > 0 ? `แจ้งเตือนเมื่อเหลือ ${fmtQty(item.reorderLevel)} ${item.unit}` : "ยังไม่ได้ตั้งจุดแจ้งเตือน"}</small></div>
      </div>

      <form onSubmit={submit} className="stk-form">
        <div className="stk-modes" role="tablist" aria-label="ประเภทการปรับ">
          {(["in", "out", "count"] as Mode[]).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} className={`is-${m}${mode === m ? " is-active" : ""}`} onClick={() => switchMode(m)}>
            {m === "in" ? <Plus size={16} /> : m === "out" ? <Minus size={16} /> : <ClipboardCheck size={16} />}{MODES[m].tab}
          </button>)}
        </div>
        <p className="stk-hint">{cfg.help}</p>

        <label className="stk-field"><span>{cfg.field} ({item.unit})</span>
          <input className="input stk-amount" type="number" inputMode="decimal" min="0" step="any" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
        {mode !== "count" && <div className="stk-quick" aria-label="เพิ่มจำนวนเร็ว">{QUICK_ADD.map((n) => <button type="button" key={n} onClick={() => setAmount(String((Number(amount) || 0) + n))}>+{n}</button>)}</div>}

        {cfg.reasons.length > 0 && <div className="stk-field"><span>เหตุผล</span><div className="stk-chips">{cfg.reasons.map((r) => <button type="button" key={r} aria-pressed={reason === r} className={reason === r ? "is-active" : ""} onClick={() => setReason(r)}>{r}</button>)}</div></div>}
        <label className="stk-field"><span>หมายเหตุ (ไม่บังคับ)</span><input className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder={mode === "in" ? "เช่น ร้าน/ผู้ขาย เลขบิล" : mode === "out" ? "เช่น วันหมดอายุ สาเหตุ" : "เช่น นับตอนปิดร้าน"} /></label>

        <div className={`stk-preview${tooMuch ? " is-error" : ""}`} aria-live="polite">
          {!valid ? <span>กรอกจำนวนเพื่อดูยอดหลังบันทึก</span> : tooMuch ? <span>ตัดออกได้ไม่เกิน {fmtQty(item.stockQty)} {item.unit}</span> : <>
            <span>{fmtQty(item.stockQty)} → <strong>{fmtQty(after)} {item.unit}</strong></span>
            <strong className={delta > 0 ? "positive" : delta < 0 ? "negative" : ""}>{delta === 0 ? "ตรงกับระบบ" : `${fmtSigned(delta)} ${item.unit}`}</strong>
          </>}
        </div>
        <button className="btn btn--primary btn--full" disabled={!valid || tooMuch || saving}>{saving ? "กำลังบันทึก..." : cfg.verb}</button>
      </form>

      <details className="stk-settings">
        <summary><Settings2 size={15} /> ตั้งค่าสินค้านี้{canEditDetails ? " (ชื่อ หน่วย ต้นทุน บาร์โค้ด จุดแจ้งเตือน)" : " (จุดแจ้งเตือน)"}</summary>
        <form onSubmit={saveDetails} className="stk-settings__grid">
          {canEditDetails && <>
            <label className="stk-field stk-field--wide"><span>ชื่อสินค้า / วัตถุดิบ</span><input className="input" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} /></label>
            <label className="stk-field"><span>หน่วยนับ</span><input className="input" value={details.unit} onChange={(e) => setDetails({ ...details, unit: e.target.value })} /></label>
            <label className="stk-field"><span>ต้นทุนต่อหน่วย (บาท)</span><input className="input" type="number" min="0" step="0.01" value={details.costPerUnit} onChange={(e) => setDetails({ ...details, costPerUnit: e.target.value })} /></label>
            <label className="stk-field stk-field--wide"><span>บาร์โค้ด</span><input className="input" value={details.barcode} maxLength={64} autoComplete="off" spellCheck={false} onChange={(e) => setDetails({ ...details, barcode: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} placeholder="ยิงหรือพิมพ์บาร์โค้ด" /><small>ใช้ยิงตอนรับสินค้าเข้า · เว้นว่าง = ไม่มี</small></label>
          </>}
          <label className="stk-field"><span>แจ้งเตือนเมื่อเหลือ ({item.unit})</span><input className="input" type="number" min="0" step="any" value={details.reorderLevel} onChange={(e) => setDetails({ ...details, reorderLevel: e.target.value })} /><small>ใส่ 0 = ไม่แจ้งเตือน</small></label>
          <button className="btn btn--ghost stk-field--wide" disabled={saving}>บันทึกการตั้งค่า</button>
        </form>
      </details>

      <div className="stk-item-history">
        <h4><History size={15} /> ความเคลื่อนไหวล่าสุด</h4>
        {history === null ? <p className="stk-hint">กำลังโหลด...</p> : history.length ? <ul className="stk-log">
          {history.map((m) => <MovementRow key={m.id} movement={m} unit={item.unit} />)}
        </ul> : <p className="stk-hint">ยังไม่มีความเคลื่อนไหว</p>}
      </div>
    </div>
  </div>;
}

function CreateDialog({ branchId, onClose, onCreated }: { branchId: number; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const ref = useDialogFocus(onClose);
  const [form, setForm] = useState({ name: "", unit: "ชิ้น", costPerUnit: "", barcode: "", stockQty: "", reorderLevel: "" });
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const costPerUnit = Number(form.costPerUnit || 0), stockQty = Number(form.stockQty || 0), reorderLevel = Number(form.reorderLevel || 0);
    if (!form.name.trim() || !form.unit.trim()) return toast.error("กรอกชื่อและหน่วยนับ");
    if ([costPerUnit, stockQty, reorderLevel].some((n) => !Number.isFinite(n) || n < 0)) return toast.error("ตัวเลขต้องตั้งแต่ 0 ขึ้นไป");
    setSaving(true);
    try {
      await createIngredient({ name: form.name.trim(), unit: form.unit.trim(), costPerUnit, barcode: form.barcode.trim() || null, stockQty, reorderLevel, branchId });
      toast.success(`เพิ่ม ${form.name.trim()} แล้ว`);
      onCreated();
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }
  return <div className="stk-backdrop stk-backdrop--center" onClick={() => !saving && onClose()}>
    <div ref={ref} className="stk-dialog" role="dialog" aria-modal="true" aria-labelledby="stk-create-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
      <div className="stk-drawer__head"><div><span className="stk-eyebrow">สต็อกสาขา</span><h3 id="stk-create-title">เพิ่มรายการใหม่</h3></div><button className="studio-icon-button" onClick={onClose} disabled={saving} aria-label="ปิด"><X size={18} /></button></div>
      <form onSubmit={submit} className="stk-settings__grid">
        <label className="stk-field stk-field--wide"><span>ชื่อสินค้า / วัตถุดิบ *</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น เป๊ปซี่ 340 มล." /></label>
        <div className="stk-field stk-field--wide"><span>หน่วยนับ *</span>
          <div className="stk-chips">{UNIT_SUGGESTIONS.map((u) => <button type="button" key={u} aria-pressed={form.unit === u} className={form.unit === u ? "is-active" : ""} onClick={() => setForm({ ...form, unit: u })}>{u}</button>)}</div>
          <input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} aria-label="หน่วยนับ (พิมพ์เอง)" />
        </div>
        <label className="stk-field"><span>ต้นทุนต่อหน่วย (บาท)</span><input className="input" type="number" min="0" step="0.01" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })} placeholder="0" /></label>
        <label className="stk-field"><span>บาร์โค้ด</span><input className="input" value={form.barcode} maxLength={64} autoComplete="off" spellCheck={false} onChange={(e) => setForm({ ...form, barcode: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} placeholder="ไม่บังคับ" /></label>
        <label className="stk-field"><span>จำนวนเริ่มต้น ({form.unit || "หน่วย"})</span><input className="input" type="number" min="0" step="any" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} placeholder="0" /></label>
        <label className="stk-field"><span>แจ้งเตือนเมื่อเหลือ ({form.unit || "หน่วย"})</span><input className="input" type="number" min="0" step="any" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} placeholder="0 = ไม่แจ้งเตือน" /></label>
        <button className="btn btn--primary stk-field--wide" disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึกรายการใหม่"}</button>
      </form>
    </div>
  </div>;
}
