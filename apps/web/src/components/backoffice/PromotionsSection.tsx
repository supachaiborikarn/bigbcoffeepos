import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { createCoupon, createPromotion, deleteCoupon, deletePromotion, getCoupons, getMenu, getPromotions, updateCoupon, updatePromotion } from "../../api";
import type { Coupon, Promotion } from "../../types";
import { useToast } from "../../contexts/ToastContext";
import { displayCategoryLabel } from "../../utils/categoryLabel";
import { Field, money, Section, SectionState, thaiDate, useSectionData } from "./shared";

// Auto promotions (only the best single one applies to a bill) and coupons.
// Percent values are 1–100 and amounts > 0 here and on the server.

const PROMO_TYPES: Record<string, string> = { ORDER_PERCENT: "ลดทั้งบิล %", ORDER_FIXED: "ลดทั้งบิล บาท", CATEGORY_PERCENT: "ลดตามหมวด %" };

function valueError(type: string, raw: string) {
  if (raw.trim() === "") return "";
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return "ต้องมากกว่า 0";
  if (type.includes("PERCENT") && v > 100) return "เปอร์เซ็นต์ต้องไม่เกิน 100";
  return "";
}

const describe = (type: string, value: number) => type.includes("PERCENT") ? `${value}%` : money(value);
const toIsoEnd = (date: string) => date ? `${date}T23:59:59+07:00` : undefined;
const toIsoStart = (date: string) => date ? `${date}T00:00:00+07:00` : undefined;

export default function PromotionsSection({ branchType }: { branchType?: string }) {
  const toast = useToast();
  const promotions = useSectionData(getPromotions, []);
  const coupons = useSectionData(getCoupons, []);
  const menu = useSectionData(getMenu, []);
  const categories = useMemo(() => [...new Set((menu.data ?? []).filter((m) => !branchType || m.branchType === branchType).map((m) => m.category).filter(Boolean))].sort(), [menu.data, branchType]);
  const [promo, setPromo] = useState({ name: "", type: "ORDER_PERCENT", value: "", category: "", startAt: "", endAt: "" });
  const [coupon, setCoupon] = useState({ code: "", type: "ORDER_FIXED", value: "", maxUses: "", minSpend: "", expiresAt: "" });
  const [busy, setBusy] = useState(false);

  const promoError = valueError(promo.type, promo.value);
  const promoDateError = promo.startAt && promo.endAt && promo.endAt < promo.startAt ? "วันสิ้นสุดต้องอยู่หลังวันเริ่ม" : "";
  const canAddPromo = promo.name.trim() && promo.value && !promoError && !promoDateError && (promo.type !== "CATEGORY_PERCENT" || promo.category) && !busy;
  const couponError = valueError(coupon.type, coupon.value);
  const maxUsesError = coupon.maxUses && (!Number.isInteger(Number(coupon.maxUses)) || Number(coupon.maxUses) < 1) ? "จำนวนเต็มตั้งแต่ 1" : "";
  const minSpendError = coupon.minSpend && (!Number.isFinite(Number(coupon.minSpend)) || Number(coupon.minSpend) < 0) ? "ต้องไม่ติดลบ" : "";
  const codeError = coupon.code && !/^[A-Za-z0-9_-]{3,40}$/.test(coupon.code.trim()) ? "A-Z, 0-9, - หรือ _ ยาว 3–40 ตัว" : "";
  const canAddCoupon = coupon.code.trim() && coupon.value && !couponError && !maxUsesError && !minSpendError && !codeError && !busy;

  async function act(fn: () => Promise<unknown>, ok: string, reload: () => void) {
    setBusy(true);
    try { await fn(); toast.success(ok); reload(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  return <Section title="โปรโมชันและคูปอง" subtitle="โปรอัตโนมัติไม่ซ้อนกัน: ระบบเลือกโปรที่ลดได้มากที่สุดเพียง 1 โปรต่อบิล · แคชเชียร์ปิดโปรรายบิลได้">
    <h3 className="bo-h3">เพิ่มโปรโมชันอัตโนมัติ</h3>
    <div className="bo-grid">
      <Field label="ชื่อโปร *"><input className="input" value={promo.name} maxLength={80} onChange={(e) => setPromo({ ...promo, name: e.target.value })} placeholder="เช่น ลดเปิดร้าน 10%" /></Field>
      <Field label="ประเภท"><select className="input" value={promo.type} onChange={(e) => setPromo({ ...promo, type: e.target.value })}>{Object.entries(PROMO_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label={promo.type.includes("PERCENT") ? "ส่วนลด (%) *" : "ส่วนลด (บาท) *"} error={promoError}><input className="input" type="number" min="0" max={promo.type.includes("PERCENT") ? 100 : undefined} step="any" value={promo.value} onChange={(e) => setPromo({ ...promo, value: e.target.value })} aria-invalid={Boolean(promoError)} /></Field>
      {promo.type === "CATEGORY_PERCENT" && <Field label="หมวดสินค้า *"><select className="input" value={promo.category} onChange={(e) => setPromo({ ...promo, category: e.target.value })}><option value="">เลือกหมวด</option>{categories.map((c) => <option key={c} value={c}>{displayCategoryLabel(c)}</option>)}</select></Field>}
      <Field label="เริ่ม (ไม่บังคับ)"><input className="input" type="date" value={promo.startAt} onChange={(e) => setPromo({ ...promo, startAt: e.target.value })} /></Field>
      <Field label="สิ้นสุด (ไม่บังคับ)" error={promoDateError}><input className="input" type="date" value={promo.endAt} onChange={(e) => setPromo({ ...promo, endAt: e.target.value })} /></Field>
    </div>
    <div><button type="button" className="btn btn--primary" disabled={!canAddPromo} onClick={() => act(() => createPromotion({ name: promo.name.trim(), type: promo.type, value: Number(promo.value), category: promo.category, startAt: toIsoStart(promo.startAt), endAt: toIsoEnd(promo.endAt) }).then(() => setPromo({ name: "", type: "ORDER_PERCENT", value: "", category: "", startAt: "", endAt: "" })), "เพิ่มโปรโมชันแล้ว", promotions.reload)}>เพิ่มโปรโมชัน</button></div>

    <SectionState state={promotions} empty="ยังไม่มีโปรโมชัน">
      {(list: Promotion[]) => <div className="bo-list">{list.map((p) => {
        const invalid = p.type.includes("PERCENT") ? !(p.value > 0 && p.value <= 100) : !(p.value > 0);
        return <div key={p.id} className="bo-list__row">
          <span><strong>{p.name}</strong><small>{PROMO_TYPES[p.type] ?? p.type} · {describe(p.type, p.value)}{p.category ? ` · ${displayCategoryLabel(p.category)}` : ""}{p.startAt || p.endAt ? ` · ${thaiDate(p.startAt, false)} – ${thaiDate(p.endAt, false)}` : ""}</small>
            {invalid && <small className="negative">ค่าไม่ถูกต้อง ระบบไม่นำมาใช้ · ลบแล้วสร้างใหม่</small>}</span>
          <span className="bo-actions">
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => act(() => updatePromotion(p.id, { active: !p.active }), p.active ? "ปิดโปรแล้ว" : "เปิดโปรแล้ว", promotions.reload)}>{p.active ? "ปิด" : "เปิด"}</button>
            <button type="button" className="studio-icon-button" aria-label={`ลบ ${p.name}`} disabled={busy} onClick={() => { if (window.confirm(`ลบโปร ${p.name}?`)) void act(() => deletePromotion(p.id), "ลบโปรแล้ว", promotions.reload); }}><Trash2 size={15} /></button>
          </span>
        </div>;
      })}</div>}
    </SectionState>

    <h3 className="bo-h3">เพิ่มคูปอง</h3>
    <div className="bo-grid">
      <Field label="โค้ด *" error={codeError}><input className="input" value={coupon.code} maxLength={40} onChange={(e) => setCoupon({ ...coupon, code: e.target.value.toUpperCase() })} placeholder="เช่น WELCOME50" /></Field>
      <Field label="ประเภท"><select className="input" value={coupon.type} onChange={(e) => setCoupon({ ...coupon, type: e.target.value })}><option value="ORDER_FIXED">ลด บาท</option><option value="ORDER_PERCENT">ลด %</option></select></Field>
      <Field label={coupon.type === "ORDER_PERCENT" ? "ส่วนลด (%) *" : "ส่วนลด (บาท) *"} error={couponError}><input className="input" type="number" min="0" step="any" value={coupon.value} onChange={(e) => setCoupon({ ...coupon, value: e.target.value })} aria-invalid={Boolean(couponError)} /></Field>
      <Field label="ยอดซื้อขั้นต่ำ (บาท)" error={minSpendError} hint="เว้นว่าง = ไม่มีขั้นต่ำ"><input className="input" type="number" min="0" step="any" value={coupon.minSpend} onChange={(e) => setCoupon({ ...coupon, minSpend: e.target.value })} /></Field>
      <Field label="ใช้ได้กี่ครั้ง" error={maxUsesError} hint="เว้นว่าง = ไม่จำกัด"><input className="input" type="number" min="1" step="1" value={coupon.maxUses} onChange={(e) => setCoupon({ ...coupon, maxUses: e.target.value })} /></Field>
      <Field label="หมดอายุ" hint="เว้นว่าง = ไม่หมดอายุ"><input className="input" type="date" value={coupon.expiresAt} onChange={(e) => setCoupon({ ...coupon, expiresAt: e.target.value })} /></Field>
    </div>
    <div><button type="button" className="btn btn--primary" disabled={!canAddCoupon} onClick={() => act(() => createCoupon({ code: coupon.code.trim(), type: coupon.type, value: Number(coupon.value), maxUses: coupon.maxUses ? Number(coupon.maxUses) : null, minSpend: coupon.minSpend ? Number(coupon.minSpend) : 0, expiresAt: toIsoEnd(coupon.expiresAt) }).then(() => setCoupon({ code: "", type: "ORDER_FIXED", value: "", maxUses: "", minSpend: "", expiresAt: "" })), "เพิ่มคูปองแล้ว", coupons.reload)}>เพิ่มคูปอง</button></div>

    <SectionState state={coupons} empty="ยังไม่มีคูปอง">
      {(list: Coupon[]) => <div className="bo-list">{list.map((c) => {
        const expired = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
        const usedUp = c.maxUses != null && c.usedCount >= c.maxUses;
        const invalid = !(c.value > 0) || (c.type.includes("PERCENT") && c.value > 100);
        return <div key={c.id} className="bo-list__row">
          <span><strong>{c.code}</strong><small>{describe(c.type, c.value)}{c.minSpend > 0 ? ` · ขั้นต่ำ ${money(c.minSpend)}` : ""} · ใช้แล้ว {c.usedCount}{c.maxUses != null ? `/${c.maxUses}` : ""}{c.expiresAt ? ` · หมดอายุ ${thaiDate(c.expiresAt, false)}` : ""}</small>
            {(expired || usedUp || invalid) && <small className="negative">{invalid ? "ค่าไม่ถูกต้อง ใช้ไม่ได้" : expired ? "หมดอายุแล้ว" : "ใช้ครบแล้ว"}</small>}</span>
          <span className="bo-actions">
            <span className={`stk-badge ${c.active ? "is-ok" : "is-out"}`}>{c.active ? "เปิดใช้" : "ปิด"}</span>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => act(() => updateCoupon(c.id, { active: !c.active }), c.active ? "ปิดคูปองแล้ว" : "เปิดคูปองแล้ว", coupons.reload)}>{c.active ? "ปิด" : "เปิด"}</button>
            <button type="button" className="studio-icon-button" aria-label={`ลบ ${c.code}`} disabled={busy} onClick={() => { if (window.confirm(`ลบคูปอง ${c.code}?`)) void act(() => deleteCoupon(c.id), "ลบคูปองแล้ว", coupons.reload); }}><Trash2 size={15} /></button>
          </span>
        </div>;
      })}</div>}
    </SectionState>
  </Section>;
}
