import { useEffect, useMemo, useState } from "react";
import {
  approvePurchase,
  createBusinessDocument,
  createCoupon,
  createInventoryLot,
  createPriceRule,
  createProductUnit,
  createProductVariant,
  createPromotion,
  updatePromotion,
  deletePromotion,
  updateCoupon,
  deleteCoupon,
  createStockCount,
  createStockTransfer,
  createTaxInvoice,
  enqueueDailySummaryEmail,
  getBusinessDocuments,
  getCompareReport,
  getCoupons,
  getIngredients,
  getInventoryLots,
  getMarketplaces,
  getMenu,
  getOrders,
  getPriceRules,
  getProductUnits,
  getProductVariants,
  getPromotions,
  getPurchases,
  getStockCounts,
  getStockTransfers,
  getTaxExportUrl,
  getTaxInvoices,
  postStockCount,
  receiveStockTransfer,
  saveDailyEmailSetting,
  saveMarketplace,
  syncMarketplace,
  updateCustomer,
  getCustomers
} from "../api";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";
import type { CompareReport, Customer, Ingredient, MenuItem, Order, PurchaseOrder } from "../types";

const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
const today = new Date().toISOString().slice(0, 10);

const panelStyle: React.CSSProperties = { padding: 18, display: "grid", gap: 12 };
const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 };
const inputStyle: React.CSSProperties = { width: "100%", minHeight: 40, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8 };
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };

function numberValue(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function printTaxInvoice(invoice: any) {
  const win = window.open("", "_blank", "width=760,height=900");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${invoice.invoiceNo}</title>
  <style>body{font-family:Sarabun,Prompt,sans-serif;padding:32px;color:#111}h1{font-size:24px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:8px 0}.total{font-size:20px;font-weight:700}</style></head><body>
  <h1>ใบกำกับภาษีเต็มรูป</h1>
  <p>เลขที่ ${invoice.invoiceNo}</p>
  <p>บิล #${invoice.orderId}</p>
  <p>ผู้ซื้อ: ${invoice.buyerName}</p>
  <p>เลขภาษี: ${invoice.buyerTaxId || "-"}</p>
  <p>สาขา: ${invoice.buyerBranch || "-"}</p>
  <p>ที่อยู่: ${invoice.buyerAddress || "-"}</p>
  <div class="row"><span>มูลค่าสินค้า</span><strong>${money.format(invoice.subtotal)}</strong></div>
  <div class="row"><span>ส่วนลด</span><strong>${money.format(invoice.discountAmount)}</strong></div>
  <div class="row"><span>VAT</span><strong>${money.format(invoice.tax)}</strong></div>
  <div class="row total"><span>รวม</span><strong>${money.format(invoice.total)}</strong></div>
  <script>window.print()</script></body></html>`);
  win.document.close();
}

function DataTable({ columns, rows }: { columns: string[]; rows: Array<Array<string | number | null | undefined>> }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>{columns.map((column) => <th key={column} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{ padding: 8, borderBottom: "1px solid var(--border-light)" }}>{cell ?? ""}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ParityPage() {
  const { branches, activeBranch } = useBranch();
  const toast = useToast();
  const branchId = activeBranch?.id ?? branches[0]?.id ?? 1;

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
  const [data, setData] = useState<Record<string, any>>({});
  const [compare, setCompare] = useState<CompareReport | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [
      nextIngredients,
      nextMenu,
      nextOrders,
      nextCustomers,
      nextPurchases,
      taxInvoices,
      stockCounts,
      stockTransfers,
      productUnits,
      priceRules,
      inventoryLots,
      variants,
      promotions,
      coupons,
      docs,
      marketplaces
    ] = await Promise.all([
      getIngredients(),
      getMenu(),
      getOrders(branchId),
      getCustomers(),
      getPurchases(branchId),
      getTaxInvoices(branchId),
      getStockCounts(branchId),
      getStockTransfers(branchId),
      getProductUnits(),
      getPriceRules(),
      getInventoryLots(branchId),
      getProductVariants(),
      getPromotions(),
      getCoupons(),
      getBusinessDocuments(branchId),
      getMarketplaces(branchId)
    ]);
    setIngredients(nextIngredients);
    setMenu(nextMenu);
    setOrders(nextOrders);
    setCustomers(nextCustomers);
    setPurchases(nextPurchases);
    setData({ taxInvoices, stockCounts, stockTransfers, productUnits, priceRules, inventoryLots, variants, promotions, coupons, docs, marketplaces });
  };

  useEffect(() => {
    refresh().catch((error) => toast.error((error as Error).message));
  }, [branchId]);

  const firstIngredient = ingredients[0]?.id ?? 0;
  const firstMenu = menu[0]?.id ?? 0;
  const firstOrder = orders[0]?.id ?? 0;
  const firstCustomer = customers[0]?.id ?? 0;
  const otherBranch = useMemo(() => branches.find((branch) => branch.id !== branchId)?.id ?? branchId, [branches, branchId]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      await refresh();
      toast.success(message);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 24, display: "grid", gap: 18 }}>
      <div>
        <h1 style={{ margin: 0 }}>งานเพิ่มเติม POSPOS</h1>
        <p className="muted" style={{ marginTop: 6 }}>รวมงาน Phase A-D ที่เหลือไว้ในหน้าจัดการเดียว</p>
      </div>

      <section className="panel" style={panelStyle}>
        <h2>ใบกำกับเต็มรูป</h2>
        <div style={gridStyle}>
          <select style={inputStyle} value={data.orderId ?? firstOrder} onChange={(e) => setData({ ...data, orderId: Number(e.target.value) })}>
            {orders.map((order) => <option key={order.id} value={order.id}>บิล #{order.id} · {money.format(order.total)}</option>)}
          </select>
          <input style={inputStyle} placeholder="ชื่อผู้ซื้อ" value={data.buyerName ?? ""} onChange={(e) => setData({ ...data, buyerName: e.target.value })} />
          <input style={inputStyle} placeholder="เลขผู้เสียภาษีผู้ซื้อ" value={data.buyerTaxId ?? ""} onChange={(e) => setData({ ...data, buyerTaxId: e.target.value })} />
          <input style={inputStyle} placeholder="สาขาผู้ซื้อ" value={data.buyerBranch ?? ""} onChange={(e) => setData({ ...data, buyerBranch: e.target.value })} />
        </div>
        <textarea style={inputStyle} placeholder="ที่อยู่ผู้ซื้อ" value={data.buyerAddress ?? ""} onChange={(e) => setData({ ...data, buyerAddress: e.target.value })} />
        <button className="btn btn--primary" disabled={busy || !firstOrder} onClick={() => run(() => createTaxInvoice({ orderId: Number(data.orderId ?? firstOrder), buyerName: data.buyerName ?? "", buyerTaxId: data.buyerTaxId, buyerAddress: data.buyerAddress, buyerBranch: data.buyerBranch }), "ออกใบกำกับเต็มรูปแล้ว")}>ออกใบกำกับเต็มรูป</button>
        {(data.taxInvoices ?? [])[0] && <button className="btn btn--ghost" onClick={() => printTaxInvoice((data.taxInvoices ?? [])[0])}>พิมพ์ใบกำกับล่าสุด</button>}
        <DataTable columns={["เลขที่", "บิล", "ผู้ซื้อ", "VAT", "รวม", "e-Tax"]} rows={(data.taxInvoices ?? []).map((item: any) => [item.invoiceNo, item.orderId, item.buyerName, money.format(item.tax), money.format(item.total), item.eTaxStatus])} />
      </section>

      <section className="panel" style={panelStyle}>
        <h2>นับสต็อก · โอนสต็อกระหว่างสาขา</h2>
        <p style={{ margin: "2px 0 8px", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>① นับสต็อก — กรอกยอดนับจริงเทียบกับระบบ</p>
        <div style={gridStyle}>
          <select style={inputStyle} value={data.countIngredientId ?? firstIngredient} onChange={(e) => setData({ ...data, countIngredientId: Number(e.target.value) })}>
            {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <input style={inputStyle} type="number" placeholder="ยอดนับจริง" value={data.countedQty ?? ""} onChange={(e) => setData({ ...data, countedQty: e.target.value })} />
          <input style={inputStyle} placeholder="หมายเหตุ" value={data.stockCountNote ?? ""} onChange={(e) => setData({ ...data, stockCountNote: e.target.value })} />
          <button className="btn btn--primary" disabled={busy || !firstIngredient} onClick={() => run(() => createStockCount({ branchId, note: data.stockCountNote, items: [{ ingredientId: Number(data.countIngredientId ?? firstIngredient), countedQty: numberValue(data.countedQty ?? "0") }] }), "บันทึกรอบนับแล้ว")}>เปิดรอบนับ</button>
        </div>
        <DataTable columns={["รอบ", "สถานะ", "หมายเหตุ", "รายการ"]} rows={(data.stockCounts ?? []).map((item: any) => [item.id, item.status, item.note, item.items?.length ?? 0])} />
        {(data.stockCounts ?? []).some((item: any) => item.status !== "POSTED") && (
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => postStockCount((data.stockCounts ?? []).find((item: any) => item.status !== "POSTED").id), "บันทึกส่วนต่างสต็อกแล้ว")}>บันทึกส่วนต่างรอบล่าสุด</button>
        )}
        <p style={{ margin: "14px 0 8px", paddingTop: 12, borderTop: "1px solid var(--border-light)", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>② โอนสต็อก — เลือกสาขาปลายทาง + วัตถุดิบ + จำนวน (โอนออกจากสาขานี้)</p>
        <div style={gridStyle}>
          <select style={inputStyle} value={data.transferToBranchId ?? otherBranch} onChange={(e) => setData({ ...data, transferToBranchId: Number(e.target.value) })}>
            {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select style={inputStyle} value={data.transferIngredientId ?? firstIngredient} onChange={(e) => setData({ ...data, transferIngredientId: Number(e.target.value) })}>
            {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <input style={inputStyle} type="number" placeholder="จำนวนโอน" value={data.transferQty ?? ""} onChange={(e) => setData({ ...data, transferQty: e.target.value })} />
          <button className="btn btn--primary" disabled={busy || !firstIngredient || otherBranch === branchId} onClick={() => run(() => createStockTransfer({ fromBranchId: branchId, toBranchId: Number(data.transferToBranchId ?? otherBranch), items: [{ ingredientId: Number(data.transferIngredientId ?? firstIngredient), qty: numberValue(data.transferQty ?? "0") }] }), "สร้างใบโอนแล้ว")}>สร้างใบโอน</button>
        </div>
        {(data.stockTransfers ?? []).some((item: any) => item.status !== "RECEIVED") && (
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => receiveStockTransfer((data.stockTransfers ?? []).find((item: any) => item.status !== "RECEIVED").id), "รับโอนแล้ว")}>รับโอนใบล่าสุด</button>
        )}
      </section>

      <section className="panel" style={panelStyle}>
        <h2>สินค้าแบบมินิมาร์ท</h2>
        <div style={gridStyle}>
          <select style={inputStyle} value={data.menuItemId ?? firstMenu} onChange={(e) => setData({ ...data, menuItemId: Number(e.target.value) })}>
            {menu.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <input style={inputStyle} placeholder="หน่วย เช่น ลัง" value={data.unitName ?? ""} onChange={(e) => setData({ ...data, unitName: e.target.value })} />
          <input style={inputStyle} type="number" placeholder="ตัวคูณ เช่น 12" value={data.unitFactor ?? ""} onChange={(e) => setData({ ...data, unitFactor: e.target.value })} />
          <button className="btn btn--primary" disabled={busy || !firstMenu} onClick={() => run(() => createProductUnit({ menuItemId: Number(data.menuItemId ?? firstMenu), unitName: data.unitName ?? "", factor: numberValue(data.unitFactor ?? "1"), price: data.unitPrice ? numberValue(data.unitPrice) : null }), "เพิ่มหน่วยสินค้าแล้ว")}>เพิ่มหน่วย</button>
          <input style={inputStyle} type="number" placeholder="ราคาตาม tier/จำนวน" value={data.priceRulePrice ?? ""} onChange={(e) => setData({ ...data, priceRulePrice: e.target.value })} />
          <input style={inputStyle} placeholder="tier ลูกค้า" value={data.priceRuleTier ?? ""} onChange={(e) => setData({ ...data, priceRuleTier: e.target.value })} />
          <button className="btn btn--ghost" disabled={busy || !firstMenu} onClick={() => run(() => createPriceRule({ menuItemId: Number(data.menuItemId ?? firstMenu), customerTier: data.priceRuleTier ?? "", price: numberValue(data.priceRulePrice ?? "0") }), "เพิ่มราคาพิเศษแล้ว")}>เพิ่มราคาพิเศษ</button>
          <input style={inputStyle} placeholder="lot no" value={data.lotNo ?? ""} onChange={(e) => setData({ ...data, lotNo: e.target.value })} />
          <input style={inputStyle} type="number" placeholder="จำนวน lot" value={data.lotQty ?? ""} onChange={(e) => setData({ ...data, lotQty: e.target.value })} />
          <input style={inputStyle} type="date" value={data.expiryDate ?? today} onChange={(e) => setData({ ...data, expiryDate: e.target.value })} />
          <button className="btn btn--ghost" disabled={busy || !firstIngredient} onClick={() => run(() => createInventoryLot({ branchId, ingredientId: firstIngredient, lotNo: data.lotNo, qty: numberValue(data.lotQty ?? "0"), expiryDate: data.expiryDate ?? today }), "เพิ่ม lot แล้ว")}>เพิ่ม lot/วันหมดอายุ</button>
          <input style={inputStyle} placeholder="ตัวเลือก เช่น สี" value={data.variantName ?? ""} onChange={(e) => setData({ ...data, variantName: e.target.value })} />
          <input style={inputStyle} placeholder="ค่า เช่น แดง" value={data.variantValue ?? ""} onChange={(e) => setData({ ...data, variantValue: e.target.value })} />
          <button className="btn btn--ghost" disabled={busy || !firstMenu} onClick={() => run(() => createProductVariant({ menuItemId: Number(data.menuItemId ?? firstMenu), optionName: data.variantName ?? "", optionValue: data.variantValue ?? "", priceDelta: 0 }), "เพิ่ม variant แล้ว")}>เพิ่ม SKU variant</button>
        </div>
      </section>

      <section className="panel" style={panelStyle}>
        <h2>โปรโมชั่น สมาชิก และคูปอง</h2>
        <div style={gridStyle}>
          <input style={inputStyle} placeholder="ชื่อโปรโมชัน" value={data.promotionName ?? ""} onChange={(e) => setData({ ...data, promotionName: e.target.value })} />
          <select style={inputStyle} value={data.promotionType ?? "ORDER_PERCENT"} onChange={(e) => setData({ ...data, promotionType: e.target.value })}>
            <option value="ORDER_PERCENT">ลดทั้งบิล %</option>
            <option value="ORDER_FIXED">ลดทั้งบิล บาท</option>
            <option value="CATEGORY_PERCENT">ลดตามหมวด %</option>
          </select>
          <input style={inputStyle} type="number" placeholder="มูลค่า" value={data.promotionValue ?? ""} onChange={(e) => setData({ ...data, promotionValue: e.target.value })} />
          <button className="btn btn--primary" disabled={busy} onClick={() => run(() => createPromotion({ name: data.promotionName ?? "", type: data.promotionType ?? "ORDER_PERCENT", value: numberValue(data.promotionValue ?? "0"), category: data.promotionCategory ?? "" }), "เพิ่มโปรโมชันแล้ว")}>เพิ่มโปรโมชัน</button>
          <input style={inputStyle} placeholder="รหัสคูปอง" value={data.couponCode ?? ""} onChange={(e) => setData({ ...data, couponCode: e.target.value })} />
          <input style={inputStyle} type="number" placeholder="ส่วนลดคูปอง" value={data.couponValue ?? ""} onChange={(e) => setData({ ...data, couponValue: e.target.value })} />
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => createCoupon({ code: data.couponCode ?? "", type: "ORDER_FIXED", value: numberValue(data.couponValue ?? "0") }), "เพิ่มคูปองแล้ว")}>เพิ่มคูปอง</button>
          <select style={inputStyle} value={data.customerId ?? firstCustomer} onChange={(e) => setData({ ...data, customerId: Number(e.target.value) })}>
            {customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <input style={inputStyle} placeholder="tier / tag เช่น VIP" value={data.customerTier ?? ""} onChange={(e) => setData({ ...data, customerTier: e.target.value })} />
          <button className="btn btn--ghost" disabled={busy || !firstCustomer} onClick={() => run(() => updateCustomer(Number(data.customerId ?? firstCustomer), { tier: data.customerTier ?? "REGULAR", tags: [data.customerTier ?? ""] }), "อัปเดตสมาชิกแล้ว")}>บันทึก tier/tag</button>
        </div>

        {(data.promotions ?? []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <h3 style={{ fontSize: 14, margin: "8px 0" }}>โปรโมชั่นที่มี</h3>
            {(data.promotions ?? []).map((promo: any) => (
              <div key={promo.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                <span style={{ fontSize: 13 }}>
                  {promo.active ? "🟢" : "⚪"} {promo.name} · {promo.type.includes("PERCENT") ? `${promo.value}%` : money.format(promo.value)}
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn--ghost" style={{ fontSize: 12, padding: "2px 8px" }} disabled={busy} onClick={() => run(() => updatePromotion(promo.id, { active: !promo.active }), promo.active ? "ปิดโปรโมชันแล้ว" : "เปิดโปรโมชันแล้ว")}>{promo.active ? "ปิด" : "เปิด"}</button>
                  <button className="btn btn--ghost" style={{ fontSize: 12, padding: "2px 8px", color: "var(--danger)" }} disabled={busy} onClick={() => run(() => deletePromotion(promo.id), "ลบโปรโมชันแล้ว")}>ลบ</button>
                </span>
              </div>
            ))}
          </div>
        )}

        {(data.coupons ?? []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <h3 style={{ fontSize: 14, margin: "8px 0" }}>คูปองที่มี</h3>
            {(data.coupons ?? []).map((coupon: any) => (
              <div key={coupon.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                <span style={{ fontSize: 13 }}>
                  {coupon.active ? "🟢" : "⚪"} {coupon.code} · {coupon.type.includes("PERCENT") ? `${coupon.value}%` : money.format(coupon.value)} · ใช้แล้ว {coupon.usedCount}{coupon.maxUses != null ? `/${coupon.maxUses}` : ""}
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn--ghost" style={{ fontSize: 12, padding: "2px 8px" }} disabled={busy} onClick={() => run(() => updateCoupon(coupon.id, { active: !coupon.active }), coupon.active ? "ปิดคูปองแล้ว" : "เปิดคูปองแล้ว")}>{coupon.active ? "ปิด" : "เปิด"}</button>
                  <button className="btn btn--ghost" style={{ fontSize: 12, padding: "2px 8px", color: "var(--danger)" }} disabled={busy} onClick={() => run(() => deleteCoupon(coupon.id), "ลบคูปองแล้ว")}>ลบ</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel" style={panelStyle}>
        <h2>เอกสาร รายงาน และช่องทางต่อเชื่อม</h2>
        <div style={gridStyle}>
          <select style={inputStyle} value={data.docType ?? "DELIVERY_NOTE"} onChange={(e) => setData({ ...data, docType: e.target.value })}>
            <option value="DELIVERY_NOTE">ใบส่งของ</option>
            <option value="INVOICE">ใบแจ้งหนี้</option>
            <option value="QUOTATION">ใบเสนอราคา</option>
            <option value="CREDIT_NOTE">ใบลดหนี้</option>
          </select>
          <input style={inputStyle} placeholder="ชื่อลูกค้าในเอกสาร" value={data.docCustomer ?? ""} onChange={(e) => setData({ ...data, docCustomer: e.target.value })} />
          <input style={inputStyle} type="number" placeholder="ยอดเอกสาร" value={data.docTotal ?? ""} onChange={(e) => setData({ ...data, docTotal: e.target.value })} />
          <button className="btn btn--primary" disabled={busy} onClick={() => run(() => createBusinessDocument({ branchId, type: data.docType ?? "INVOICE", customerName: data.docCustomer ?? "", total: numberValue(data.docTotal ?? "0") }), "สร้างเอกสารแล้ว")}>สร้างเอกสาร</button>
          <input style={inputStyle} type="date" value={data.compareFromA ?? today} onChange={(e) => setData({ ...data, compareFromA: e.target.value })} />
          <input style={inputStyle} type="date" value={data.compareToA ?? today} onChange={(e) => setData({ ...data, compareToA: e.target.value })} />
          <button className="btn btn--ghost" disabled={busy} onClick={() => getCompareReport({ fromA: data.compareFromA ?? today, toA: data.compareToA ?? today, fromB: data.compareFromB ?? today, toB: data.compareToB ?? today, branchIdA: branchId, branchIdB: branchId }).then(setCompare).catch((error) => toast.error((error as Error).message))}>เทียบยอดขาย</button>
          <a className="btn btn--ghost" href={getTaxExportUrl({ from: data.compareFromA ?? today, to: data.compareToA ?? today, branchId })}>Export ภาษี Excel</a>
          <input style={inputStyle} placeholder="อีเมลรับสรุปรายวัน" value={data.emailRecipients ?? ""} onChange={(e) => setData({ ...data, emailRecipients: e.target.value })} />
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(async () => { await saveDailyEmailSetting({ branchId, recipients: data.emailRecipients ?? "", enabled: true }); await enqueueDailySummaryEmail({ date: today, branchId }); }, "ตั้งค่าและคิวอีเมลสรุปยอดแล้ว")}>ตั้งค่าอีเมลรายวัน</button>
          <input style={inputStyle} placeholder="Marketplace เช่น SHOPEE" value={data.marketProvider ?? ""} onChange={(e) => setData({ ...data, marketProvider: e.target.value })} />
          <input style={inputStyle} placeholder="ชื่อร้านบน marketplace" value={data.marketShop ?? ""} onChange={(e) => setData({ ...data, marketShop: e.target.value })} />
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(async () => { const item = await saveMarketplace({ branchId, provider: data.marketProvider ?? "SHOPEE", shopName: data.marketShop ?? "" }); await syncMarketplace(item.id); }, "บันทึกและคิว sync marketplace แล้ว")}>เชื่อม marketplace</button>
        </div>
        {compare && <p className="muted">ผลต่างยอดขาย {money.format(compare.diff.revenue)} จาก {compare.diff.orders} บิล</p>}
        <DataTable columns={["เอกสาร", "ประเภท", "ลูกค้า", "ยอด", "สถานะ"]} rows={(data.docs ?? []).map((item: any) => [item.documentNo, item.type, item.customerName, money.format(item.total), item.status])} />
      </section>

      <section className="panel" style={panelStyle}>
        <h2>ใบสั่งซื้อรออนุมัติ</h2>
        <DataTable columns={["เลขที่", "ผู้ขาย", "ยอด", "สถานะ"]} rows={purchases.map((item) => [item.id, item.supplier, money.format(item.totalCost), item.status])} />
        {purchases.some((item) => item.status !== "APPROVED") && (
          <button className="btn btn--ghost" disabled={busy} onClick={() => run(() => approvePurchase(purchases.find((item) => item.status !== "APPROVED")!.id), "อนุมัติใบสั่งซื้อแล้ว")}>อนุมัติใบสั่งซื้อรายการแรก</button>
        )}
      </section>
    </main>
  );
}
