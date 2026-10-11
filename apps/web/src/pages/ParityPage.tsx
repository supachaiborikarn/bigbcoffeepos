import { useState } from "react";
import { Link } from "react-router-dom";
import { enqueueDailySummaryEmail, getCompareReport, getMarketplaces, saveDailyEmailSetting, saveMarketplace, syncMarketplace } from "../api";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";
import type { CompareReport } from "../types";
import TaxInvoiceSection from "../components/backoffice/TaxInvoiceSection";
import PromotionsSection from "../components/backoffice/PromotionsSection";
import DocumentsSection from "../components/backoffice/DocumentsSection";
import MinimartSection from "../components/backoffice/MinimartSection";
import { Field, money, Section, SectionState, todayBangkok, useSectionData } from "../components/backoffice/shared";

// Back office: tax invoices, promotions & coupons, documents, minimart setup and
// a few integrations. Every section loads and fails on its own, so one slow
// request no longer blanks the whole page. Stock counts and transfers live on
// the stock page (สต็อกวัตถุดิบ), which has the full count sheet and transfer flow.

type Tab = "tax" | "promo" | "docs" | "minimart" | "tools";
const TABS: Array<[Tab, string]> = [["tax", "ใบกำกับภาษี"], ["promo", "โปรโมชัน/คูปอง"], ["docs", "เอกสาร"], ["minimart", "สินค้ามินิมาร์ท"], ["tools", "เครื่องมืออื่น"]];

function ToolsSection({ branchId }: { branchId: number }) {
  const toast = useToast();
  const today = todayBangkok();
  const [range, setRange] = useState({ fromA: today, toA: today, fromB: today, toB: today });
  const [compare, setCompare] = useState<CompareReport | null>(null);
  const [email, setEmail] = useState("");
  const [market, setMarket] = useState({ provider: "SHOPEE", shopName: "" });
  const marketplaces = useSectionData(() => getMarketplaces(branchId), [branchId]);
  const rangeError = range.fromA > range.toA || range.fromB > range.toB ? "วันเริ่มต้องไม่หลังวันสิ้นสุด" : "";
  const emailError = email && !email.split(",").every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim())) ? "อีเมลไม่ถูกต้อง (คั่นหลายอีเมลด้วย ,)" : "";

  return <Section title="เครื่องมืออื่น" subtitle="เทียบยอดขาย · อีเมลสรุปรายวัน · ช่องทางขายออนไลน์">
    <h3 className="bo-h3">เทียบยอดขาย 2 ช่วง</h3>
    <div className="bo-grid">
      <Field label="ช่วง A ตั้งแต่"><input className="input" type="date" value={range.fromA} onChange={(e) => setRange({ ...range, fromA: e.target.value })} /></Field>
      <Field label="ถึง"><input className="input" type="date" value={range.toA} onChange={(e) => setRange({ ...range, toA: e.target.value })} /></Field>
      <Field label="ช่วง B ตั้งแต่"><input className="input" type="date" value={range.fromB} onChange={(e) => setRange({ ...range, fromB: e.target.value })} /></Field>
      <Field label="ถึง" error={rangeError}><input className="input" type="date" value={range.toB} onChange={(e) => setRange({ ...range, toB: e.target.value })} /></Field>
    </div>
    <div><button type="button" className="btn btn--ghost" disabled={Boolean(rangeError)} onClick={() => getCompareReport({ ...range, branchIdA: branchId, branchIdB: branchId }).then(setCompare).catch((err) => toast.error((err as Error).message))}>เทียบยอดขาย</button></div>
    {compare && <p className="muted">ช่วง B ต่างจากช่วง A {money(compare.diff.revenue)} · {compare.diff.orders} บิล</p>}

    <h3 className="bo-h3">อีเมลสรุปยอดรายวัน</h3>
    <div className="bo-grid">
      <Field label="อีเมลผู้รับ" error={emailError} wide><input className="input" type="email" multiple value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" /></Field>
    </div>
    <div><button type="button" className="btn btn--ghost" disabled={!email.trim() || Boolean(emailError)} onClick={async () => {
      try { await saveDailyEmailSetting({ branchId, recipients: email.trim(), enabled: true }); await enqueueDailySummaryEmail({ date: today, branchId }); toast.success("บันทึกอีเมลและส่งสรุปของวันนี้เข้าคิวแล้ว"); }
      catch (err) { toast.error((err as Error).message); }
    }}>บันทึกและส่งสรุปวันนี้</button></div>

    <h3 className="bo-h3">ช่องทางขายออนไลน์</h3>
    <div className="bo-grid">
      <Field label="แพลตฟอร์ม"><select className="input" value={market.provider} onChange={(e) => setMarket({ ...market, provider: e.target.value })}><option value="SHOPEE">Shopee</option><option value="LAZADA">Lazada</option><option value="LINEMAN">LINE MAN</option><option value="GRAB">Grab</option></select></Field>
      <Field label="ชื่อร้านบนแพลตฟอร์ม"><input className="input" value={market.shopName} maxLength={100} onChange={(e) => setMarket({ ...market, shopName: e.target.value })} /></Field>
      <div className="stk-field"><span>&nbsp;</span><button type="button" className="btn btn--ghost" disabled={!market.shopName.trim()} onClick={async () => {
        try { const item = await saveMarketplace({ branchId, provider: market.provider, shopName: market.shopName.trim() }); await syncMarketplace(item.id); toast.success("บันทึกและคิว sync แล้ว"); void marketplaces.reload(); }
        catch (err) { toast.error((err as Error).message); }
      }}>เชื่อมต่อ</button></div>
    </div>
    <SectionState state={marketplaces} empty="ยังไม่ได้เชื่อมช่องทางใด">
      {(list) => <div className="bo-list">{list.map((m) => <div key={m.id} className="bo-list__row"><span><strong>{m.provider}</strong><small>{m.shopName}</small></span></div>)}</div>}
    </SectionState>
  </Section>;
}

export default function ParityPage() {
  const { branches, activeBranch } = useBranch();
  const branchId = activeBranch?.id ?? branches[0]?.id ?? 0;
  const [tab, setTab] = useState<Tab>("tax");
  if (!branchId) return <main className="bo-page"><p className="stk-hint">เลือกสาขาก่อน</p></main>;

  return (
    <main className="bo-page">
      <div className="bo-page__head">
        <div>
          <h1>เอกสาร ภาษี และโปรโมชัน</h1>
          <p className="muted">{activeBranch?.name} · นับสต็อกและโอนสต็อกอยู่ที่ <Link to="/inventory?tab=ingredients">หน้าสต็อกวัตถุดิบ</Link></p>
        </div>
      </div>
      <nav className="bo-tabs" role="tablist" aria-label="หมวดงานหลังร้าน">
        {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>{label}</button>)}
      </nav>
      {tab === "tax" && <TaxInvoiceSection branchId={branchId} />}
      {tab === "promo" && <PromotionsSection branchType={activeBranch?.branchType} />}
      {tab === "docs" && <DocumentsSection branchId={branchId} />}
      {tab === "minimart" && <MinimartSection branchId={branchId} branchType={activeBranch?.branchType} />}
      {tab === "tools" && <ToolsSection branchId={branchId} />}
    </main>
  );
}
