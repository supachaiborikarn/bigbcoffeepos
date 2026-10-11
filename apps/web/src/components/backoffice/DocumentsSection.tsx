import { useState } from "react";
import { FileDown, Printer } from "lucide-react";
import { convertQuotationToInvoice, createBusinessDocument, downloadAuthedFile, getBusinessDocuments, getStoreSetting, getTaxExportUrl, setBusinessDocumentStatus, updateBusinessDocument } from "../../api";
import type { BusinessDocument, BusinessDocumentType, StoreSetting } from "../../types";
import { useToast } from "../../contexts/ToastContext";
import { Field, money, Section, SectionState, StatusBadge, thaiDate, todayBangkok, useSectionData } from "./shared";

// Back-office documents. Each type has its own running number (DN/INV/QT/CN),
// drafts can be edited, then issued -> (invoice) paid, or voided with a reason;
// an accepted quotation converts into an invoice draft.

const TYPE_LABEL: Record<BusinessDocumentType, string> = { DELIVERY_NOTE: "ใบส่งของ", INVOICE: "ใบแจ้งหนี้", QUOTATION: "ใบเสนอราคา", CREDIT_NOTE: "ใบลดหนี้" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function printDocument(doc: BusinessDocument, shop: StoreSetting | null) {
  const win = window.open("", "_blank", "width=760,height=900");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(doc.documentNo)}</title>
  <style>body{font-family:Sarabun,"Noto Sans Thai",sans-serif;padding:32px;color:#111}h1{font-size:22px;margin:0}.muted{color:#555}.box{border:1px solid #ccc;border-radius:6px;padding:12px;margin:14px 0}.total{font-size:20px;font-weight:700;text-align:right;border-top:2px solid #111;padding-top:8px}.void{color:#b42318;font-weight:700}</style></head><body>
  <h1>${esc(TYPE_LABEL[doc.type] ?? doc.type)}</h1>
  <p class="muted">เลขที่ ${esc(doc.documentNo)} · วันที่ ${esc(thaiDate(doc.createdAt, false))}${doc.status === "VOID" ? ` · <span class="void">ยกเลิก: ${esc(doc.payload.voidReason)}</span>` : ""}</p>
  <div class="box"><b>${esc(shop?.shopName || "")}</b><br>${esc(shop?.addressLine || "")}${shop?.taxId ? `<br>เลขผู้เสียภาษี ${esc(shop.taxId)}` : ""}${shop?.phone ? `<br>โทร ${esc(shop.phone)}` : ""}</div>
  <div class="box"><b>ลูกค้า</b><br>${esc(doc.customerName)}</div>
  ${doc.payload.note ? `<p>${esc(doc.payload.note)}</p>` : ""}${doc.payload.fromQuotation ? `<p class="muted">อ้างอิงใบเสนอราคา ${esc(doc.payload.fromQuotation)}</p>` : ""}
  <p class="total">ยอดรวม ${esc(money(doc.total))}</p>
  <script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

export default function DocumentsSection({ branchId }: { branchId: number }) {
  const toast = useToast();
  const docs = useSectionData(() => getBusinessDocuments(branchId), [branchId]);
  const shop = useSectionData(() => getStoreSetting(branchId), [branchId]);
  const [form, setForm] = useState({ type: "INVOICE" as BusinessDocumentType, customerName: "", total: "", note: "" });
  const [editing, setEditing] = useState<{ id: number; customerName: string; total: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportRange, setExportRange] = useState({ from: todayBangkok().slice(0, 8) + "01", to: todayBangkok() });

  const totalError = form.total && !(Number(form.total) > 0) ? "ยอดต้องมากกว่า 0" : "";
  const canCreate = form.customerName.trim() && Number(form.total) > 0 && !busy;

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); await docs.reload(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  const exportError = exportRange.from > exportRange.to ? "วันเริ่มต้องไม่หลังวันสิ้นสุด" : "";
  async function exportTax() {
    if (exportError) return;
    try {
      await downloadAuthedFile(getTaxExportUrl({ ...exportRange, branchId }), `tax-invoices_${exportRange.from}_${exportRange.to}.xls`);
    } catch (err) { toast.error(`Export ภาษีไม่สำเร็จ: ${(err as Error).message}`); }
  }

  return <Section title="เอกสารหลังร้าน" subtitle="เลขที่แยกตามประเภทเอกสาร · ร่างแก้ไขได้ ออกแล้วต้องยกเลิกพร้อมเหตุผล">
    <div className="bo-grid">
      <Field label="ประเภท"><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as BusinessDocumentType })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="ชื่อลูกค้า *"><input className="input" value={form.customerName} maxLength={200} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
      <Field label="ยอดเอกสาร (บาท) *" error={totalError}><input className="input" type="number" min="0" step="any" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} /></Field>
      <Field label="หมายเหตุ"><input className="input" value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
    </div>
    <div><button type="button" className="btn btn--primary" disabled={!canCreate} onClick={() => act(() => createBusinessDocument({ branchId, type: form.type, customerName: form.customerName.trim(), total: Number(form.total), payload: form.note.trim() ? { note: form.note.trim() } : {} }).then(() => setForm({ ...form, customerName: "", total: "", note: "" })), "สร้างเอกสารร่างแล้ว")}>สร้างเอกสาร (ร่าง)</button></div>

    <SectionState state={docs} empty="ยังไม่มีเอกสาร">
      {(list) => <div className="bo-table" role="table" aria-label="เอกสาร">
        <div className="bo-row bo-row--head" role="row"><span>เลขที่</span><span>ประเภท</span><span>วันที่</span><span>ลูกค้า</span><span className="n">ยอด</span><span>สถานะ</span><span /></div>
        {list.map((doc) => {
          const isEditing = editing?.id === doc.id;
          return <div key={doc.id} role="row" className={`bo-row${doc.status === "VOID" ? " is-void" : ""}`}>
            <span><strong>{doc.documentNo}</strong></span><span>{TYPE_LABEL[doc.type] ?? doc.type}</span><span>{thaiDate(doc.createdAt)}</span>
            <span>{isEditing ? <input className="input" value={editing.customerName} onChange={(e) => setEditing({ ...editing, customerName: e.target.value })} aria-label="ชื่อลูกค้า" /> : <>{doc.customerName}{doc.payload.fromQuotation && <small>จาก {doc.payload.fromQuotation}</small>}{doc.payload.convertedTo && <small>แปลงเป็น {doc.payload.convertedTo}</small>}</>}</span>
            <span className="n">{isEditing ? <input className="input" type="number" min="0" step="any" value={editing.total} onChange={(e) => setEditing({ ...editing, total: e.target.value })} aria-label="ยอด" /> : money(doc.total)}</span>
            <span><StatusBadge status={doc.status} />{doc.status === "VOID" && doc.payload.voidReason && <small>{doc.payload.voidReason}</small>}</span>
            <span className="bo-actions">
              {isEditing ? <>
                <button type="button" className="btn btn--primary" disabled={busy || !editing.customerName.trim() || !(Number(editing.total) > 0)} onClick={() => act(() => updateBusinessDocument(doc.id, { customerName: editing.customerName.trim(), total: Number(editing.total) }).then(() => setEditing(null)), "บันทึกแล้ว")}>บันทึก</button>
                <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>ยกเลิก</button>
              </> : <>
                {doc.status === "DRAFT" && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setEditing({ id: doc.id, customerName: doc.customerName, total: String(doc.total) })}>แก้ไข</button>}
                {doc.status === "DRAFT" && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => act(() => setBusinessDocumentStatus(doc.id, "ISSUED"), `ออก ${doc.documentNo} แล้ว`)}>ออกเอกสาร</button>}
                {doc.type === "INVOICE" && doc.status === "ISSUED" && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => act(() => setBusinessDocumentStatus(doc.id, "PAID"), "บันทึกว่าชำระแล้ว")}>ชำระแล้ว</button>}
                {doc.type === "QUOTATION" && (doc.status === "DRAFT" || doc.status === "ISSUED") && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => act(() => convertQuotationToInvoice(doc.id), "สร้างใบแจ้งหนี้จากใบเสนอราคาแล้ว")}>แปลงเป็นใบแจ้งหนี้</button>}
                <button type="button" className="studio-icon-button" aria-label={`พิมพ์ ${doc.documentNo}`} onClick={() => printDocument(doc, shop.data)}><Printer size={15} /></button>
                {doc.status !== "VOID" && doc.status !== "ACCEPTED" && <button type="button" className="btn btn--ghost" style={{ color: "var(--danger)" }} disabled={busy} onClick={() => { const reason = window.prompt(`ยกเลิก ${doc.documentNo}: ระบุเหตุผล`); if (reason?.trim()) void act(() => setBusinessDocumentStatus(doc.id, "VOID", reason.trim()), `ยกเลิก ${doc.documentNo} แล้ว`); }}>ยกเลิก</button>}
              </>}
            </span>
          </div>;
        })}
      </div>}
    </SectionState>

    <h3 className="bo-h3">Export ใบกำกับภาษี (Excel)</h3>
    <div className="bo-grid">
      <Field label="ตั้งแต่"><input className="input" type="date" value={exportRange.from} onChange={(e) => setExportRange({ ...exportRange, from: e.target.value })} /></Field>
      <Field label="ถึง" error={exportError}><input className="input" type="date" value={exportRange.to} onChange={(e) => setExportRange({ ...exportRange, to: e.target.value })} /></Field>
      <div className="stk-field"><span>&nbsp;</span><button type="button" className="btn btn--ghost" disabled={Boolean(exportError)} onClick={exportTax}><FileDown size={15} /> Export ภาษี Excel</button></div>
    </div>
  </Section>;
}
