import { useMemo, useState } from "react";
import { Ban, Printer } from "lucide-react";
import { createTaxInvoice, getOrders, getStoreSetting, getTaxInvoices, voidTaxInvoice } from "../../api";
import type { TaxInvoice } from "../../types";
import { useToast } from "../../contexts/ToastContext";
import { isValidThaiTaxId } from "../../utils/taxId";
import { Field, money, SearchPicker, Section, SectionState, StatusBadge, thaiDate, useSectionData } from "./shared";

// Full tax invoices (ใบกำกับภาษีเต็มรูป). Only paid bills can be invoiced, once
// each; the server copies the seller's details and works out VAT like the
// receipt does. A wrong invoice is voided (its number stays used) and re-issued.

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const missingLegacyDetails = (invoice: TaxInvoice) => !invoice.sellerName?.trim() || !invoice.sellerTaxId?.trim() || !invoice.sellerAddress?.trim() || !(invoice.vatRate > 0);

function printTaxInvoice(invoice: TaxInvoice) {
  const win = window.open("", "_blank", "width=820,height=960");
  if (!win) return false;
  const base = invoice.total - invoice.tax;
  const items = invoice.order?.items ?? [];
  const rows = items.map((item, i) => `<tr><td>${i + 1}</td><td>${esc(item.name)}${item.modifiers?.length ? `<div class="mod">${esc(item.modifiers.map((m) => m.value).join(", "))}</div>` : ""}</td><td class="n">${esc(item.qty)}</td><td class="n">${esc(money(item.unitPrice))}</td><td class="n">${esc(money(item.lineTotal))}</td></tr>`).join("");
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(invoice.invoiceNo)}</title>
  <style>
    body{font-family:Sarabun,"Noto Sans Thai",sans-serif;padding:28px;color:#111;font-size:14px}
    h1{font-size:20px;margin:0 0 2px}.sub{color:#555;margin:0 0 16px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}.box{border:1px solid #ccc;border-radius:6px;padding:10px 12px}
    .box b{display:block;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}
    .n{text-align:right;white-space:nowrap}.mod{color:#666;font-size:12px}.sum td{border:0;padding:3px 6px}.total td{font-size:16px;font-weight:700;border-top:2px solid #111}
    .void{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:72px;color:rgba(200,0,0,.25);transform:rotate(-20deg);font-weight:800}
  </style></head><body>
  ${invoice.status === "VOID" ? `<div class="void">ยกเลิก</div>` : ""}
  <h1>ใบกำกับภาษีเต็มรูป / Tax Invoice</h1>
  <p class="sub">เลขที่ ${esc(invoice.invoiceNo)} · วันที่ ${esc(thaiDate(invoice.createdAt, false))} · อ้างอิงบิล #${esc(invoice.orderId)}${invoice.order ? ` (${esc(thaiDate(invoice.order.createdAt))})` : ""}</p>
  ${missingLegacyDetails(invoice) ? `<p>ข้อมูลผู้ขายหรืออัตรา VAT ของเอกสารเดิมยังไม่ครบ กรุณายืนยันจากเอกสารต้นฉบับก่อนใช้งาน</p>` : ""}
  <div class="grid">
    <div class="box"><b>ผู้ขาย</b>${esc(invoice.sellerName)}<br>เลขประจำตัวผู้เสียภาษี ${esc(invoice.sellerTaxId)}<br>สาขา ${esc(invoice.sellerBranch || "สำนักงานใหญ่")}<br>${esc(invoice.sellerAddress)}</div>
    <div class="box"><b>ผู้ซื้อ</b>${esc(invoice.buyerName)}<br>เลขประจำตัวผู้เสียภาษี ${esc(invoice.buyerTaxId)}<br>สาขา ${esc(invoice.buyerBranch || "สำนักงานใหญ่")}<br>${esc(invoice.buyerAddress)}</div>
  </div>
  <table><thead><tr><th>#</th><th>รายการ</th><th class="n">จำนวน</th><th class="n">ราคา/หน่วย</th><th class="n">จำนวนเงิน</th></tr></thead><tbody>${rows || `<tr><td colspan="5">-</td></tr>`}</tbody></table>
  <table class="sum">
    <tr><td>รวมเป็นเงิน</td><td class="n">${esc(money(invoice.subtotal))}</td></tr>
    ${invoice.discountAmount ? `<tr><td>ส่วนลด</td><td class="n">-${esc(money(invoice.discountAmount))}</td></tr>` : ""}
    <tr><td>มูลค่าก่อนภาษีมูลค่าเพิ่ม</td><td class="n">${esc(money(base))}</td></tr>
    <tr><td>ภาษีมูลค่าเพิ่ม ${invoice.vatRate > 0 ? `${esc(invoice.vatRate)}%` : "(ยังไม่ยืนยันอัตรา)"}</td><td class="n">${esc(money(invoice.tax))}</td></tr>
    <tr class="total"><td>จำนวนเงินรวมทั้งสิ้น</td><td class="n">${esc(money(invoice.total))}</td></tr>
  </table>
  ${invoice.status === "VOID" ? `<p>ยกเลิกเมื่อ ${esc(thaiDate(invoice.voidedAt))} เหตุผล: ${esc(invoice.voidReason)}</p>` : ""}
  <script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
  return true;
}

export default function TaxInvoiceSection({ branchId }: { branchId: number }) {
  const toast = useToast();
  const invoices = useSectionData(() => getTaxInvoices(branchId), [branchId]);
  const orders = useSectionData(() => getOrders(branchId, 300), [branchId]);
  const setting = useSectionData(() => getStoreSetting(branchId), [branchId]);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [form, setForm] = useState({ buyerName: "", buyerTaxId: "", buyerBranch: "สำนักงานใหญ่", buyerAddress: "" });
  const [busy, setBusy] = useState(false);

  const invoicedOrderIds = useMemo(() => new Set((invoices.data ?? []).filter((i) => i.status === "ISSUED").map((i) => i.orderId)), [invoices.data]);
  // only paid bills that don't already have a live invoice
  const orderOptions = useMemo(() => (orders.data ?? [])
    .filter((o) => (o.status === "PAID" || o.status === "READY") && !invoicedOrderIds.has(o.id))
    .map((o) => ({ id: o.id, label: `บิล #${o.id}`, sub: `${money(o.total)} · ${thaiDate(o.createdAt)}` })), [orders.data, invoicedOrderIds]);
  const selectedOrder = (orders.data ?? []).find((o) => o.id === orderId) ?? null;

  const taxIdDigits = form.buyerTaxId.replace(/[\s-]/g, "");
  const taxIdError = taxIdDigits && !isValidThaiTaxId(taxIdDigits) ? "ต้องเป็นตัวเลข 13 หลักที่ถูกต้อง" : "";
  const shop = setting.data;
  const shopMissing = shop ? [!shop.shopName?.trim() && "ชื่อร้าน", !shop.addressLine?.trim() && "ที่อยู่", !shop.taxId && "เลขผู้เสียภาษี"].filter(Boolean) as string[] : [];
  const canIssue = Boolean(orderId && form.buyerName.trim() && form.buyerAddress.trim() && taxIdDigits && !taxIdError && shop && !shopMissing.length && !busy);

  async function issue() {
    if (!canIssue || !orderId) return;
    setBusy(true);
    try {
      const invoice = await createTaxInvoice({ orderId, ...form, buyerTaxId: taxIdDigits });
      toast.success(`ออกใบกำกับ ${invoice.invoiceNo} แล้ว`);
      setOrderId(null);
      setForm({ buyerName: "", buyerTaxId: "", buyerBranch: "สำนักงานใหญ่", buyerAddress: "" });
      invoices.setData((list) => [invoice as TaxInvoice, ...(list ?? [])]);
      if (!printTaxInvoice(invoice as TaxInvoice)) toast.info("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กดพิมพ์จากรายการด้านล่าง");
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  async function voidInvoice(invoice: TaxInvoice) {
    const reason = window.prompt(`ยกเลิกใบกำกับ ${invoice.invoiceNo}\nระบุเหตุผล (เช่น ชื่อผู้ซื้อผิด):`);
    if (!reason?.trim()) return;
    try {
      const updated = await voidTaxInvoice(invoice.id, reason.trim());
      invoices.setData((list) => (list ?? []).map((i) => i.id === updated.id ? updated : i));
      toast.success(`ยกเลิกใบกำกับ ${invoice.invoiceNo} แล้ว`);
    } catch (err) { toast.error((err as Error).message); }
  }

  return <Section title="ใบกำกับภาษีเต็มรูป" subtitle="ออกได้เฉพาะบิลที่ชำระแล้ว บิลละ 1 ใบ · ข้อมูลผู้ขายดึงจากตั้งค่าร้าน">
    {(invoices.data ?? []).some(missingLegacyDetails) && <div className="bo-error" role="alert"><span>ใบกำกับภาษีเดิมบางใบยังขาดข้อมูลผู้ขายหรืออัตรา VAT ต้องยืนยันจากเอกสารต้นฉบับก่อนใช้งาน</span></div>}
    {shop && shopMissing.length > 0 && <div className="bo-error" role="alert"><span>ตั้งค่าร้านยังไม่ครบ: {shopMissing.join(", ")} · ไปที่ <a href="/settings">ตั้งค่า &gt; ร้าน</a> ก่อนออกใบกำกับ</span></div>}
    {setting.error && <div className="bo-error" role="alert"><span>โหลดตั้งค่าร้านไม่สำเร็จ: {setting.error}</span><button type="button" className="btn btn--ghost" onClick={() => setting.reload()}>ลองใหม่</button></div>}
    <div className="bo-grid">
      <Field label="บิลที่ชำระแล้ว *" hint={selectedOrder ? `ยอด ${money(selectedOrder.total)} · ${selectedOrder.items.length} รายการ` : orders.loading ? "กำลังโหลดบิล..." : "พิมพ์เลขบิลเพื่อค้นหา (300 บิลล่าสุด)"} wide>
        {orders.error ? <button type="button" className="btn btn--ghost" onClick={() => orders.reload()}>โหลดบิลไม่สำเร็จ · ลองใหม่</button>
          : <SearchPicker label="เลือกบิล" placeholder="พิมพ์เลขบิล เช่น 2745" options={orderOptions} value={orderId} onChange={setOrderId} emptyText="ไม่พบบิลที่ชำระแล้วและยังไม่ออกใบกำกับ" />}
      </Field>
      <Field label="ชื่อผู้ซื้อ / บริษัท *"><input className="input" value={form.buyerName} maxLength={200} onChange={(e) => setForm({ ...form, buyerName: e.target.value })} /></Field>
      <Field label="เลขประจำตัวผู้เสียภาษีผู้ซื้อ *" error={taxIdError} hint="13 หลัก"><input className="input" inputMode="numeric" value={form.buyerTaxId} maxLength={17} onChange={(e) => setForm({ ...form, buyerTaxId: e.target.value })} aria-invalid={Boolean(taxIdError)} /></Field>
      <Field label="สาขาผู้ซื้อ"><input className="input" value={form.buyerBranch} maxLength={100} onChange={(e) => setForm({ ...form, buyerBranch: e.target.value })} /></Field>
      <Field label="ที่อยู่ผู้ซื้อ *" wide><textarea className="input" rows={2} value={form.buyerAddress} maxLength={600} onChange={(e) => setForm({ ...form, buyerAddress: e.target.value })} /></Field>
    </div>
    <div><button type="button" className="btn btn--primary" disabled={!canIssue} onClick={issue}>{busy ? "กำลังออก..." : "ออกใบกำกับและพิมพ์"}</button></div>

    <SectionState state={invoices} empty="ยังไม่มีใบกำกับภาษี">
      {(list) => <div className="bo-table" role="table" aria-label="ใบกำกับภาษี">
        <div className="bo-row bo-row--head" role="row"><span>เลขที่</span><span>วันที่</span><span>บิล</span><span>ผู้ซื้อ</span><span className="n">VAT</span><span className="n">รวม</span><span>สถานะ</span><span /></div>
        {list.map((inv) => <div key={inv.id} role="row" className={`bo-row${inv.status === "VOID" ? " is-void" : ""}`}>
          <span><strong>{inv.invoiceNo}</strong></span><span>{thaiDate(inv.createdAt)}</span><span>#{inv.orderId}</span>
          <span>{inv.buyerName}<small>{inv.buyerTaxId}</small></span>
          <span className="n">{money(inv.tax)}</span><span className="n">{money(inv.total)}</span>
          <span><StatusBadge status={inv.status} />{inv.status === "VOID" && <small>{inv.voidReason}</small>}</span>
          <span className="bo-actions">
            <button type="button" className="studio-icon-button" aria-label={`พิมพ์ ${inv.invoiceNo}`} onClick={() => printTaxInvoice(inv)}><Printer size={15} /></button>
            {inv.status === "ISSUED" && <button type="button" className="studio-icon-button" aria-label={`ยกเลิก ${inv.invoiceNo}`} onClick={() => voidInvoice(inv)}><Ban size={15} /></button>}
          </span>
        </div>)}
      </div>}
    </SectionState>
  </Section>;
}
