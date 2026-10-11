import { useMemo, useState } from "react";
import { createInventoryLot, createPriceRule, createProductUnit, createProductVariant, getIngredients, getInventoryLots, getMenu, getProductUnits } from "../../api";
import { useToast } from "../../contexts/ToastContext";
import { Field, money, SearchPicker, Section, SectionState, thaiDate, todayBangkok, useSectionData } from "./shared";

// Minimart-style product setup: pack units (ลัง = 12 ชิ้น), tier prices, lots
// with expiry dates, and SKU variants. Products/items are picked by search;
// quantities and multipliers must be positive (also enforced by the server).

const positive = (raw: string, what: string, integer = false) => {
  if (raw.trim() === "") return "";
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return `${what}ต้องมากกว่า 0`;
  if (integer && !Number.isInteger(v)) return `${what}ต้องเป็นจำนวนเต็ม`;
  return "";
};

export default function MinimartSection({ branchId, branchType }: { branchId: number; branchType?: string }) {
  const toast = useToast();
  const menu = useSectionData(getMenu, []);
  const ingredients = useSectionData(() => getIngredients(), [branchId]);
  const units = useSectionData(() => getProductUnits(), [branchId]);
  const lots = useSectionData(() => getInventoryLots(branchId, 365), [branchId]);
  const [menuItemId, setMenuItemId] = useState<number | null>(null);
  const [ingredientId, setIngredientId] = useState<number | null>(null);
  const [unit, setUnit] = useState({ unitName: "", factor: "", price: "" });
  const [rule, setRule] = useState({ tier: "", minQty: "1", price: "" });
  const [lot, setLot] = useState({ lotNo: "", qty: "", expiryDate: todayBangkok() });
  const [variant, setVariant] = useState({ optionName: "", optionValue: "", priceDelta: "" });
  const [busy, setBusy] = useState(false);

  const menuOptions = useMemo(() => (menu.data ?? []).filter((m) => !branchType || m.branchType === branchType).map((m) => ({ id: m.id, label: m.name, sub: `${m.category} · ${money(m.basePrice)}`, keywords: `${m.barcode ?? ""} ${m.sku ?? ""}` })), [menu.data, branchType]);
  const ingredientOptions = useMemo(() => (ingredients.data ?? []).map((i) => ({ id: i.id, label: i.name, sub: i.unit, keywords: i.barcode ?? "" })), [ingredients.data]);
  const menuName = (id: number) => (menu.data ?? []).find((m) => m.id === id)?.name ?? `#${id}`;

  const factorError = positive(unit.factor, "ตัวคูณ");
  const unitPriceError = unit.price && !(Number(unit.price) >= 0) ? "ราคาต้องไม่ติดลบ" : "";
  const rulePriceError = rule.price && !(Number(rule.price) >= 0) ? "ราคาต้องไม่ติดลบ" : "";
  const minQtyError = positive(rule.minQty, "จำนวนขั้นต่ำ", true);
  const lotQtyError = positive(lot.qty, "จำนวน");

  async function act(fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(true);
    try { await fn(); toast.success(ok); after?.(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  return <Section title="สินค้าแบบมินิมาร์ท" subtitle="หน่วยขาย (เช่น ลัง) · ราคาตามกลุ่มลูกค้า · lot/วันหมดอายุ · ตัวเลือก SKU">
    <Field label="สินค้าขาย" hint="ใช้กับ หน่วยขาย / ราคาพิเศษ / ตัวเลือก SKU" wide>
      <SearchPicker label="เลือกสินค้าขาย" placeholder="พิมพ์ชื่อ หรือยิงบาร์โค้ด" options={menuOptions} value={menuItemId} onChange={setMenuItemId} />
    </Field>

    <h3 className="bo-h3">หน่วยขาย</h3>
    <div className="bo-grid">
      <Field label="ชื่อหน่วย *"><input className="input" value={unit.unitName} maxLength={30} onChange={(e) => setUnit({ ...unit, unitName: e.target.value })} placeholder="เช่น ลัง" /></Field>
      <Field label="ตัวคูณ (ชิ้นต่อหน่วย) *" error={factorError}><input className="input" type="number" min="0" step="any" value={unit.factor} onChange={(e) => setUnit({ ...unit, factor: e.target.value })} placeholder="เช่น 12" /></Field>
      <Field label="ราคาต่อหน่วย (ไม่บังคับ)" error={unitPriceError}><input className="input" type="number" min="0" step="any" value={unit.price} onChange={(e) => setUnit({ ...unit, price: e.target.value })} /></Field>
      <div className="stk-field"><span>&nbsp;</span><button type="button" className="btn btn--primary" disabled={busy || !menuItemId || !unit.unitName.trim() || !unit.factor || Boolean(factorError || unitPriceError)}
        onClick={() => act(() => createProductUnit({ menuItemId: menuItemId!, unitName: unit.unitName.trim(), factor: Number(unit.factor), price: unit.price ? Number(unit.price) : null }), "เพิ่มหน่วยขายแล้ว", () => { setUnit({ unitName: "", factor: "", price: "" }); void units.reload(); })}>เพิ่มหน่วย</button></div>
    </div>
    <SectionState state={units} empty="ยังไม่มีหน่วยขายพิเศษ">
      {(list) => <div className="bo-list">{list.slice(0, 20).map((u) => <div key={u.id} className="bo-list__row"><span><strong>{menuName(u.menuItemId)} · {u.unitName}</strong><small>{u.factor} ชิ้น{u.price != null ? ` · ${money(u.price)}` : ""}{u.factor <= 0 ? " · ตัวคูณไม่ถูกต้อง" : ""}</small></span></div>)}</div>}
    </SectionState>

    <h3 className="bo-h3">ราคาพิเศษ</h3>
    <div className="bo-grid">
      <Field label="กลุ่มลูกค้า (tier)" hint="เว้นว่าง = ทุกคน"><input className="input" value={rule.tier} maxLength={30} onChange={(e) => setRule({ ...rule, tier: e.target.value })} placeholder="เช่น VIP" /></Field>
      <Field label="ซื้อขั้นต่ำ (ชิ้น)" error={minQtyError}><input className="input" type="number" min="1" step="1" value={rule.minQty} onChange={(e) => setRule({ ...rule, minQty: e.target.value })} /></Field>
      <Field label="ราคาต่อชิ้น *" error={rulePriceError}><input className="input" type="number" min="0" step="any" value={rule.price} onChange={(e) => setRule({ ...rule, price: e.target.value })} /></Field>
      <div className="stk-field"><span>&nbsp;</span><button type="button" className="btn btn--ghost" disabled={busy || !menuItemId || rule.price === "" || Boolean(rulePriceError || minQtyError)}
        onClick={() => act(() => createPriceRule({ menuItemId: menuItemId!, customerTier: rule.tier.trim(), minQty: Number(rule.minQty) || 1, price: Number(rule.price) }), "เพิ่มราคาพิเศษแล้ว", () => setRule({ tier: "", minQty: "1", price: "" }))}>เพิ่มราคาพิเศษ</button></div>
    </div>

    <h3 className="bo-h3">ตัวเลือก SKU</h3>
    <div className="bo-grid">
      <Field label="ชื่อตัวเลือก *"><input className="input" value={variant.optionName} maxLength={40} onChange={(e) => setVariant({ ...variant, optionName: e.target.value })} placeholder="เช่น สี" /></Field>
      <Field label="ค่า *"><input className="input" value={variant.optionValue} maxLength={40} onChange={(e) => setVariant({ ...variant, optionValue: e.target.value })} placeholder="เช่น แดง" /></Field>
      <Field label="ราคาเพิ่ม/ลด (บาท)"><input className="input" type="number" step="any" value={variant.priceDelta} onChange={(e) => setVariant({ ...variant, priceDelta: e.target.value })} placeholder="0" /></Field>
      <div className="stk-field"><span>&nbsp;</span><button type="button" className="btn btn--ghost" disabled={busy || !menuItemId || !variant.optionName.trim() || !variant.optionValue.trim()}
        onClick={() => act(() => createProductVariant({ menuItemId: menuItemId!, optionName: variant.optionName.trim(), optionValue: variant.optionValue.trim(), priceDelta: Number(variant.priceDelta) || 0 }), "เพิ่มตัวเลือกแล้ว", () => setVariant({ optionName: "", optionValue: "", priceDelta: "" }))}>เพิ่มตัวเลือก</button></div>
    </div>

    <h3 className="bo-h3">Lot และวันหมดอายุ</h3>
    <div className="bo-grid">
      <Field label="วัตถุดิบ / สินค้าในสต็อก *" wide><SearchPicker label="เลือกวัตถุดิบ" placeholder="พิมพ์ชื่อ หรือยิงบาร์โค้ด" options={ingredientOptions} value={ingredientId} onChange={setIngredientId} /></Field>
      <Field label="เลข lot"><input className="input" value={lot.lotNo} maxLength={40} onChange={(e) => setLot({ ...lot, lotNo: e.target.value })} /></Field>
      <Field label="จำนวน *" error={lotQtyError}><input className="input" type="number" min="0" step="any" value={lot.qty} onChange={(e) => setLot({ ...lot, qty: e.target.value })} /></Field>
      <Field label="วันหมดอายุ *"><input className="input" type="date" value={lot.expiryDate} onChange={(e) => setLot({ ...lot, expiryDate: e.target.value })} /></Field>
      <div className="stk-field"><span>&nbsp;</span><button type="button" className="btn btn--ghost" disabled={busy || !ingredientId || !lot.qty || !lot.expiryDate || Boolean(lotQtyError)}
        onClick={() => act(() => createInventoryLot({ branchId, ingredientId: ingredientId!, lotNo: lot.lotNo.trim(), qty: Number(lot.qty), expiryDate: lot.expiryDate }), "เพิ่ม lot แล้ว", () => { setLot({ lotNo: "", qty: "", expiryDate: todayBangkok() }); void lots.reload(); })}>เพิ่ม lot</button></div>
    </div>
    <SectionState state={lots} empty="ยังไม่มี lot ที่ใกล้หมดอายุใน 1 ปี">
      {(list) => <div className="bo-list">{list.slice(0, 20).map((l) => <div key={l.id} className="bo-list__row"><span><strong>{l.ingredient?.name ?? `#${l.ingredientId}`}{l.lotNo ? ` · lot ${l.lotNo}` : ""}</strong><small>{l.qty} · หมดอายุ {thaiDate(l.expiryDate, false)}</small></span></div>)}</div>}
    </SectionState>
  </Section>;
}
