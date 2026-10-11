import { createHash } from "node:crypto";

const QA_BRANCH = 2;
const QA_START = new Date("2026-10-10T15:40:00Z");
const QA_SETUP_START = new Date("2026-10-10T00:00:00+07:00");
const QA_END = new Date("2026-10-12T00:00:00+07:00");
const QA_ORDER_IDS = Array.from({ length: 2755 - 2733 + 1 }, (_, i) => 2733 + i);
const QA_PURCHASE_IDS = [13, 14];
const QA_COUNT_IDS = [2, 3];
const QA_TRANSFER_IDS = [1];
const QA_PHONES = ["0999999901", "0999000111"];
const isQaName = (value: unknown) => /^QA(?:\b|_)/i.test(String(value ?? "").trim());
const ids = (rows: any[]) => rows.map((row) => row.id);
const jsonRows = (rows: any[]) => JSON.parse(JSON.stringify(rows.sort((a, b) => a.id - b.id))) as any[];

export interface QaCleanupPlan {
  scope: string;
  preserved: string[];
  evidence: Record<string, string>;
  rows: Record<string, any[]>;
  fingerprint: string;
}
export interface QaCleanupManifest {
  version: 1;
  reviewed: boolean;
  generatedAt: string;
  plan: QaCleanupPlan;
}
function fingerprint(plan: Omit<QaCleanupPlan, "fingerprint">) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

/** Selectors identify review candidates; mutations use only the approved exact IDs. */
export async function buildQaCleanupPlan(db: any): Promise<QaCleanupPlan> {
  const orders = await db.order.findMany({ where: { id: { in: QA_ORDER_IDS } }, include: { items: true, payments: true, events: true } });
  for (const row of orders) {
    if (row.branchId !== QA_BRANCH || (new Date(row.createdAt) < QA_START || new Date(row.createdAt) >= QA_END)) throw new Error(`บิล #${row.id} ไม่ตรงสาขาหรือช่วงทดสอบ ต้องตรวจข้อมูลก่อน`);
  }
  const invoices = await db.taxInvoice.findMany({ where: { orderId: { in: ids(orders) } } });
  const purchases = await db.purchase.findMany({ where: { id: { in: QA_PURCHASE_IDS } }, include: { items: true } });
  for (const row of purchases) {
    if (row.branchId !== QA_BRANCH || (new Date(row.createdAt) < QA_START || new Date(row.createdAt) >= QA_END) || row.status !== "VOID") throw new Error(`ใบรับ #${row.id} ต้องตรงรอบ QA และถูกยกเลิกแล้วก่อนลบประวัติ`);
  }
  const stockCounts = await db.stockCount.findMany({ where: { id: { in: QA_COUNT_IDS }, branchId: { in: [1, QA_BRANCH] }, createdAt: { gte: QA_START, lt: QA_END } }, include: { items: true } });
  const stockTransfers = await db.stockTransfer.findMany({ where: { id: { in: QA_TRANSFER_IDS }, createdAt: { gte: QA_START, lt: QA_END }, OR: [{ fromBranchId: QA_BRANCH }, { toBranchId: QA_BRANCH }] }, include: { items: true } });
  const documents = (await db.businessDocument.findMany({ where: { branchId: QA_BRANCH, createdAt: { gte: QA_START, lt: QA_END }, OR: [{ customerName: { contains: "QA", mode: "insensitive" } }, { payload: { contains: "QA", mode: "insensitive" } }] } })).filter((row: any) => {
    let payload: any = {};
    try { payload = JSON.parse(row.payload); } catch { /* Missing evidence is excluded. */ }
    return isQaName(row.customerName) || isQaName(payload.note);
  });
  const customers = (await db.customer.findMany({ where: { createdAt: { gte: QA_SETUP_START, lt: QA_END }, OR: [{ phone: { in: QA_PHONES } }, { name: { startsWith: "QA", mode: "insensitive" } }] } })).filter((row: any) => QA_PHONES.includes(row.phone) || isQaName(row.name));
  const menuItems = await db.menuItem.findMany({ where: { sku: "QA-001", branchType: "coffee", createdAt: { gte: QA_SETUP_START, lt: QA_END } } });
  const productUnits = (await db.productUnit.findMany({ where: { OR: [{ menuItemId: { in: ids(menuItems) } }, { unitName: { startsWith: "QA", mode: "insensitive" } }] } })).filter((row: any) => ids(menuItems).includes(row.menuItemId) || isQaName(row.unitName));
  const priceRules = await db.priceRule.findMany({ where: { menuItemId: { in: ids(menuItems) } } });
  const productVariants = await db.productVariant.findMany({ where: { menuItemId: { in: ids(menuItems) } } });
  const recipes = await db.recipe.findMany({ where: { menuItemId: { in: ids(menuItems) } } });
  const lots = await db.inventoryLot.findMany({ where: { branchId: QA_BRANCH, createdAt: { gte: QA_START, lt: QA_END }, OR: [{ lotNo: { startsWith: "QA-" } }, { purchaseId: { in: ids(purchases) } }] } });
  const movements = (await db.stockMovement.findMany({ where: { branchId: { in: [1, QA_BRANCH] }, createdAt: { gte: QA_START, lt: QA_END } } })).filter((row: any) => {
    const order = /^(?:SALE|CANCELLED|REFUNDED)-(\d+)$/.exec(row.reason);
    if (order) return row.branchId === QA_BRANCH && ids(orders).includes(Number(order[1]));
    const receipt = /^PO(?:_VOID)?#(\d+)$/.exec(row.reason);
    if (receipt) return row.branchId === QA_BRANCH && ids(purchases).includes(Number(receipt[1]));
    const count = /^STOCKTAKE#(\d+)\b/.exec(row.reason);
    if (count) return stockCounts.some((item: any) => item.id === Number(count[1]) && item.branchId === row.branchId);
    const transfer = /^TRANSFER_(?:IN|OUT|CANCEL)#(\d+)$/.exec(row.reason);
    if (transfer) return stockTransfers.some((item: any) => item.id === Number(transfer[1]) && [item.fromBranchId, item.toBranchId].includes(row.branchId));
    return row.reason.includes("QA revert transfer test") || (row.branchId === QA_BRANCH && /^COUNT:\s*QA\b/.test(row.reason));
  });
  const outbox = await db.integrationOutbox.findMany({ where: { OR: [{ entityType: "order", entityId: { in: ids(orders) } }, { entityType: "tax_invoice", entityId: { in: ids(invoices) } }] } });
  const shiftIds = [...new Set(orders.map((row: any) => row.shiftId).filter(Boolean))];
  const shifts = await db.shift.findMany({ where: { id: { in: shiftIds } } });
  const remainingOrders = await db.order.findMany({ where: { shiftId: { in: shiftIds }, id: { notIn: ids(orders) } }, include: { payments: true } });
  const externalOrders = await db.order.count({ where: { id: { notIn: ids(orders) }, customerId: { in: ids(customers) } } });
  // Unit IDs are not stored on OrderItem: preserving any menu with real order
  // history avoids deleting a QA-labelled unit that might have been used there.
  const affectedMenuIds = [...new Set([...ids(menuItems), ...productUnits.map((unit: any) => unit.menuItemId)])];
  const externalItems = await db.orderItem.count({ where: { orderId: { notIn: ids(orders) }, menuItemId: { in: affectedMenuIds } } });
  const externalInvoices = await db.taxInvoice.count({ where: { id: { notIn: ids(invoices) }, customerId: { in: ids(customers) } } });
  if (externalOrders || externalItems || externalInvoices) throw new Error("สมาชิก สินค้า หรือหน่วย QA มีประวัติที่อยู่นอกแผน หยุดก่อนลบเพื่อคงข้อมูลจริง");
  const snapshot = {
    scope: "QA branch 2 orders #2733–#2755 and individually identified QA records from 10–11 October 2026",
    preserved: ["current ingredient stock and costs, including unknown Crystal water stock", "shop settings and real tax/address details", "staff, audit log, cash entries, shift status and closing details"],
    evidence: {
      orders: "Exact bill IDs reported by QA; branch 2 and start time validated",
      purchases: "Receipt IDs 13/14 from QA audit; only already-voided receipts",
      documents: "QA-prefixed buyer or note, branch 2, created after QA start",
      stockCounts: "Count IDs 2/3 from QA audit",
      stockTransfers: "Transfer ID 1 from QA audit, involving branch 2",
      customers: "QA-created names or the two recorded QA phone numbers",
      menuItems: "Exact test SKU QA-001; its category disappears with the test menu",
      productUnits: "Units of SKU QA-001 or explicitly QA-prefixed units",
      lots: "QA-prefixed lot numbers or the identified voided QA receipts on branch 2",
      movements: "Exact references to selected QA records; explicitly QA-labelled manual corrections",
      shifts: "Recalculate sales counters after bill removal; preserve opening/closing amounts and status"
    },
    rows: Object.fromEntries(Object.entries({ orders, invoices, purchases, stockCounts, stockTransfers, documents, customers, menuItems, productUnits, priceRules, productVariants, recipes, lots, movements, outbox, shifts, remainingOrders }).map(([key, rows]) => [key, jsonRows(rows)]))
  };
  return { ...snapshot, fingerprint: fingerprint(snapshot) };
}

export async function applyQaCleanup(db: any, manifest: QaCleanupManifest) {
  if (manifest?.version !== 1 || manifest.reviewed !== true || !manifest.plan?.fingerprint) throw new Error("ต้องตรวจ manifest และตั้ง reviewed=true ก่อนลบข้อมูล");
  const { fingerprint: savedFingerprint, ...savedPlan } = manifest.plan;
  if (fingerprint(savedPlan) !== savedFingerprint) throw new Error("manifest ถูกแก้รายการหลังสร้าง ให้สร้างแผนใหม่เพื่อตรวจอีกครั้ง");
  await db.$transaction(async (tx: any) => {
    const current = await buildQaCleanupPlan(tx);
    if (current.fingerprint !== savedFingerprint) throw new Error("ข้อมูลเปลี่ยนหลังตรวจ manifest จึงยังไม่ลบข้อมูล ให้สร้างแผนใหม่");
    const r = current.rows;
    const remove = (model: string, rows: any[]) => tx[model].deleteMany({ where: { id: { in: ids(rows) } } });
    await remove("integrationOutbox", r.outbox);
    await remove("taxInvoice", r.invoices);
    for (const model of ["payment", "orderEvent", "orderItem"]) await tx[model].deleteMany({ where: { orderId: { in: ids(r.orders) } } });
    await remove("order", r.orders);
    await remove("inventoryLot", r.lots);
    await remove("stockMovement", r.movements);
    await tx.purchaseItem.deleteMany({ where: { purchaseId: { in: ids(r.purchases) } } });
    await remove("purchase", r.purchases);
    await tx.stockCountItem.deleteMany({ where: { stockCountId: { in: ids(r.stockCounts) } } });
    await remove("stockCount", r.stockCounts);
    await tx.stockTransferItem.deleteMany({ where: { stockTransferId: { in: ids(r.stockTransfers) } } });
    await remove("stockTransfer", r.stockTransfers);
    await remove("businessDocument", r.documents);
    await remove("customer", r.customers);
    await remove("productUnit", r.productUnits);
    await remove("priceRule", r.priceRules);
    await remove("productVariant", r.productVariants);
    await remove("recipe", r.recipes);
    await remove("menuItem", r.menuItems);
    for (const shift of r.shifts) {
      const paid = r.remainingOrders.filter((order: any) => order.shiftId === shift.id && ["PAID", "READY"].includes(order.status));
      const sales = (methods: string[]) => paid.reduce((sum: number, order: any) => sum + (order.payments.length ? order.payments.filter((p: any) => p.status === "CONFIRMED" && methods.includes(p.method)).reduce((n: number, p: any) => n + p.amountDue, 0) : methods.includes(order.paymentMethod) ? order.total : 0), 0);
      await tx.shift.update({ where: { id: shift.id }, data: { totalOrders: paid.length, totalSales: paid.reduce((sum: number, order: any) => sum + order.total, 0), cashSales: sales(["CASH"]), qrSales: sales(["QR"]), cardSales: sales(["CARD", "EWALLET"]) } });
    }
  }, { isolationLevel: "Serializable", timeout: 120_000, maxWait: 20_000 });
}
