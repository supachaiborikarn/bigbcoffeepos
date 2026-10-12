import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { CalendarClock, ChevronDown, ImagePlus, Link2, PackagePlus, ScanBarcode, Trash2, X } from "lucide-react";
import { approvePurchase, createPurchase, getIngredients, getPurchaseAttachment, getPurchases, getRecipes, receivePurchase, updateIngredient, voidPurchase } from "../../api";
import type { Ingredient, InventoryItem, MenuItem, PurchaseOrder } from "../../types";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import "./PurchaseReceiving.css";

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
type Draft = { supplier: string; invoiceNumber: string; documentDate: string; receivedAt: string; dueDate: string; note: string; mode: "RECEIPT" | "ORDER"; attachmentDataUrl: string; attachmentName: string; requestKey: string; updateCost: boolean; lines: Line[] };
type ReceiptDraft = { requestKey: string; receivedAt: string; updateCost: boolean; quantities: Record<number, string> };
type CodeHit = { ingredientId: number; step: number; productName: string };

const fmt = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const money = (v: number) => `฿${v.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "ยังไม่ได้รับสินค้า";
const num = (raw: string) => (raw.trim() === "" ? NaN : Number(raw));
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const looksLikeCode = (q: string) => /^[A-Za-z]*\d{5,}$/.test(q);

const draftKey = (branchId: number) => `bbpos.purchase.draft:${branchId}`;
const receiptDraftKey = (branchId: number) => `bbpos.purchase.receive.draft:${branchId}`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const emptyDraft = (): Draft => ({ supplier: "", invoiceNumber: "", documentDate: today(), receivedAt: today(), dueDate: "", note: "", mode: "RECEIPT", attachmentDataUrl: "", attachmentName: "", requestKey: crypto.randomUUID(), updateCost: true, lines: [] });
const hasDraft = (draft: Draft) => Boolean(draft.lines.length || draft.supplier.trim() || draft.invoiceNumber.trim() || draft.note.trim() || draft.attachmentDataUrl);
const validImage = (value: unknown): value is string => typeof value === "string" && value.length <= 2_800_000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
const statusLabels: Record<PurchaseOrder["status"], string> = { PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว · รอรับของ", PARTIAL: "รับแล้วบางส่วน", RECEIVED: "รับครบแล้ว", VOID: "ยกเลิก" };
function loadDraft(branchId: number): Draft {
  const base = emptyDraft();
  try {
    const raw = JSON.parse(localStorage.getItem(draftKey(branchId)) || "{}");
    if (!raw || typeof raw !== "object") return base;
    const textFields = ["supplier", "invoiceNumber", "documentDate", "receivedAt", "dueDate", "note", "attachmentName", "requestKey"] as const;
    for (const field of textFields) if (typeof raw[field] === "string" && (field !== "requestKey" || raw[field])) base[field] = raw[field];
    if (typeof raw.updateCost === "boolean") base.updateCost = raw.updateCost;
    if (raw.mode === "ORDER") base.mode = "ORDER";
    if (validImage(raw.attachmentDataUrl)) base.attachmentDataUrl = raw.attachmentDataUrl;
    if (Array.isArray(raw.lines)) {
      const seen = new Set<number>();
      for (const line of raw.lines.slice(0, 200)) {
        if (!line || !Number.isInteger(line.ingredientId) || line.ingredientId <= 0 || seen.has(line.ingredientId) || typeof line.qty !== "string" || typeof line.unitCost !== "string") continue;
        const clean: Line = { ingredientId: line.ingredientId, qty: line.qty, unitCost: line.unitCost, showLot: Boolean(line.showLot) };
        for (const field of ["totalInput", "packSize", "expiryDate", "lotNo"] as const) if (typeof line[field] === "string") clean[field] = line[field];
        seen.add(clean.ingredientId);
        base.lines.push(clean);
      }
    }
    return base;
  } catch { return base; }
}
function saveDraft(branchId: number, draft: Draft) {
  try {
    if (hasDraft(draft)) localStorage.setItem(draftKey(branchId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(branchId));
    return true;
  } catch { return false; }
}

type Props = {
  branchId: number;
  branchType?: MenuItem["branchType"];
  inventory: InventoryItem[];
  menu: MenuItem[];
  purchases: PurchaseOrder[];
  onReceived: () => Promise<void> | void;
};

// Remount each branch's form so effects can never save another branch's draft.
export default function PurchaseReceiving(props: Props) {
  return <BranchPurchaseReceiving key={props.branchId} {...props} />;
}

function BranchPurchaseReceiving({ branchId, branchType, inventory, menu, purchases, onReceived }: Props) {
  const toast = useToast();
  const role = useAuth().user?.role;
  const isAdmin = role === "admin";
  const canApprove = role === "admin" || role === "manager";
  const [draft, setDraft] = useState<Draft>(() => loadDraft(branchId));
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [miss, setMiss] = useState("");
  // unknown code waiting to be bound to whichever stock item the admin picks next
  const [bindCode, setBindCode] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [recipes, setRecipes] = useState<Awaited<ReturnType<typeof getRecipes>>>([]);
  // own list: includes items this branch sells but has never stocked (the page's list only has stocked ones)
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [busy, setBusy] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemVersion, setItemVersion] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState<PurchaseOrder["status"] | "">("");
  const [history, setHistory] = useState<PurchaseOrder[]>(() => purchases.filter((po) => po.branchId === branchId));
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [billImages, setBillImages] = useState<Record<number, { attachmentDataUrl: string; attachmentName: string }>>({});
  const [loadingBill, setLoadingBill] = useState<number | null>(null);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<number, ReceiptDraft>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(receiptDraftKey(branchId)) || "{}");
      const saved: Record<number, ReceiptDraft> = {};
      for (const [id, value] of Object.entries(raw ?? {})) {
        if (!/^\d+$/.test(id) || !value || typeof value !== "object") continue;
        const receipt = value as Partial<ReceiptDraft>;
        if (typeof receipt.requestKey !== "string" || typeof receipt.receivedAt !== "string" || !receipt.quantities || typeof receipt.quantities !== "object") continue;
        saved[Number(id)] = { requestKey: receipt.requestKey, receivedAt: receipt.receivedAt, updateCost: receipt.updateCost ?? true, quantities: Object.fromEntries(Object.entries(receipt.quantities).filter(([itemId, qty]) => /^\d+$/.test(itemId) && typeof qty === "string")) };
      }
      return saved;
    } catch { return {}; }
  });
  const [openPo, setOpenPo] = useState<number | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef(new Map<number, HTMLInputElement>());
  const pendingQtyFocus = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const imageReader = useRef<FileReader | null>(null);
  const imageVersion = useRef(0);
  const warnedStorage = useRef(false);

  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; imageReader.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!saveDraft(branchId, draft) && !warnedStorage.current) {
      warnedStorage.current = true;
      toastRef.current.error("พื้นที่เก็บร่างบิลในเครื่องเต็ม · ร่างนี้ยังอยู่ในหน้าที่เปิด กรุณาบันทึกก่อนปิดหน้า");
    }
  }, [branchId, draft]);
  useEffect(() => {
    try { localStorage.setItem(receiptDraftKey(branchId), JSON.stringify(receiptDrafts)); } catch { /* The open form still retains retry keys. */ }
  }, [branchId, receiptDrafts]);
  const loadIngredients = async () => {
    const items = await getIngredients({ receivable: true });
    if (mountedRef.current) setIngredients(items);
  };
  useEffect(() => {
    let active = true;
    setLoadingItems(true);
    setLoadError("");
    void Promise.allSettled([getIngredients({ receivable: true }), getRecipes()]).then(([itemResult, recipeResult]) => {
      if (!active) return;
      if (itemResult.status === "fulfilled") setIngredients(itemResult.value);
      else setLoadError(`โหลดรายการสินค้าไม่สำเร็จ: ${itemResult.reason instanceof Error ? itemResult.reason.message : "กรุณาลองใหม่"}`);
      if (recipeResult.status === "fulfilled") setRecipes(recipeResult.value);
      else { setRecipes([]); toastRef.current.error("โหลดบาร์โค้ดจากสูตรไม่สำเร็จ · ค้นชื่อหรือใช้บาร์โค้ดวัตถุดิบได้"); }
      setLoadingItems(false);
    });
    return () => { active = false; };
  }, [branchId, branchType, itemVersion]);
  useEffect(() => {
    let active = true;
    setLoadingHistory(true);
    setHistoryError("");
    const timer = window.setTimeout(() => {
      void getPurchases(branchId, { query: historyQuery.trim() || undefined, status: historyStatus || undefined }).then((items) => {
        if (active) setHistory(items.filter((po) => po.branchId === branchId));
      }).catch((error: unknown) => {
        if (active) setHistoryError(error instanceof Error ? error.message : "โหลดประวัติไม่สำเร็จ");
      }).finally(() => { if (active) setLoadingHistory(false); });
    }, historyQuery ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [branchId, historyQuery, historyStatus, historyVersion, purchases]);
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
        const pack = existing.packSize ? num(existing.packSize) : 1;
        const purchaseStep = pack > 0 && Number.isFinite(pack) ? step / pack : step;
        setLines((ls) => ls.map((l) => l.ingredientId === ingredientId ? { ...l, qty: String(round((Number.isFinite(current) ? current : 0) + purchaseStep, 8)), totalInput: undefined } : l));
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
      if (!mountedRef.current) return;
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
    const valid = Boolean(ingredient) && Number.isFinite(qty) && qty > 0 && Number.isFinite(cost) && cost >= 0 && Number.isFinite(pack) && pack > 0 && Number.isFinite(stockQty) && Number.isFinite(stockCost) && !fraction;
    return { line, ingredient, qty, cost, pack, total, stockQty, stockCost, fraction, valid };
  });
  const grandTotal = rows.reduce((sum, r) => sum + (Number.isFinite(r.total) ? r.total : 0), 0);
  const invalidCount = rows.filter((r) => !r.valid).length;
  const canSubmit = rows.length > 0 && invalidCount === 0 && !busy && !readingImage && !loadingItems && !loadError;
  // lines whose price differs from the item's current shared cost (฿0 lines never change it)
  const costDiffs = rows.filter((r) => r.ingredient && r.stockCost > 0 && Math.abs(r.stockCost - r.ingredient.costPerUnit) > 0.004);
  const willUpdateCost = isAdmin && draft.updateCost && costDiffs.length > 0;

  const suppliers = useMemo(() => [...new Set([...purchases, ...history].filter((po) => po.branchId === branchId).map((p) => p.supplier).filter((s) => s && s !== "ไม่ระบุผู้ขาย"))].slice(0, 20), [purchases, history, branchId]);

  function removeImage() {
    imageVersion.current += 1;
    imageReader.current?.abort();
    setReadingImage(false);
    setDraft((current) => ({ ...current, attachmentDataUrl: "", attachmentName: "" }));
  }

  function attachImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast.error("แนบได้เฉพาะภาพ JPEG, PNG หรือ WebP");
    if (file.size > 2 * 1024 * 1024) return toast.error("ภาพบิลต้องมีขนาดไม่เกิน 2 MB");
    if (!file.size) return toast.error("ไฟล์ภาพบิลว่าง กรุณาเลือกภาพใหม่");
    const version = ++imageVersion.current;
    imageReader.current?.abort();
    const reader = new FileReader();
    imageReader.current = reader;
    setReadingImage(true);
    reader.onload = () => {
      if (!mountedRef.current || version !== imageVersion.current) return;
      setReadingImage(false);
      if (!validImage(reader.result)) return toast.error("อ่านภาพบิลไม่ได้ กรุณาเลือกภาพใหม่");
      const attachmentDataUrl = reader.result;
      setDraft((current) => ({ ...current, attachmentDataUrl, attachmentName: file.name.slice(0, 180) }));
    };
    reader.onerror = () => {
      if (!mountedRef.current || version !== imageVersion.current) return;
      setReadingImage(false);
      toast.error("อ่านภาพบิลไม่ได้ กรุณาเลือกภาพใหม่");
    };
    reader.readAsDataURL(file);
  }

  async function refreshAfterSave() {
    if (!mountedRef.current) return;
    setHistoryVersion((version) => version + 1);
    try { await onReceived(); } catch (error) {
      if (mountedRef.current) toast.error(`บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ: ${error instanceof Error ? error.message : "กรุณารีเฟรชหน้า"}`);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    const supplier = draft.supplier.trim() || "ไม่ระบุผู้ขาย";
    const isOrder = draft.mode === "ORDER";
    const costLine = !isOrder && willUpdateCost ? `\nและอัปเดตทุนแบบถัวเฉลี่ยกับราคาบิลนี้ ${costDiffs.length} รายการ` : "";
    if (!window.confirm(`${isOrder ? "ส่งใบสั่งซื้อรออนุมัติ" : "รับสินค้าเข้าสต็อก"} ${rows.length} รายการ รวม ${money(grandTotal)}\nจาก ${supplier}?${costLine}${isOrder ? "\nสต็อกจะเพิ่มเมื่อรับของจริง" : ""}`)) return;
    setBusy(true);
    try {
      const po = await createPurchase({
        branchId,
        supplier: draft.supplier.trim(),
        invoiceNumber: draft.invoiceNumber.trim() || undefined,
        documentDate: draft.documentDate || undefined,
        dueDate: draft.dueDate || undefined,
        receivedAt: !isOrder ? draft.receivedAt || undefined : undefined,
        mode: draft.mode,
        attachmentDataUrl: draft.attachmentDataUrl || undefined,
        attachmentName: draft.attachmentName || undefined,
        requestKey: draft.requestKey,
        note: draft.note.trim(),
        items: rows.map((r) => ({
          ingredientId: r.line.ingredientId,
          qty: r.stockQty,
          unitCost: r.stockCost,
          description: r.pack !== 1 ? `${fmt(r.qty)} × ${fmt(r.pack)} ${r.ingredient?.unit ?? ""}`.trim() : "",
          packSize: r.pack,
          expiryDate: r.line.expiryDate || null,
          lotNo: r.line.lotNo?.trim() || undefined
        })),
        updateCost: !isOrder && isAdmin && draft.updateCost
      });
      if (!mountedRef.current) return;
      const nextDraft = emptyDraft();
      saveDraft(branchId, nextDraft);
      setDraft(nextDraft);
      const changed = po.costChanges?.length ?? 0;
      toast.success(`${isOrder ? "ส่งใบสั่งซื้อรออนุมัติแล้ว" : "รับสินค้าเข้าสต็อกแล้ว"} ${rows.length} รายการ · ${money(grandTotal)}${changed ? ` · อัปเดตทุน ${changed} รายการ` : ""}`);
      if (changed) void loadIngredients().catch((error: unknown) => { if (mountedRef.current) toast.error(error instanceof Error ? error.message : "โหลดต้นทุนล่าสุดไม่สำเร็จ"); });
      await refreshAfterSave();
      scanRef.current?.focus();
    } catch (err) { if (mountedRef.current) toast.error((err as Error).message); } finally { if (mountedRef.current) setBusy(false); }
  }

  /** Void a receipt (stock reversed); with reload, its lines come back as the draft to fix and receive again. */
  async function voidReceipt(po: PurchaseOrder, reload: boolean) {
    if (reload && hasDraft(draft)) return toast.error("ล้างหรือบันทึกบิลที่กำลังกรอกก่อน แล้วค่อยแก้ใบรับเก่า");
    const reason = window.prompt(`${reload ? "แก้ไข" : "ยกเลิก"}เอกสาร #${po.id} (${po.supplier})\n${po.status === "PENDING" || po.status === "APPROVED" ? "ใบสั่งซื้อยังไม่มีของรับเข้า" : "สต็อกที่รับเข้าจะถูกหักออก"}${reload ? " แล้วโหลดรายการกลับมาให้แก้" : ""}\nระบุเหตุผล:`, reload ? "แก้ไขรายการ" : "");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const attachment = reload && po.hasAttachment ? billImages[po.id] ?? await getPurchaseAttachment(po.id) : null;
      if (!mountedRef.current) return;
      await voidPurchase(po.id, reason.trim());
      if (!mountedRef.current) return;
      if (reload) {
        setDraft({
          ...emptyDraft(),
          supplier: po.supplier === "ไม่ระบุผู้ขาย" ? "" : po.supplier,
          invoiceNumber: po.invoiceNumber || "",
          documentDate: po.documentDate?.slice(0, 10) || today(),
          dueDate: po.dueDate?.slice(0, 10) || "",
          attachmentDataUrl: validImage(attachment?.attachmentDataUrl) ? attachment.attachmentDataUrl : "",
          attachmentName: attachment?.attachmentName || po.attachmentName || "",
          note: po.note,
          lines: (po.items ?? []).filter((i) => i.ingredientId).map((i) => ({ ingredientId: i.ingredientId, qty: String(round(i.qty / (i.packSize || 1), 4)), unitCost: String(round(i.unitCost * (i.packSize || 1), 4)), packSize: String(i.packSize || 1), expiryDate: i.expiryDate?.slice(0, 10) || "", lotNo: i.lotNo || "", showLot: Boolean(i.expiryDate || i.lotNo) }))
        });
        toast.success(`ยกเลิกใบรับ #${po.id} แล้ว · แก้รายการด้านบนแล้วกดรับเข้าใหม่`);
      } else toast.success(`ยกเลิกเอกสาร #${po.id} แล้ว`);
      setReceiptDrafts((current) => { const next = { ...current }; delete next[po.id]; return next; });
      await refreshAfterSave();
    } catch (err) { if (mountedRef.current) toast.error((err as Error).message); } finally { if (mountedRef.current) setBusy(false); }
  }

  async function viewBill(po: PurchaseOrder) {
    if (loadingBill !== null || billImages[po.id]) return;
    setLoadingBill(po.id);
    try {
      const attachment = await getPurchaseAttachment(po.id);
      if (!mountedRef.current) return;
      if (!validImage(attachment.attachmentDataUrl)) return toast.error("เอกสารนี้ไม่มีภาพบิลที่เปิดดูได้");
      setBillImages((current) => ({ ...current, [po.id]: { attachmentDataUrl: attachment.attachmentDataUrl!, attachmentName: attachment.attachmentName || "ภาพบิล" } }));
    } catch (error) { if (mountedRef.current) toast.error(error instanceof Error ? error.message : "โหลดภาพบิลไม่สำเร็จ"); }
    finally { if (mountedRef.current) setLoadingBill(null); }
  }

  function toggleHistory(po: PurchaseOrder) {
    setOpenPo((current) => current === po.id ? null : po.id);
    if ((po.status === "APPROVED" || po.status === "PARTIAL") && !receiptDrafts[po.id]) {
      setReceiptDrafts((current) => ({ ...current, [po.id]: { requestKey: crypto.randomUUID(), receivedAt: today(), updateCost: true, quantities: Object.fromEntries((po.items ?? []).filter((item) => item.id).map((item) => [item.id!, String(round(Math.max(0, item.qty - (item.receivedQty || 0)), 4))])) } }));
    }
  }

  async function approveOrder(po: PurchaseOrder) {
    if (busy || !canApprove || !window.confirm(`อนุมัติใบสั่งซื้อ #${po.id} จาก ${po.supplier} รวม ${money(po.totalCost)}?\nสต็อกจะเพิ่มเมื่อรับของจริง`)) return;
    setBusy(true);
    try {
      await approvePurchase(po.id);
      if (!mountedRef.current) return;
      toast.success(`อนุมัติใบสั่งซื้อ #${po.id} แล้ว`);
      setReceiptDrafts((current) => ({ ...current, [po.id]: { requestKey: crypto.randomUUID(), receivedAt: today(), updateCost: true, quantities: Object.fromEntries((po.items ?? []).filter((item) => item.id).map((item) => [item.id!, String(round(Math.max(0, item.qty - (item.receivedQty || 0)), 4))])) } }));
      await refreshAfterSave();
    } catch (error) { if (mountedRef.current) toast.error(error instanceof Error ? error.message : "อนุมัติไม่สำเร็จ"); }
    finally { if (mountedRef.current) setBusy(false); }
  }

  async function receiveOrder(po: PurchaseOrder) {
    const receipt = receiptDrafts[po.id];
    if (busy || !receipt) return;
    const items = (po.items ?? []).filter((item) => item.id).map((item) => ({ purchaseItemId: item.id!, qty: num(receipt.quantities[item.id!] ?? "0"), remaining: round(Math.max(0, item.qty - (item.receivedQty || 0)), 4), unit: item.unit || ingredientById.get(item.ingredientId)?.unit || "" }));
    if (items.some((item) => !Number.isFinite(item.qty) || item.qty < 0 || item.qty > item.remaining + 1e-9 || (COUNTED_UNITS.has(item.unit.trim()) && Math.abs(item.qty - Math.round(item.qty)) > 1e-9))) return toast.error("จำนวนรับต้องเป็นจำนวนที่ถูกต้อง และไม่เกินจำนวนที่ยังค้างรับ");
    const received = items.filter((item) => item.qty > 0).map(({ purchaseItemId, qty }) => ({ purchaseItemId, qty }));
    if (!received.length) return toast.error("ใส่จำนวนรับอย่างน้อย 1 รายการ");
    if (!window.confirm(`รับของตามใบสั่งซื้อ #${po.id} จำนวน ${received.length} รายการ?\nรายการที่ยังไม่รับจะค้างไว้ในใบสั่งซื้อ`)) return;
    setBusy(true);
    try {
      const purchase = await receivePurchase(po.id, { requestKey: receipt.requestKey, receivedAt: receipt.receivedAt || undefined, items: received, updateCost: isAdmin && receipt.updateCost });
      if (!mountedRef.current) return;
      setReceiptDrafts((current) => { const next = { ...current }; delete next[po.id]; return next; });
      setOpenPo(null);
      toast.success(`รับของตามใบสั่งซื้อ #${po.id} แล้ว${purchase.status === "PARTIAL" ? " · ยังมีของค้างรับ" : " · รับครบ"}`);
      if (purchase.costChanges?.length) void loadIngredients().catch(() => {});
      await refreshAfterSave();
    } catch (error) { if (mountedRef.current) toast.error(error instanceof Error ? error.message : "รับสินค้าไม่สำเร็จ"); }
    finally { if (mountedRef.current) setBusy(false); }
  }

  const showList = query.trim() !== "";

  return <div className="rcv">
    {loadError && <p className="rcv-miss" role="alert">{loadError} <button type="button" className="btn btn--ghost" onClick={() => setItemVersion((version) => version + 1)}>ลองโหลดสินค้าใหม่</button></p>}
    <fieldset className="rcv-form" disabled={busy || readingImage || loadingItems || Boolean(loadError)}>
    <div className="rcv-mode" role="group" aria-label="ประเภทเอกสารรับสินค้า">
      <label className={draft.mode === "RECEIPT" ? "is-selected" : ""}><input type="radio" name="purchase-mode" checked={draft.mode === "RECEIPT"} onChange={() => setDraft((current) => ({ ...current, mode: "RECEIPT" }))} /><span><strong>รับของแล้ว</strong><small>บันทึกบิลและเพิ่มสต็อกทันที</small></span></label>
      <label className={draft.mode === "ORDER" ? "is-selected" : ""}><input type="radio" name="purchase-mode" checked={draft.mode === "ORDER"} onChange={() => setDraft((current) => ({ ...current, mode: "ORDER" }))} /><span><strong>สั่งซื้อ · รอรับของ</strong><small>ส่งอนุมัติก่อน แล้วรับของตามจำนวนที่มาถึง</small></span></label>
    </div>
    {loadingItems && <p className="stk-hint" role="status">กำลังโหลดรายการสินค้า...</p>}
    <div className="rcv-head">
      <label className="stk-field"><span>ผู้ขาย / ซัพพลายเออร์</span>
        <input className="input" list="rcv-suppliers" value={draft.supplier} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, supplier: e.target.value }))} placeholder="เช่น แม็คโคร, ร้านจ่า" />
        <datalist id="rcv-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="stk-field"><span>เลขที่บิลส่งของ</span>
        <input className="input" value={draft.invoiceNumber} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, invoiceNumber: e.target.value }))} placeholder="ใช้ค้นย้อนหลังและตรวจบิลซ้ำ" />
      </label>
      <label className="stk-field"><span>วันที่ในบิล</span>
        <input className="input" type="date" value={draft.documentDate} onChange={(e) => setDraft((d) => ({ ...d, documentDate: e.target.value }))} />
      </label>
      <label className="stk-field"><span>{draft.mode === "ORDER" ? "กำหนดส่งของ" : "วันที่รับของ"}</span>
        <input className="input" type="date" value={draft.mode === "ORDER" ? draft.dueDate : draft.receivedAt} onChange={(e) => setDraft((d) => ({ ...d, ...(d.mode === "ORDER" ? { dueDate: e.target.value } : { receivedAt: e.target.value }) }))} />
      </label>
      <label className="stk-field rcv-field-wide"><span>หมายเหตุ</span>
        <input className="input" value={draft.note} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="ไม่บังคับ" />
      </label>
    </div>

    <div className="rcv-attachment">
      <label className="rcv-attachment__picker"><ImagePlus size={18} aria-hidden /><span>{readingImage ? "กำลังอ่านภาพ..." : draft.attachmentDataUrl ? "เปลี่ยนภาพบิลส่งของ" : "แนบภาพบิลส่งของ"}<small>JPEG, PNG หรือ WebP ขนาดไม่เกิน 2 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="แนบภาพบิลส่งของ" onChange={attachImage} /></label>
      {draft.attachmentDataUrl && <div className="rcv-attachment__preview"><img src={draft.attachmentDataUrl} alt={`ภาพบิล ${draft.attachmentName || draft.invoiceNumber || "ที่กำลังกรอก"}`} /><span>{draft.attachmentName}</span><button type="button" className="btn btn--ghost" onClick={removeImage}>นำภาพออก</button></div>}
      <p className="stk-hint">ดูภาพต้นฉบับแล้วกรอกสินค้า จำนวน และราคาตามบิล</p>
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
            <small>คงเหลือ {fmt(stock)}{stockQty > 0 && draft.mode === "RECEIPT" ? <> → <b>{fmt(round(stock + stockQty, 3))}</b></> : null} {unit}{draft.mode === "ORDER" && stockQty > 0 ? ` · สั่ง ${fmt(stockQty)} ${unit}` : ""}</small>
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
        <span>{invalidCount ? `แก้จำนวน/ต้นทุนให้ถูกต้องอีก ${invalidCount} รายการ` : rows.length ? draft.mode === "ORDER" ? "พร้อมส่งอนุมัติ · สต็อกเพิ่มเมื่อรับของ" : "พร้อมรับเข้าสต็อก" : "ร่างบิลจะถูกจำไว้ในเครื่องนี้"}</span>
      </div>
      {draft.mode === "RECEIPT" && costDiffs.length > 0 && (isAdmin
        ? <label className="rcv-costopt"><input type="checkbox" checked={draft.updateCost} onChange={(e) => setDraft((current) => ({ ...current, updateCost: e.target.checked }))} /> อัปเดตทุนแบบถัวเฉลี่ย (ของเดิมในสต็อก + บิลนี้) {costDiffs.length} รายการ</label>
        : <span className="rcv-costopt">ราคาต่างจากทุนเดิม {costDiffs.length} รายการ · ทุนกลางแก้ได้โดยผู้ดูแลระบบ</span>)}
      {hasDraft(draft) && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { if (window.confirm("ล้างบิลที่กำลังกรอกทั้งหมด?")) { removeImage(); setDraft(emptyDraft()); } }}>ล้าง</button>}
      <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>{busy ? "กำลังบันทึก..." : draft.mode === "ORDER" ? "ส่งใบสั่งซื้อรออนุมัติ" : "รับเข้าสต็อก"}</button>
    </div>
    </fieldset>

    <section className="rcv-history">
      <h3>ใบสั่งซื้อและประวัติรับเข้า</h3>
      <div className="rcv-history__filters">
        <label className="stk-field"><span>ค้นเลขบิลหรือผู้ขาย</span><input className="input" type="search" maxLength={120} value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="เลขที่บิล ชื่อผู้ขาย หรือหมายเหตุ" /></label>
        <label className="stk-field"><span>สถานะเอกสาร</span><select className="input" value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value as PurchaseOrder["status"] | "")}><option value="">ทุกสถานะ</option>{Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
      </div>
      {loadingHistory && <p className="stk-hint" role="status">กำลังโหลดเอกสาร...</p>}
      {historyError && <p className="rcv-miss" role="alert">{historyError} <button type="button" className="btn btn--ghost" onClick={() => setHistoryVersion((version) => version + 1)}>ลองใหม่</button></p>}
      {history.filter((po) => (!historyStatus || po.status === historyStatus) && (!historyQuery.trim() || [po.invoiceNumber, po.supplier, po.note, String(po.id)].some((value) => value?.toLowerCase().includes(historyQuery.trim().toLowerCase())))).map((po) => {
        const open = openPo === po.id;
        const isVoid = po.status === "VOID";
        const receipt = receiptDrafts[po.id];
        const isOrder = po.kind === "ORDER";
        const receiveLines = (po.items ?? []).filter((item) => item.id && item.qty - (item.receivedQty ?? 0) > 1e-9);
        return <div key={po.id} className={`rcv-po${open ? " is-open" : ""}${isVoid ? " is-void" : ""}`}>
          <button type="button" aria-expanded={open} onClick={() => toggleHistory(po)}>
            <span><strong>{po.supplier || "ไม่ระบุผู้ขาย"}<em className={`rcv-status rcv-status--${po.status.toLowerCase()}`}>{statusLabels[po.status]}</em></strong><small>{isOrder ? "ใบสั่งซื้อ" : "ใบรับ"} #{po.id}{po.invoiceNumber ? ` · บิล ${po.invoiceNumber}` : ""} · {po.receivedAt ? when(po.receivedAt) : `สร้าง ${when(po.createdAt)}`} · {po.itemCount ?? po.items?.length ?? 0} รายการ{po.note ? ` · ${po.note}` : ""}{isVoid && po.voidReason ? ` · ยกเลิก: ${po.voidReason}` : ""}</small></span>
            <b>{money(po.totalCost)}</b>
            <ChevronDown size={16} aria-hidden />
          </button>
          {open && <div className="rcv-po__body">
            <div className="rcv-document-meta"><span>เลขบิล: {po.invoiceNumber || "ไม่ระบุ"}</span><span>วันที่ในบิล: {po.documentDate ? new Date(po.documentDate).toLocaleDateString("th-TH") : "ไม่ระบุ"}</span>{po.dueDate && <span>กำหนดส่ง: {new Date(po.dueDate).toLocaleDateString("th-TH")}</span>}{po.approvedAt && <span>อนุมัติ: {when(po.approvedAt)}</span>}</div>
            {po.hasAttachment && <div className="rcv-po__attachment">{billImages[po.id] ? <details open><summary>ภาพบิล {billImages[po.id].attachmentName}</summary><img className="rcv-bill-image" src={billImages[po.id].attachmentDataUrl} alt={`บิลส่งของ ${po.invoiceNumber || `#${po.id}`}`} /></details> : <button type="button" className="btn btn--ghost" disabled={loadingBill !== null} onClick={() => viewBill(po)}><ImagePlus size={16} aria-hidden /> {loadingBill === po.id ? "กำลังโหลดภาพ..." : "ดูภาพบิลส่งของ"}</button>}</div>}
            <ul>{(po.items ?? []).map((item, i) => <li key={item.id ?? i}>
            <span>{item.ingredientName ?? ingredientById.get(item.ingredientId)?.name ?? `#${item.ingredientId}`}{item.description ? <small> ({item.description})</small> : null}{isOrder && <small className="rcv-received-qty">รับแล้ว {fmt(item.receivedQty ?? 0)} · ค้างรับ {fmt(Math.max(0, item.qty - (item.receivedQty ?? 0)))} {item.unit}</small>}{(item.lotNo || item.expiryDate) && <small className="rcv-received-qty">{item.lotNo ? `lot ${item.lotNo}` : ""}{item.expiryDate ? ` · หมดอายุ ${new Date(item.expiryDate).toLocaleDateString("th-TH")}` : ""}</small>}</span>
            <span>{fmt(item.qty)} {item.unit ?? ""} × {money(item.unitCost)}</span>
            <b>{money(item.lineTotal ?? item.qty * item.unitCost)}</b>
          </li>)}{!po.items?.length && <li className="stk-hint">ไม่มีรายละเอียดรายการ</li>}
            {!isVoid && canApprove && <li className="rcv-po__actions">
              {po.status === "PENDING" && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => approveOrder(po)}>อนุมัติใบสั่งซื้อ</button>}
              {!isOrder && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => voidReceipt(po, true)}>แก้ไขใบรับ</button>}
              <button type="button" className="btn btn--ghost rcv-danger" disabled={busy} onClick={() => voidReceipt(po, false)}>ยกเลิก{isOrder ? "ใบสั่งซื้อ" : "ใบรับ"}</button>
            </li>}
          </ul>
          {po.receipts?.length ? <div className="rcv-deliveries"><h4>รับของแต่ละครั้ง</h4>{po.receipts.map((delivery) => <div key={delivery.id}><strong>รับครั้ง #{delivery.id} · {when(delivery.receivedAt)}</strong><span>{delivery.items.map((item) => { const ordered = po.items?.find((line) => line.id === item.purchaseItemId); return `${ordered?.ingredientName || `รายการ #${item.purchaseItemId}`} ${fmt(item.qty)} ${ordered?.unit || ""}`; }).join(" · ")}</span></div>)}</div> : null}
          {(po.status === "APPROVED" || po.status === "PARTIAL") && receipt && <fieldset className="rcv-partial" disabled={busy}><legend>รับของตามจำนวนที่มาถึง</legend><p className="stk-hint">ใส่จำนวนเป็นหน่วยสต็อก · รายการที่ยังไม่มาถึงใส่ 0</p>{receiveLines.map((item) => <label key={item.id} className="rcv-partial__line"><span><strong>{item.ingredientName || ingredientById.get(item.ingredientId)?.name}</strong><small>ค้างรับ {fmt(Math.max(0, item.qty - (item.receivedQty || 0)))} {item.unit}</small></span><input className="input" type="number" inputMode="decimal" min="0" max={round(Math.max(0, item.qty - (item.receivedQty || 0)), 4)} step={COUNTED_UNITS.has((item.unit || "").trim()) ? "1" : "any"} value={receipt.quantities[item.id!] ?? "0"} aria-label={`จำนวนรับครั้งนี้ ${item.ingredientName || ingredientById.get(item.ingredientId)?.name}`} onChange={(event) => setReceiptDrafts((current) => ({ ...current, [po.id]: { ...current[po.id], quantities: { ...current[po.id].quantities, [item.id!]: event.target.value } } }))} /><em>{item.unit}</em></label>)}<div className="rcv-partial__footer"><label className="stk-field"><span>วันที่รับของครั้งนี้</span><input className="input" type="date" value={receipt.receivedAt} onChange={(event) => setReceiptDrafts((current) => ({ ...current, [po.id]: { ...current[po.id], receivedAt: event.target.value } }))} /></label><button type="button" className="btn btn--primary" disabled={busy || !receiveLines.length} onClick={() => receiveOrder(po)}>{busy ? "กำลังบันทึก..." : "รับของครั้งนี้"}</button></div>{isAdmin && <label className="rcv-costopt"><input type="checkbox" checked={receipt.updateCost} onChange={(event) => setReceiptDrafts((current) => ({ ...current, [po.id]: { ...current[po.id], updateCost: event.target.checked } }))} /> อัปเดตทุนแบบถัวเฉลี่ยตามของที่รับครั้งนี้</label>}</fieldset>}
          </div>}
        </div>;
      })}
      {!loadingHistory && !historyError && !history.length && <p className="stk-hint">{historyQuery || historyStatus ? "ไม่พบเอกสารตามที่ค้นหา" : "ยังไม่มีเอกสารรับสินค้าเข้าสาขานี้"}</p>}
    </section>
  </div>;
}
