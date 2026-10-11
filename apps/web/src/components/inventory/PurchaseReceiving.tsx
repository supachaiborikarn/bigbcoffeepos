import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarClock, ChevronDown, Link2, PackagePlus, ScanBarcode, Trash2, X } from "lucide-react";
import { createPurchase, getIngredients, getRecipes, updateIngredient, voidPurchase } from "../../api";
import type { Ingredient, InventoryItem, MenuItem, PurchaseOrder } from "../../types";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";

// Receive goods from a supplier into this branch's stock. One box takes both
// typed search and a USB/Bluetooth barcode scanner (which types the code then
// Enter). A code resolves to the stock item's own barcode first (+1 per scan),
// then through the product that carries it: menu item barcode/SKU -> its
// single-ingredient recipe -> stock item (+recipe qty per scan). An admin can
// bind an unknown code to a stock item right here. A line can be bought in packs
// (2 ลัง × 12 = 24 ชิ้น) and carry an expiry date (makes a lot for FEFO).
// Receiving as admin can also move each item's shared cost to the weighted
// average with this bill. The bill being keyed in is kept as a per-branch draft
// in this browser until it is received; a wrong receipt is voided (stock reversed).

// totalInput keeps the line total exactly as typed (e.g. "10.") while it drives unitCost
// qty and unitCost are per purchase unit; packSize = stock units in one purchase unit
type Line = { ingredientId: number; qty: string; unitCost: string; totalInput?: string; packSize?: string; expiryDate?: string; lotNo?: string; showLot?: boolean };

/** Units that are counted, so 2.5 of them is a typo (mirrors the server). */
const COUNTED_UNITS = new Set(["ชิ้น", "ขวด", "กระป๋อง", "แพ็ค", "ใบ", "ซอง", "กล่อง", "ลัง", "ถุง", "แก้ว", "อัน", "ห่อ", "หลอด", "ฝา", "ถ้วย", "ลูก", "ตัว", "แผ่น", "ม้วน", "คู่"]);
type Draft = { supplier: string; note: string; lines: Line[] };
type CodeHit = { ingredientId: number; step: number; productName: string };

const fmt = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const money = (v: number) => `฿${v.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const num = (raw: string) => (raw.trim() === "" ? NaN : Number(raw));
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const looksLikeCode = (q: string) => /^[A-Za-z]*\d{5,}$/.test(q);

const draftKey = (branchId: number) => `bbpos.purchase.draft:${branchId}`;
const emptyDraft: Draft = { supplier: "", note: "", lines: [] };
function loadDraft(branchId: number): Draft {
  try { return { ...emptyDraft, ...JSON.parse(localStorage.getItem(draftKey(branchId)) || "{}") }; } catch { return emptyDraft; }
}
function saveDraft(branchId: number, draft: Draft) {
  try {
    if (draft.lines.length || draft.supplier.trim() || draft.note.trim()) localStorage.setItem(draftKey(branchId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(branchId));
  } catch { /* draft is a convenience */ }
}

export default function PurchaseReceiving({ branchId, branchType, inventory, menu, purchases, onReceived }: {
  branchId: number;
  branchType?: MenuItem["branchType"];
  inventory: InventoryItem[];
  menu: MenuItem[];
  purchases: PurchaseOrder[];
  onReceived: () => Promise<void> | void;
}) {
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "admin";
  const [draft, setDraft] = useState<Draft>(() => loadDraft(branchId));
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [miss, setMiss] = useState("");
  // unknown code waiting to be bound to whichever stock item the admin picks next
  const [bindCode, setBindCode] = useState<string | null>(null);
  const [updateCost, setUpdateCost] = useState(true);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [recipes, setRecipes] = useState<Awaited<ReturnType<typeof getRecipes>>>([]);
  // own list: includes items this branch sells but has never stocked (the page's list only has stocked ones)
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [busy, setBusy] = useState(false);
  const [openPo, setOpenPo] = useState<number | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef(new Map<number, HTMLInputElement>());
  const pendingQtyFocus = useRef<number | null>(null);

  useEffect(() => { setDraft(loadDraft(branchId)); }, [branchId]);
  useEffect(() => { saveDraft(branchId, draft); }, [branchId, draft]);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const loadIngredients = () => getIngredients({ receivable: true }).then(setIngredients).catch((err) => toastRef.current.error((err as Error).message));
  useEffect(() => {
    getRecipes().then(setRecipes).catch(() => setRecipes([]));
    void loadIngredients();
  }, [branchId, branchType]);
  useEffect(() => {
    const id = pendingQtyFocus.current;
    if (id === null) return;
    pendingQtyFocus.current = null;
    qtyRefs.current.get(id)?.focus();
    qtyRefs.current.get(id)?.select();
  }, [draft.lines]);
  useEffect(() => {
    if (flashId === null) return;
    const t = window.setTimeout(() => setFlashId(null), 900);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const stockById = useMemo(() => new Map(inventory.map((i) => [i.ingredientId, i])), [inventory]);

  // barcode / SKU -> stock item: its own barcode wins, then products whose recipe is exactly one stock item
  const { codes, aliasesById } = useMemo(() => {
    const recipeByMenu = new Map(recipes.map((r) => [r.menuItemId, r.ingredients]));
    const codes = new Map<string, CodeHit>();
    const aliasesById = new Map<number, { names: string[]; codes: string[] }>();
    for (const item of ingredients) {
      const code = item.barcode?.trim().toLowerCase();
      if (!code) continue;
      codes.set(code, { ingredientId: item.id, step: 1, productName: item.name });
      aliasesById.set(item.id, { names: [], codes: [code] });
    }
    const products = [...menu].sort((a, b) => Number(b.branchType === branchType) - Number(a.branchType === branchType));
    for (const product of products) {
      const recipe = recipeByMenu.get(product.id);
      if (!recipe || recipe.length !== 1 || !ingredientById.has(recipe[0].ingredientId)) continue;
      const hit: CodeHit = { ingredientId: recipe[0].ingredientId, step: recipe[0].qty > 0 ? recipe[0].qty : 1, productName: product.name };
      const alias = aliasesById.get(hit.ingredientId) ?? { names: [], codes: [] };
      alias.names.push(product.name.toLowerCase());
      for (const raw of [product.barcode, product.sku]) {
        const code = raw?.trim();
        if (!code) continue;
        if (!codes.has(code.toLowerCase())) codes.set(code.toLowerCase(), hit);
        alias.codes.push(code.toLowerCase());
      }
      aliasesById.set(hit.ingredientId, alias);
    }
    return { codes, aliasesById };
  }, [recipes, menu, branchType, ingredients, ingredientById]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: Array<{ item: Ingredient; score: number; via?: string }> = [];
    for (const item of ingredients) {
      const name = item.name.toLowerCase();
      const alias = aliasesById.get(item.id);
      let score = 0;
      let via: string | undefined;
      if (alias?.codes.includes(q)) { score = 100; via = "บาร์โค้ดตรง"; }
      else if (name.startsWith(q)) score = 60;
      else if (name.includes(q)) score = 40;
      else if (q.length >= 4 && alias?.codes.some((c) => c.includes(q))) { score = 30; via = "บาร์โค้ด"; }
      else if (alias?.names.some((n) => n.includes(q))) { score = 20; via = "ชื่อสินค้าขาย"; }
      if (score) scored.push({ item, score, via });
    }
    return scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "th")).slice(0, 8);
  }, [query, ingredients, aliasesById]);
  useEffect(() => { setCursor(0); }, [query]);

  const setLines = (fn: (lines: Line[]) => Line[]) => setDraft((d) => ({ ...d, lines: fn(d.lines) }));

  function addItem(ingredientId: number, step: number | null) {
    const ingredient = ingredientById.get(ingredientId);
    if (!ingredient) return;
    const existing = draft.lines.find((l) => l.ingredientId === ingredientId);
    if (existing) {
      if (step !== null) {
        const current = num(existing.qty);
        setLines((ls) => ls.map((l) => l.ingredientId === ingredientId ? { ...l, qty: String(round((Number.isFinite(current) ? current : 0) + step, 3)), totalInput: undefined } : l));
      }
    } else {
      // newest on top so a scanned item is always visible next to the scan box
      setLines((ls) => [{ ingredientId, qty: step !== null ? String(step) : "", unitCost: ingredient.costPerUnit > 0 ? String(ingredient.costPerUnit) : "" }, ...ls]);
      if (step === null) pendingQtyFocus.current = ingredientId;
    }
    setFlashId(ingredientId);
    setQuery("");
    setMiss("");
    if (step !== null) scanRef.current?.focus();
    else if (existing) { qtyRefs.current.get(ingredientId)?.focus(); qtyRefs.current.get(ingredientId)?.select(); }
  }

  function onScanKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); setCursor((c) => (c + 1) % matches.length); return; }
    if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); setCursor((c) => (c - 1 + matches.length) % matches.length); return; }
    if (e.key === "Escape") { setQuery(""); setMiss(""); setBindCode(null); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const hit = codes.get(q.toLowerCase());
    if (hit) { setBindCode(null); return addItem(hit.ingredientId, hit.step); }
    if (looksLikeCode(q)) { setMiss(q); setBindCode(isAdmin ? q : null); setQuery(""); return; }
    const pick = matches[cursor];
    if (pick) choose(pick.item.id);
  }

  function choose(ingredientId: number) {
    if (bindCode) void bind(ingredientId, bindCode);
    else addItem(ingredientId, null);
  }

  async function bind(ingredientId: number, code: string) {
    const item = ingredientById.get(ingredientId);
    if (!item) return;
    const replacing = item.barcode && item.barcode !== code ? `\nแทนบาร์โค้ดเดิม ${item.barcode}` : "";
    if (!window.confirm(`ผูกบาร์โค้ด ${code} กับ "${item.name}"?${replacing}\nครั้งต่อไปยิงบาร์โค้ดนี้จะเพิ่มทีละ 1 ${item.unit}`)) return;
    try {
      const updated = await updateIngredient(ingredientId, { barcode: code });
      setIngredients((list) => list.map((i) => i.id === ingredientId ? { ...i, barcode: updated.barcode ?? code } : i));
      setBindCode(null);
      toast.success(`ผูกบาร์โค้ด ${code} กับ ${item.name} แล้ว`);
      addItem(ingredientId, 1);
    } catch (err) { toast.error((err as Error).message); }
  }

  const rows = draft.lines.map((line) => {
    const qty = num(line.qty);
    const cost = num(line.unitCost);
    const pack = line.packSize === undefined || line.packSize === "" ? 1 : num(line.packSize);
    const total = Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : NaN;
    const ingredient = ingredientById.get(line.ingredientId);
    const stockQty = qty > 0 && pack > 0 ? round(qty * pack, 4) : NaN;
    const stockCost = cost >= 0 && pack > 0 ? round(cost / pack, 4) : NaN;
    const fraction = Boolean(ingredient && COUNTED_UNITS.has(ingredient.unit.trim()) && Number.isFinite(stockQty) && Math.abs(stockQty - Math.round(stockQty)) > 1e-9);
    const valid = qty > 0 && cost >= 0 && pack > 0 && !fraction;
    return { line, ingredient, qty, cost, pack, total, stockQty, stockCost, fraction, valid };
  });
  const grandTotal = rows.reduce((sum, r) => sum + (Number.isFinite(r.total) ? r.total : 0), 0);
  const invalidCount = rows.filter((r) => !r.valid).length;
  const canSubmit = rows.length > 0 && invalidCount === 0 && !busy;
  // lines whose price differs from the item's current shared cost (฿0 lines never change it)
  const costDiffs = rows.filter((r) => r.ingredient && r.stockCost > 0 && Math.abs(r.stockCost - r.ingredient.costPerUnit) > 0.004);
  const willUpdateCost = isAdmin && updateCost && costDiffs.length > 0;

  const suppliers = useMemo(() => [...new Set(purchases.map((p) => p.supplier).filter((s) => s && s !== "ไม่ระบุผู้ขาย"))].slice(0, 20), [purchases]);

  async function submit() {
    if (!canSubmit) return;
    const supplier = draft.supplier.trim() || "ไม่ระบุผู้ขาย";
    const costLine = willUpdateCost ? `\nและอัปเดตทุนแบบถัวเฉลี่ยกับราคาบิลนี้ ${costDiffs.length} รายการ` : "";
    if (!window.confirm(`รับสินค้าเข้าสต็อก ${rows.length} รายการ รวม ${money(grandTotal)}\nจาก ${supplier}?${costLine}`)) return;
    setBusy(true);
    try {
      const po = await createPurchase({
        branchId,
        supplier: draft.supplier.trim(),
        note: draft.note.trim(),
        items: rows.map((r) => ({
          ingredientId: r.line.ingredientId,
          qty: r.stockQty,
          unitCost: r.stockCost,
          description: r.pack !== 1 ? `${fmt(r.qty)} × ${fmt(r.pack)} ${r.ingredient?.unit ?? ""}`.trim() : "",
          expiryDate: r.line.expiryDate || null,
          lotNo: r.line.lotNo?.trim() || undefined
        })),
        updateCost: isAdmin && updateCost
      });
      setDraft(emptyDraft);
      const changed = po.costChanges?.length ?? 0;
      toast.success(`รับสินค้าเข้าสต็อกแล้ว ${rows.length} รายการ · ${money(grandTotal)}${changed ? ` · อัปเดตทุน ${changed} รายการ` : ""}`);
      if (changed) void loadIngredients();
      await onReceived();
      scanRef.current?.focus();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  /** Void a receipt (stock reversed); with reload, its lines come back as the draft to fix and receive again. */
  async function voidReceipt(po: PurchaseOrder, reload: boolean) {
    if (reload && (draft.lines.length || draft.supplier.trim())) return toast.error("ล้างหรือรับบิลที่กำลังกรอกก่อน แล้วค่อยแก้ใบรับเก่า");
    const reason = window.prompt(`${reload ? "แก้ไข" : "ยกเลิก"}ใบรับ #${po.id} (${po.supplier})\nสต็อกที่รับเข้าจะถูกหักออก${reload ? " แล้วโหลดรายการกลับมาให้แก้" : ""}\nระบุเหตุผล:`, reload ? "แก้ไขรายการ" : "");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await voidPurchase(po.id, reason.trim());
      if (reload) {
        setDraft({
          supplier: po.supplier === "ไม่ระบุผู้ขาย" ? "" : po.supplier,
          note: po.note,
          lines: (po.items ?? []).filter((i) => i.ingredientId).map((i) => ({ ingredientId: i.ingredientId, qty: String(i.qty), unitCost: String(i.unitCost) }))
        });
        toast.success(`ยกเลิกใบรับ #${po.id} แล้ว · แก้รายการด้านบนแล้วกดรับเข้าใหม่`);
      } else toast.success(`ยกเลิกใบรับ #${po.id} แล้ว สต็อกถูกหักคืน`);
      await onReceived();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  const showList = query.trim() !== "";

  return <div className="rcv">
    <div className="rcv-head">
      <label className="stk-field"><span>ผู้ขาย / ซัพพลายเออร์</span>
        <input className="input" list="rcv-suppliers" value={draft.supplier} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, supplier: e.target.value }))} placeholder="เช่น แม็คโคร, ร้านจ่า" />
        <datalist id="rcv-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="stk-field"><span>เลขที่บิล / หมายเหตุ</span>
        <input className="input" value={draft.note} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="ไม่บังคับ" />
      </label>
    </div>

    <div className="rcv-scan">
      <label className="rcv-scan__box">
        <ScanBarcode size={20} aria-hidden />
        <input ref={scanRef} value={query} autoComplete="off" spellCheck={false} enterKeyHint="go"
          role="combobox" aria-expanded={showList} aria-controls="rcv-matches" aria-autocomplete="list"
          aria-activedescendant={showList && matches[cursor] ? `rcv-opt-${matches[cursor].item.id}` : undefined}
          aria-label="ค้นหาหรือสแกนบาร์โค้ดสินค้าที่รับเข้า"
          onChange={(e) => { setQuery(e.target.value); setMiss(""); }} onKeyDown={onScanKey}
          placeholder={bindCode ? `พิมพ์ชื่อสินค้าที่จะผูกกับ ${bindCode}` : "สแกนบาร์โค้ด หรือพิมพ์ชื่อสินค้า"} />
        <kbd>Enter</kbd>
      </label>
      {showList && <div className="rcv-matches" id="rcv-matches" role="listbox">
        {bindCode && <p className="rcv-matches__head"><Link2 size={14} aria-hidden /> เลือกสินค้าที่จะผูกกับบาร์โค้ด <code>{bindCode}</code></p>}
        {matches.length ? matches.map((m, i) => {
          const stock = stockById.get(m.item.id);
          const inBill = draft.lines.some((l) => l.ingredientId === m.item.id);
          return <button type="button" role="option" id={`rcv-opt-${m.item.id}`} aria-selected={i === cursor} key={m.item.id}
            className={i === cursor ? "is-active" : ""} onMouseEnter={() => setCursor(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(m.item.id)}>
            <span><strong>{m.item.name}</strong><small>{m.via ? `${m.via} · ` : ""}คงเหลือ {fmt(stock?.stockQty ?? 0)} {m.item.unit}{m.item.costPerUnit > 0 ? ` · ทุน ${money(m.item.costPerUnit)}/${m.item.unit}` : ""}</small></span>
            {bindCode ? <em>{m.item.barcode ? "แทนบาร์โค้ดเดิม" : "ผูกบาร์โค้ด"}</em> : inBill ? <em>อยู่ในบิลแล้ว</em> : <PackagePlus size={16} aria-hidden />}
          </button>;
        }) : <p className="rcv-empty">ไม่พบ “{query.trim()}” · ถ้าเป็นวัตถุดิบใหม่ เพิ่มที่แท็บสต็อกวัตถุดิบก่อน</p>}
      </div>}
      {bindCode ? <div className="rcv-bind" role="status">
        <Link2 size={16} aria-hidden />
        <span>ไม่พบบาร์โค้ด <code>{bindCode}</code> · พิมพ์ชื่อสินค้าแล้วเลือก เพื่อผูกบาร์โค้ดนี้และเพิ่มเข้าบิล</span>
        <button type="button" className="studio-icon-button" aria-label="ยกเลิกการผูกบาร์โค้ด" onClick={() => { setBindCode(null); setMiss(""); scanRef.current?.focus(); }}><X size={16} /></button>
      </div> : miss && <p className="rcv-miss" role="alert">ไม่พบบาร์โค้ด <code>{miss}</code> · ให้ผู้ดูแลระบบผูกบาร์โค้ดกับสินค้า หรือพิมพ์ชื่อแทน</p>}
      <p className="stk-hint">สแกนซ้ำ = เพิ่มจำนวน · เลือกจากรายการด้วย ↑ ↓ แล้ว Enter</p>
    </div>

    <div className="rcv-table" role="table" aria-label="รายการรับเข้า">
      <div className="rcv-row rcv-row--head" role="row">
        <span role="columnheader">สินค้า</span><span role="columnheader">จำนวน</span><span role="columnheader">ทุน/หน่วยที่ซื้อ</span><span role="columnheader">รวม</span><span role="columnheader" aria-label="ลบ" />
      </div>
      {rows.map(({ line, ingredient, qty, total, pack, stockQty, stockCost, fraction }) => {
        const stock = stockById.get(line.ingredientId)?.stockQty ?? 0;
        const unit = ingredient?.unit ?? "";
        const oldCost = ingredient?.costPerUnit ?? 0;
        const costChanged = oldCost > 0 && Number.isFinite(stockCost) && stockCost > 0 && Math.abs(stockCost - oldCost) > 0.004;
        const patch = (p: Partial<Line>) => setLines((ls) => ls.map((l) => l.ingredientId === line.ingredientId ? { ...l, ...p } : l));
        return <div role="row" key={line.ingredientId} className={`rcv-row${flashId === line.ingredientId ? " is-flash" : ""}`}>
          <span role="cell" className="stk-name"><strong>{ingredient?.name ?? `สินค้า #${line.ingredientId}`}</strong>
            <small>คงเหลือ {fmt(stock)}{stockQty > 0 ? <> → <b>{fmt(round(stock + stockQty, 3))}</b></> : null} {unit}</small>
            {fraction && <small className="negative">{unit}ต้องเป็นจำนวนเต็ม</small>}
            <button type="button" className="rcv-lot-toggle" aria-expanded={Boolean(line.showLot)} onClick={() => patch({ showLot: !line.showLot })}><CalendarClock size={12} aria-hidden /> {line.expiryDate ? `หมดอายุ ${new Date(line.expiryDate).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}` : "lot / วันหมดอายุ"}</button></span>
          <span role="cell" className="rcv-num" data-label="จำนวน">
            <input ref={(el) => { if (el) qtyRefs.current.set(line.ingredientId, el); else qtyRefs.current.delete(line.ingredientId); }}
              className={`input${line.qty !== "" && !(qty > 0) ? " is-invalid" : ""}`} type="number" inputMode="decimal" min="0" step="any" value={line.qty} placeholder="0"
              aria-label={`จำนวนรับเข้า ${ingredient?.name}`}
              onChange={(e) => setLines((ls) => ls.map((l) => l.ingredientId === line.ingredientId ? { ...l, qty: e.target.value, totalInput: undefined } : l))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scanRef.current?.focus(); } }} />
            <em>{pack !== 1 ? "หน่วยซื้อ" : unit}</em>
            {/* buying in packs: stock gets qty × pack size */}
            <label className="rcv-pack">× <input className="input" type="number" inputMode="numeric" min="1" step="any" value={line.packSize ?? "1"} aria-label={`จำนวน${unit}ต่อหน่วยซื้อ (เช่น ลัง) ${ingredient?.name}`}
              onChange={(e) => {
                // keep the cost per stock unit; the price per pack scales with the pack size
                const nextPack = num(e.target.value);
                const cost = num(line.unitCost);
                patch({ packSize: e.target.value, totalInput: undefined, ...(nextPack > 0 && pack > 0 && Number.isFinite(cost) ? { unitCost: String(round(cost / pack * nextPack, 4)) } : {}) });
              }} /> {unit} ต่อหน่วยซื้อ</label>
            {pack !== 1 && stockQty > 0 && <small>= {fmt(stockQty)} {unit}</small>}
          </span>
          <span role="cell" className="rcv-num" data-label="ทุน/หน่วย">
            <input className="input" type="number" inputMode="decimal" min="0" step="any" value={line.unitCost} placeholder="0.00"
              aria-label={`ต้นทุนต่อหน่วย ${ingredient?.name}`}
              onChange={(e) => setLines((ls) => ls.map((l) => l.ingredientId === line.ingredientId ? { ...l, unitCost: e.target.value, totalInput: undefined } : l))} />
            {pack !== 1 && stockCost >= 0 && <small>= {money(stockCost)}/{unit}</small>}
            {costChanged && <small className={stockCost > oldCost ? "negative" : "positive"}>ทุนเดิม {money(oldCost)}/{unit}</small>}
          </span>
          <span role="cell" className="rcv-num" data-label="รวม">
            {/* typing the bill's line total back-fills the unit cost */}
            <input className="input" type="number" inputMode="decimal" min="0" step="any" placeholder="0.00"
              value={line.totalInput ?? (Number.isFinite(total) ? String(round(total, 2)) : "")} disabled={!(qty > 0)}
              aria-label={`ยอดรวมบรรทัด ${ingredient?.name}`}
              onBlur={() => setLines((ls) => ls.map((l) => l.ingredientId === line.ingredientId ? { ...l, totalInput: undefined } : l))}
              onChange={(e) => { const raw = e.target.value; const t = num(raw); setLines((ls) => ls.map((l) => l.ingredientId === line.ingredientId ? { ...l, totalInput: raw, unitCost: Number.isFinite(t) && qty > 0 ? String(round(t / qty, 4)) : "" } : l)); }} />
          </span>
          <span role="cell"><button type="button" className="studio-icon-button" aria-label={`เอา ${ingredient?.name} ออก`} onClick={() => setLines((ls) => ls.filter((l) => l.ingredientId !== line.ingredientId))}><Trash2 size={16} /></button></span>
          {line.showLot && <span role="cell" className="rcv-lot">
            <label>วันหมดอายุ <input className="input" type="date" value={line.expiryDate ?? ""} onChange={(e) => patch({ expiryDate: e.target.value })} /></label>
            <label>เลข lot <input className="input" value={line.lotNo ?? ""} maxLength={40} onChange={(e) => patch({ lotNo: e.target.value })} placeholder="ไม่บังคับ" /></label>
            <small>ใส่วันหมดอายุ = ระบบตัดของที่หมดอายุก่อนออกก่อน (FEFO)</small>
          </span>}
        </div>;
      })}
      {!rows.length && <div className="rcv-placeholder"><ScanBarcode size={28} aria-hidden /><strong>ยังไม่มีรายการในบิลนี้</strong><span>สแกนบาร์โค้ดหรือค้นหาชื่อสินค้าด้านบนเพื่อเริ่ม</span></div>}
    </div>

    <div className="rcv-bar">
      <div>
        <strong>{rows.length} รายการ · {money(grandTotal)}</strong>
        <span>{invalidCount ? `แก้จำนวน/ต้นทุนให้ถูกต้องอีก ${invalidCount} รายการ` : rows.length ? "พร้อมรับเข้าสต็อก" : "ร่างบิลจะถูกจำไว้ในเครื่องนี้"}</span>
      </div>
      {costDiffs.length > 0 && (isAdmin
        ? <label className="rcv-costopt"><input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} /> อัปเดตทุนแบบถัวเฉลี่ย (ของเดิมในสต็อก + บิลนี้) {costDiffs.length} รายการ</label>
        : <span className="rcv-costopt">ราคาต่างจากทุนเดิม {costDiffs.length} รายการ · ทุนกลางแก้ได้โดยผู้ดูแลระบบ</span>)}
      {(rows.length > 0 || draft.supplier || draft.note) && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { if (window.confirm("ล้างบิลที่กำลังกรอกทั้งหมด?")) setDraft(emptyDraft); }}>ล้าง</button>}
      <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>{busy ? "กำลังบันทึก..." : "รับเข้าสต็อก"}</button>
    </div>

    <section className="rcv-history">
      <h3>ประวัติรับเข้า</h3>
      {purchases.length ? purchases.slice(0, 8).map((po) => {
        const open = openPo === po.id;
        const isVoid = po.status === "VOID";
        return <div key={po.id} className={`rcv-po${open ? " is-open" : ""}${isVoid ? " is-void" : ""}`}>
          <button type="button" aria-expanded={open} onClick={() => setOpenPo(open ? null : po.id)}>
            <span><strong>{po.supplier || "ไม่ระบุผู้ขาย"}{isVoid && <span className="stk-badge is-out" style={{ marginLeft: 6 }}>ยกเลิก</span>}</strong><small>ใบรับ #{po.id} · {when(po.receivedAt)} · {po.itemCount ?? po.items?.length ?? 0} รายการ{po.note ? ` · ${po.note}` : ""}{isVoid && po.voidReason ? ` · ยกเลิก: ${po.voidReason}` : ""}</small></span>
            <b>{money(po.totalCost)}</b>
            <ChevronDown size={16} aria-hidden />
          </button>
          {open && <ul>{(po.items ?? []).map((item, i) => <li key={item.id ?? i}>
            <span>{item.ingredientName ?? ingredientById.get(item.ingredientId)?.name ?? `#${item.ingredientId}`}{item.description ? <small> ({item.description})</small> : null}</span>
            <span>{fmt(item.qty)} {item.unit ?? ""} × {money(item.unitCost)}</span>
            <b>{money(item.lineTotal ?? item.qty * item.unitCost)}</b>
          </li>)}{!po.items?.length && <li className="stk-hint">ไม่มีรายละเอียดรายการ</li>}
            {!isVoid && <li className="rcv-po__actions">
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => voidReceipt(po, true)}>แก้ไข</button>
              <button type="button" className="btn btn--ghost" style={{ color: "var(--danger)" }} disabled={busy} onClick={() => voidReceipt(po, false)}>ยกเลิกใบรับ</button>
            </li>}
          </ul>}
        </div>;
      }) : <p className="stk-hint">ยังไม่มีการรับสินค้าเข้าสาขานี้</p>}
    </section>
  </div>;
}
