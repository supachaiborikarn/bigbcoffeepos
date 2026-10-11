import prisma from "../prisma.js";
import { getStoreSetting } from "./settings.js";
import { isValidThaiTaxId, normalizeThaiTaxId } from "../lib/taxId.js";

const db = prisma as any;

function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseJson(value: unknown, fallback: unknown = {}) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return fallback;
  }
}

function toDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Next number in its own series: PREFIX-branch-year-000001, one series per
 * prefix (document type), branch and year. Reads the highest number issued in
 * that series rather than counting rows, so deleted rows or other prefixes in
 * the same table never shift it; the field is unique, so a race just retries.
 */
async function nextRunningNo(prefix: string, branchId: number, table: string, field: string) {
  const series = `${prefix}-${branchId}-${new Date().getFullYear()}-`;
  const last = await db[table].findFirst({ where: { [field]: { startsWith: series } }, orderBy: { [field]: "desc" }, select: { [field]: true } });
  const lastNo = last ? Number(String(last[field]).slice(series.length)) || 0 : 0;
  return `${series}${String(lastNo + 1).padStart(6, "0")}`;
}

async function withRunningNo<T>(make: () => Promise<string>, create: (no: string) => Promise<T>) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await create(await make()); }
    catch (error: any) { if (error?.code !== "P2002" || attempt >= 4) throw error; }
  }
}

/** VAT inside an order: the stored figure, or (older orders saved before the VAT fix) derived the same way the receipt prints it. */
export function orderVat(order: { total: number; tax: number }, setting: { vatMode: string; vatRate: number }) {
  const rate = Number(setting.vatRate) > 0 && setting.vatMode !== "NONE" ? Number(setting.vatRate) : 0;
  const tax = Number(order.tax) > 0 ? roundMoney(order.tax) : setting.vatMode === "INCLUSIVE" && rate ? roundMoney(order.total * rate / (100 + rate)) : 0;
  return { rate, tax, base: roundMoney(order.total - tax) };
}

function hydrateInvoice(row: any) {
  if (!row) return row;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    order: row.order ? {
      id: row.order.id,
      createdAt: row.order.createdAt.toISOString(),
      paymentMethod: row.order.paymentMethod,
      items: (row.order.items ?? []).map((item: any) => ({ name: item.name, qty: item.qty, unitPrice: item.qty ? roundMoney(item.lineTotal / item.qty) : item.lineTotal, lineTotal: item.lineTotal, modifiers: parseJson(item.modifiers, []) }))
    } : undefined
  };
}

export async function listTaxInvoices(branchId?: number) {
  const rows = await db.taxInvoice.findMany({
    where: branchId ? { branchId } : undefined,
    include: { order: { include: { items: true } }, customer: true, branch: true },
    orderBy: { id: "desc" },
    take: 100
  });
  return rows.map(hydrateInvoice);
}

const INVOICEABLE_ORDER_STATUSES = new Set(["PAID", "READY"]);

export async function createTaxInvoice(input: {
  orderId: number;
  buyerName: string;
  buyerTaxId?: string;
  buyerAddress?: string;
  buyerBranch?: string;
}) {
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    include: { customer: true, branch: true }
  });
  if (!order) throw new Error("ไม่พบออเดอร์");
  if (!INVOICEABLE_ORDER_STATUSES.has(order.status)) throw new Error(`บิล #${order.id} ถูกยกเลิก/คืนเงินแล้ว ออกใบกำกับภาษีไม่ได้`);
  const existing = await db.taxInvoice.findFirst({ where: { orderId: order.id, status: "ISSUED" }, select: { invoiceNo: true } });
  if (existing) throw new Error(`บิล #${order.id} ออกใบกำกับภาษีแล้ว (${existing.invoiceNo})`);

  const buyerName = input.buyerName.trim();
  const buyerAddress = String(input.buyerAddress ?? "").trim();
  if (!buyerName) throw new Error("กรุณาระบุชื่อผู้ซื้อ");
  if (!buyerAddress) throw new Error("กรุณาระบุที่อยู่ผู้ซื้อ");
  const buyerTaxId = normalizeThaiTaxId(input.buyerTaxId, "เลขผู้เสียภาษีผู้ซื้อ");

  // seller details are copied onto the invoice: a legal document must not change when settings do later
  const setting = await getStoreSetting(order.branchId);
  if (!setting.shopName.trim() || !setting.addressLine.trim() || !setting.taxId) {
    throw new Error("ตั้งค่าร้านให้ครบก่อน (ชื่อร้าน ที่อยู่ เลขผู้เสียภาษี) ที่หน้า ตั้งค่า > ร้าน");
  }
  if (!isValidThaiTaxId(setting.taxId)) throw new Error("เลขผู้เสียภาษีของร้านไม่ถูกต้อง แก้ที่หน้า ตั้งค่า > ร้าน");
  const vat = orderVat(order, setting);
  if (!vat.rate) throw new Error("ร้านตั้งค่าไม่คิด VAT จึงออกใบกำกับภาษีไม่ได้");

  const invoice = await withRunningNo(
    () => nextRunningNo("TAX", order.branchId, "taxInvoice", "invoiceNo"),
    (invoiceNo) => db.taxInvoice.create({
      data: {
        branchId: order.branchId,
        orderId: order.id,
        customerId: order.customerId ?? null,
        invoiceNo,
        buyerName: buyerName.slice(0, 200),
        buyerTaxId,
        buyerAddress: buyerAddress.slice(0, 600),
        buyerBranch: String(input.buyerBranch ?? "").trim().slice(0, 100) || "สำนักงานใหญ่",
        sellerName: setting.shopName.trim().slice(0, 200),
        sellerTaxId: setting.taxId,
        sellerAddress: setting.addressLine.trim().slice(0, 600),
        sellerBranch: setting.branchLabel.trim().slice(0, 100) || order.branch?.name || "",
        vatRate: vat.rate,
        subtotal: roundMoney(order.subtotal),
        discountAmount: roundMoney(order.discountAmount),
        tax: vat.tax,
        total: roundMoney(order.total)
      },
      include: { order: { include: { items: true } }, customer: true, branch: true }
    })
  ) as any;

  await db.integrationOutbox.create({
    data: {
      provider: "rd_tax",
      eventType: "TAX_INVOICE_ISSUED",
      entityType: "tax_invoice",
      entityId: invoice.id,
      payload: JSON.stringify({
        invoiceNo: invoice.invoiceNo,
        orderId: order.id,
        branchId: order.branchId,
        sellerTaxId: invoice.sellerTaxId,
        buyerName: invoice.buyerName,
        buyerTaxId: invoice.buyerTaxId,
        buyerAddress: invoice.buyerAddress,
        buyerBranch: invoice.buyerBranch,
        subtotal: invoice.subtotal,
        discountAmount: invoice.discountAmount,
        vatRate: invoice.vatRate,
        tax: invoice.tax,
        total: invoice.total
      })
    }
  });

  return hydrateInvoice(invoice);
}

/** Cancel an issued invoice (wrong buyer details, or the sale was reversed). The number stays used. */
export async function voidTaxInvoice(id: number, reason: string) {
  const invoice = await db.taxInvoice.findUnique({ where: { id } });
  if (!invoice) throw new Error("ไม่พบใบกำกับภาษี");
  if (invoice.status === "VOID") throw new Error("ใบกำกับนี้ถูกยกเลิกไปแล้ว");
  const why = reason.trim();
  if (!why) throw new Error("กรุณาระบุเหตุผลที่ยกเลิก");
  const updated = await db.taxInvoice.update({
    where: { id },
    data: { status: "VOID", voidedAt: new Date(), voidReason: why.slice(0, 300) },
    include: { order: { include: { items: true } }, customer: true, branch: true }
  });
  await db.integrationOutbox.create({
    data: { provider: "rd_tax", eventType: "TAX_INVOICE_VOIDED", entityType: "tax_invoice", entityId: id, payload: JSON.stringify({ invoiceNo: invoice.invoiceNo, reason: why }) }
  });
  return hydrateInvoice(updated);
}

export async function listStockCounts(branchId?: number) {
  const rows = await db.stockCount.findMany({
    where: branchId ? { branchId } : undefined,
    include: { items: { include: { ingredient: true } }, branch: true },
    orderBy: { id: "desc" }
  });
  return rows;
}

export async function createStockCount(input: {
  branchId: number;
  note?: string;
  items: { ingredientId: number; countedQty: number }[];
}) {
  if (!input.items.length) throw new Error("กรุณาเพิ่มรายการนับสต็อก");
  if (input.items.some((item) => !item.ingredientId)) throw new Error("กรุณาเลือกสินค้าที่นับ");
  if (input.items.some((item) => !Number.isFinite(item.countedQty) || item.countedQty < 0)) throw new Error("ยอดนับต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
  return db.$transaction(async (tx: any) => {
    const stockCount = await tx.stockCount.create({
      data: { branchId: input.branchId, note: input.note?.trim() ?? "" }
    });

    for (const item of input.items) {
      const stock = await tx.ingredientStock.findUnique({
        where: { branchId_ingredientId: { branchId: input.branchId, ingredientId: item.ingredientId } }
      });
      const expectedQty = roundMoney(stock?.stockQty ?? 0);
      const countedQty = roundMoney(item.countedQty);
      const differenceQty = roundMoney(countedQty - expectedQty);
      await tx.stockCountItem.create({
        data: { stockCountId: stockCount.id, ingredientId: item.ingredientId, expectedQty, countedQty, differenceQty }
      });
    }
    return tx.stockCount.findUnique({
      where: { id: stockCount.id },
      include: { items: { include: { ingredient: true } }, branch: true }
    });
  });
}

/** Drop a count round that was opened by mistake (nothing was posted to stock). */
export async function cancelStockCount(id: number) {
  const stockCount = await db.stockCount.findUnique({ where: { id } });
  if (!stockCount) throw new Error("ไม่พบรอบนับสต็อก");
  if (stockCount.status === "POSTED") throw new Error("รอบนับนี้บันทึกเข้าสต็อกแล้ว ยกเลิกไม่ได้ ให้นับใหม่แทน");
  return db.stockCount.update({ where: { id }, data: { status: "CANCELLED" } });
}

export async function postStockCount(id: number) {
  return db.$transaction(async (tx: any) => {
    const stockCount = await tx.stockCount.findUnique({ where: { id }, include: { items: true } });
    if (!stockCount) throw new Error("ไม่พบรอบนับสต็อก");
    if (stockCount.status === "POSTED") return stockCount;
    if (stockCount.status === "CANCELLED") throw new Error("รอบนับนี้ถูกยกเลิกแล้ว");

    for (const item of stockCount.items) {
      if (item.differenceQty === 0) continue;
      await tx.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId: stockCount.branchId, ingredientId: item.ingredientId } },
        update: { stockQty: item.countedQty },
        create: { branchId: stockCount.branchId, ingredientId: item.ingredientId, stockQty: item.countedQty, reorderLevel: 0 }
      });
      await tx.stockMovement.create({
        // keep what was counted vs. the system figure (and the round's note) on the movement itself
        data: { branchId: stockCount.branchId, ingredientId: item.ingredientId, qty: item.differenceQty, reason: `STOCKTAKE#${id}: นับได้ ${item.countedQty} (ระบบ ${item.expectedQty})${stockCount.note ? ` · ${String(stockCount.note).slice(0, 120)}` : ""}` }
      });
    }

    return tx.stockCount.update({ where: { id }, data: { status: "POSTED", postedAt: new Date() } });
  });
}

export async function listStockTransfers(branchId?: number) {
  return db.stockTransfer.findMany({
    where: branchId ? { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] } : undefined,
    include: { fromBranch: true, toBranch: true, items: { include: { ingredient: true } } },
    orderBy: { id: "desc" }
  });
}

export async function createStockTransfer(input: {
  fromBranchId: number;
  toBranchId: number;
  note?: string;
  items: { ingredientId: number; qty: number }[];
}) {
  if (input.fromBranchId === input.toBranchId) throw new Error("เลือกสาขาต้นทางและปลายทางคนละสาขา");
  if (!input.items.length) throw new Error("กรุณาเพิ่มรายการโอน");
  const ids = input.items.map((item) => item.ingredientId);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("รายการโอนไม่ถูกต้อง (สินค้าซ้ำหรือไม่ได้เลือก)");
  if (input.items.some((item) => !Number.isFinite(item.qty) || item.qty <= 0)) throw new Error("จำนวนโอนต้องมากกว่า 0");
  const [from, to] = await Promise.all([
    db.branch.findUnique({ where: { id: input.fromBranchId }, select: { branchType: true, active: true } }),
    db.branch.findUnique({ where: { id: input.toBranchId }, select: { branchType: true, active: true, name: true } })
  ]);
  if (!from || !to || to.active === false) throw new Error("ไม่พบสาขาปลายทาง");
  // a coffee shop can't send stock to the oil-change business, and vice versa
  if (from.branchType !== to.branchType) throw new Error(`โอนได้เฉพาะสาขาในธุรกิจเดียวกัน (${to.name} เป็นคนละธุรกิจ)`);

  // Stock leaves the sender when the transfer is sent (in transit), never more than it has.
  return db.$transaction(async (tx: any) => {
    const transfer = await tx.stockTransfer.create({
      data: {
        fromBranchId: input.fromBranchId,
        toBranchId: input.toBranchId,
        status: "IN_TRANSIT",
        approvedAt: new Date(),
        note: input.note?.trim().slice(0, 200) ?? "",
        items: { create: input.items.map((item) => ({ ingredientId: item.ingredientId, qty: roundMoney(item.qty) })) }
      }
    });
    for (const item of input.items) {
      const qty = roundMoney(item.qty);
      const taken = await tx.ingredientStock.updateMany({
        where: { branchId: input.fromBranchId, ingredientId: item.ingredientId, stockQty: { gte: qty } },
        data: { stockQty: { decrement: qty } }
      });
      if (taken.count !== 1) {
        const row = await tx.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: input.fromBranchId, ingredientId: item.ingredientId } }, include: { ingredient: { select: { name: true, unit: true } } } });
        const name = row?.ingredient?.name ?? (await tx.ingredient.findUnique({ where: { id: item.ingredientId }, select: { name: true } }))?.name ?? `#${item.ingredientId}`;
        throw new Error(`โอนเกินยอดคงเหลือ: ${name} มี ${roundMoney(row?.stockQty ?? 0)}${row?.ingredient?.unit ? ` ${row.ingredient.unit}` : ""} แต่จะโอน ${qty}`);
      }
      await tx.stockMovement.create({ data: { branchId: input.fromBranchId, ingredientId: item.ingredientId, qty: -qty, reason: `TRANSFER_OUT#${transfer.id}` } });
    }
    return tx.stockTransfer.findUnique({ where: { id: transfer.id }, include: { fromBranch: true, toBranch: true, items: { include: { ingredient: true } } } });
  });
}

/** Sender cancels a transfer that hasn't been received; what left its stock comes back. */
export async function cancelStockTransfer(id: number) {
  return db.$transaction(async (tx: any) => {
    const transfer = await tx.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!transfer) throw new Error("ไม่พบใบโอน");
    if (transfer.status === "RECEIVED") throw new Error("ปลายทางรับของแล้ว ยกเลิกไม่ได้");
    if (transfer.status === "CANCELLED") return transfer;
    const sent = await tx.stockMovement.count({ where: { reason: `TRANSFER_OUT#${id}` } });
    if (sent) {
      for (const item of transfer.items) {
        await tx.ingredientStock.upsert({
          where: { branchId_ingredientId: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId } },
          update: { stockQty: { increment: item.qty } },
          create: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId, stockQty: item.qty, reorderLevel: 0 }
        });
        await tx.stockMovement.create({ data: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId, qty: item.qty, reason: `TRANSFER_CANCEL#${id}` } });
      }
    }
    return tx.stockTransfer.update({ where: { id }, data: { status: "CANCELLED" } });
  });
}

export async function receiveStockTransfer(id: number) {
  return db.$transaction(async (tx: any) => {
    const transfer = await tx.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!transfer) throw new Error("ไม่พบใบโอน");
    if (transfer.status === "RECEIVED") return transfer;
    if (transfer.status === "CANCELLED") throw new Error("ใบโอนนี้ถูกยกเลิกแล้ว");
    // transfers sent before stock left at send time still take it from the sender here
    const alreadySent = (await tx.stockMovement.count({ where: { reason: `TRANSFER_OUT#${id}` } })) > 0;

    for (const item of transfer.items) {
      if (!alreadySent) {
        await tx.ingredientStock.upsert({
          where: { branchId_ingredientId: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId } },
          update: { stockQty: { increment: -item.qty } },
          create: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId, stockQty: -item.qty, reorderLevel: 0 }
        });
        await tx.stockMovement.create({ data: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId, qty: -item.qty, reason: `TRANSFER_OUT#${id}` } });
      }
      await tx.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId: transfer.toBranchId, ingredientId: item.ingredientId } },
        update: { stockQty: { increment: item.qty } },
        create: { branchId: transfer.toBranchId, ingredientId: item.ingredientId, stockQty: item.qty, reorderLevel: 0 }
      });
      await tx.stockMovement.create({ data: { branchId: transfer.toBranchId, ingredientId: item.ingredientId, qty: item.qty, reason: `TRANSFER_IN#${id}` } });
    }

    return tx.stockTransfer.update({
      where: { id },
      data: { status: "RECEIVED", approvedAt: transfer.approvedAt ?? new Date(), receivedAt: new Date() }
    });
  });
}

export async function approvePurchase(id: number, userId?: number | null) {
  const purchase = await db.purchase.findUnique({ where: { id } });
  if (!purchase) throw new Error("ไม่พบใบสั่งซื้อ");
  return db.purchase.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedByUserId: userId ?? null,
      approvedAt: new Date()
    },
    include: { items: true, branch: true, approvedBy: true }
  });
}

export async function listProductUnits(menuItemId?: number, branchType?: string) {
  return db.productUnit.findMany({ where: { ...(menuItemId ? { menuItemId } : {}), ...(branchType ? { menuItem: { branchType } } : {}) }, include: { menuItem: true }, orderBy: { id: "desc" } });
}

export async function saveProductUnit(input: { menuItemId: number; unitName: string; factor: number; price?: number | null; barcode?: string }) {
  if (!input.unitName.trim()) throw new Error("กรุณาระบุชื่อหน่วย เช่น ลัง");
  if (!Number.isFinite(input.factor) || input.factor <= 0) throw new Error("ตัวคูณหน่วยต้องมากกว่า 0");
  if (input.price != null && (!Number.isFinite(input.price) || input.price < 0)) throw new Error("ราคาต้องไม่ติดลบ");
  return db.productUnit.create({
    data: {
      menuItemId: input.menuItemId,
      unitName: input.unitName.trim(),
      factor: roundMoney(input.factor || 1),
      price: input.price == null ? null : roundMoney(input.price),
      barcode: input.barcode?.trim() || null
    }
  });
}

export async function listPriceRules() {
  return db.priceRule.findMany({ include: { menuItem: true }, orderBy: { id: "desc" } });
}

export async function savePriceRule(input: { menuItemId?: number | null; customerTier?: string; minQty?: number; price: number }) {
  if (!Number.isFinite(input.price) || input.price < 0) throw new Error("ราคาต้องไม่ติดลบ");
  if (input.minQty !== undefined && (!Number.isFinite(input.minQty) || input.minQty < 1)) throw new Error("จำนวนขั้นต่ำต้องตั้งแต่ 1");
  return db.priceRule.create({
    data: {
      menuItemId: input.menuItemId ?? null,
      customerTier: input.customerTier?.trim() ?? "",
      minQty: roundMoney(input.minQty || 1),
      price: roundMoney(input.price)
    }
  });
}

export async function listInventoryLots(branchId?: number, expiringDays = 30) {
  const until = new Date(Date.now() + Math.max(1, expiringDays) * 24 * 60 * 60 * 1000);
  return db.inventoryLot.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      qty: { gt: 0 },
      OR: [{ expiryDate: null }, { expiryDate: { lte: until } }]
    },
    include: { ingredient: true, branch: true },
    orderBy: [{ expiryDate: "asc" }, { id: "desc" }]
  });
}

export async function saveInventoryLot(input: { branchId: number; ingredientId: number; lotNo?: string; qty: number; expiryDate?: string }) {
  if (!Number.isFinite(input.qty) || input.qty <= 0) throw new Error("จำนวน lot ต้องมากกว่า 0");
  if (!input.expiryDate || Number.isNaN(new Date(input.expiryDate).getTime())) throw new Error("กรุณาระบุวันหมดอายุ");
  return db.inventoryLot.create({
    data: {
      branchId: input.branchId,
      ingredientId: input.ingredientId,
      lotNo: input.lotNo?.trim() ?? "",
      qty: roundMoney(input.qty),
      expiryDate: toDate(input.expiryDate)
    }
  });
}

export async function listProductVariants(menuItemId?: number) {
  return db.productVariant.findMany({ where: menuItemId ? { menuItemId } : undefined, include: { menuItem: true }, orderBy: { id: "desc" } });
}

export async function saveProductVariant(input: { menuItemId: number; optionName: string; optionValue: string; priceDelta?: number; sku?: string; barcode?: string }) {
  return db.productVariant.create({
    data: {
      menuItemId: input.menuItemId,
      optionName: input.optionName.trim(),
      optionValue: input.optionValue.trim(),
      priceDelta: roundMoney(input.priceDelta || 0),
      sku: input.sku?.trim() || null,
      barcode: input.barcode?.trim() || null
    }
  });
}

export async function listPromotions() {
  return db.promotion.findMany({ orderBy: { id: "desc" } });
}

/** Active, in-window promotions for POS auto-apply preview (cashier-accessible). */
export async function listActivePromotions() {
  const now = new Date();
  return db.promotion.findMany({
    where: {
      active: true,
      OR: [{ startAt: null }, { startAt: { lte: now } }],
      AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }]
    },
    orderBy: { id: "asc" }
  });
}

const PROMOTION_TYPES = new Set(["ORDER_PERCENT", "ORDER_FIXED", "CATEGORY_PERCENT", "BUY_X_GET_Y"]);

/** Percent discounts must be 0–100 and amounts positive; anything else would let a bill reach ฿0. */
function assertDiscountValue(type: string, value: number, what: string) {
  const isPercent = type.toUpperCase().includes("PERCENT");
  if (type.toUpperCase() === "BUY_X_GET_Y") return;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`มูลค่า${what}ต้องมากกว่า 0`);
  if (isPercent && value > 100) throw new Error(`${what}แบบเปอร์เซ็นต์ต้องไม่เกิน 100%`);
}

function assertDateRange(startAt?: string | null, endAt?: string | null) {
  const start = toDate(startAt ?? undefined), end = toDate(endAt ?? undefined);
  if (start && end && end.getTime() < start.getTime()) throw new Error("วันสิ้นสุดต้องอยู่หลังวันเริ่ม");
}

export async function savePromotion(input: { name: string; type: string; value: number; category?: string; startAt?: string; endAt?: string; active?: boolean }) {
  if (!input.name.trim()) throw new Error("กรุณาตั้งชื่อโปรโมชัน");
  if (!PROMOTION_TYPES.has(input.type)) throw new Error("ประเภทโปรโมชันไม่ถูกต้อง");
  if (input.type.startsWith("CATEGORY") && !input.category?.trim()) throw new Error("กรุณาเลือกหมวดสินค้า");
  assertDiscountValue(input.type, input.value, "โปรโมชัน");
  assertDateRange(input.startAt, input.endAt);
  return db.promotion.create({
    data: {
      name: input.name.trim(),
      type: input.type,
      value: roundMoney(input.value),
      category: input.category?.trim() ?? "",
      startAt: toDate(input.startAt),
      endAt: toDate(input.endAt),
      active: input.active !== false
    }
  });
}

export async function listCoupons() {
  return db.coupon.findMany({ orderBy: { id: "desc" } });
}

function assertCouponLimits(maxUses?: number | null, minSpend?: number) {
  if (maxUses !== undefined && maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) throw new Error("จำนวนครั้งที่ใช้ได้ต้องเป็นจำนวนเต็มตั้งแต่ 1");
  if (minSpend !== undefined && (!Number.isFinite(minSpend) || minSpend < 0)) throw new Error("ยอดขั้นต่ำต้องไม่ติดลบ");
}

export async function saveCoupon(input: { code: string; type: string; value: number; maxUses?: number | null; minSpend?: number; expiresAt?: string; active?: boolean }) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new Error("โค้ดคูปองต้องเป็น A-Z, 0-9, - หรือ _ ยาว 3–40 ตัว");
  assertDiscountValue(input.type, input.value, "คูปอง");
  assertCouponLimits(input.maxUses, input.minSpend);
  if (await db.coupon.findUnique({ where: { code } })) throw new Error(`มีคูปอง ${code} อยู่แล้ว`);
  return db.coupon.create({
    data: {
      code,
      type: input.type,
      value: roundMoney(input.value),
      maxUses: input.maxUses ?? null,
      minSpend: roundMoney(input.minSpend ?? 0),
      expiresAt: toDate(input.expiresAt),
      active: input.active !== false
    }
  });
}

/** Validate a coupon for POS use (cashier-accessible). Throws on invalid/expired/used-up. */
export async function validateCoupon(code: string) {
  const coupon = await db.coupon.findUnique({ where: { code: String(code).trim().toUpperCase() } });
  if (!coupon || coupon.active === false) throw new Error("คูปองไม่ถูกต้องหรือถูกปิดใช้งาน");
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) throw new Error("คูปองหมดอายุแล้ว");
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) throw new Error("คูปองถูกใช้ครบจำนวนแล้ว");
  if (!(Number(coupon.value) > 0)) throw new Error("คูปองนี้ตั้งมูลค่าไม่ถูกต้อง ใช้ไม่ได้");
  return { code: coupon.code, type: coupon.type, value: Number(coupon.value) || 0, minSpend: Number(coupon.minSpend) || 0, expiresAt: coupon.expiresAt };
}

export async function updatePromotion(id: number, input: { name?: string; type?: string; value?: number; category?: string; startAt?: string | null; endAt?: string | null; active?: boolean }) {
  const current = await db.promotion.findUnique({ where: { id } });
  if (!current) throw new Error("ไม่พบโปรโมชัน");
  const type = input.type ?? current.type;
  if (!PROMOTION_TYPES.has(type)) throw new Error("ประเภทโปรโมชันไม่ถูกต้อง");
  assertDiscountValue(type, input.value ?? current.value, "โปรโมชัน");
  assertDateRange(input.startAt !== undefined ? input.startAt : current.startAt?.toISOString(), input.endAt !== undefined ? input.endAt : current.endAt?.toISOString());
  const data: any = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.type !== undefined) data.type = input.type;
  if (input.value !== undefined) data.value = roundMoney(input.value);
  if (input.category !== undefined) data.category = input.category.trim();
  if (input.startAt !== undefined) data.startAt = toDate(input.startAt);
  if (input.endAt !== undefined) data.endAt = toDate(input.endAt);
  if (input.active !== undefined) data.active = input.active;
  return db.promotion.update({ where: { id }, data });
}

export async function deletePromotion(id: number) {
  return db.promotion.delete({ where: { id } });
}

export async function updateCoupon(id: number, input: { type?: string; value?: number; maxUses?: number | null; minSpend?: number; expiresAt?: string | null; active?: boolean }) {
  const current = await db.coupon.findUnique({ where: { id } });
  if (!current) throw new Error("ไม่พบคูปอง");
  assertDiscountValue(input.type ?? current.type, input.value ?? current.value, "คูปอง");
  assertCouponLimits(input.maxUses, input.minSpend);
  const data: any = {};
  if (input.minSpend !== undefined) data.minSpend = roundMoney(input.minSpend);
  if (input.type !== undefined) data.type = input.type;
  if (input.value !== undefined) data.value = roundMoney(input.value);
  if (input.maxUses !== undefined) data.maxUses = input.maxUses;
  if (input.expiresAt !== undefined) data.expiresAt = toDate(input.expiresAt);
  if (input.active !== undefined) data.active = input.active;
  return db.coupon.update({ where: { id }, data });
}

export async function deleteCoupon(id: number) {
  return db.coupon.delete({ where: { id } });
}

export async function listBusinessDocuments(branchId?: number) {
  const rows = await db.businessDocument.findMany({ where: branchId ? { branchId } : undefined, include: { branch: true }, orderBy: { id: "desc" }, take: 200 });
  return rows.map(hydrateDocument);
}

/** Each document type has its own running number series. */
const DOCUMENT_PREFIX: Record<string, string> = { DELIVERY_NOTE: "DN", INVOICE: "INV", QUOTATION: "QT", CREDIT_NOTE: "CN" };
export const DOCUMENT_STATUSES = ["DRAFT", "ISSUED", "PAID", "ACCEPTED", "VOID"] as const;
// what each status may move to; VOID and converted (ACCEPTED) quotations are final
const DOCUMENT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ISSUED", "VOID"],
  ISSUED: ["PAID", "VOID"],
  PAID: ["VOID"],
  ACCEPTED: [],
  VOID: []
};

function hydrateDocument(row: any) {
  return row && { ...row, payload: parseJson(row.payload, {}), createdAt: row.createdAt.toISOString() };
}

function assertDocumentFields(input: { customerName?: string; total?: number }) {
  if (input.customerName !== undefined && !input.customerName.trim()) throw new Error("กรุณาระบุชื่อลูกค้า");
  if (input.total !== undefined && (!Number.isFinite(input.total) || input.total <= 0)) throw new Error("ยอดเอกสารต้องมากกว่า 0");
}

export async function createBusinessDocument(input: { branchId: number; type: string; customerName?: string; total?: number; payload?: unknown }) {
  const prefix = DOCUMENT_PREFIX[input.type];
  if (!prefix) throw new Error("ประเภทเอกสารไม่ถูกต้อง");
  assertDocumentFields({ customerName: input.customerName ?? "", total: Number(input.total) });
  const doc = await withRunningNo(
    () => nextRunningNo(prefix, input.branchId, "businessDocument", "documentNo"),
    (documentNo) => db.businessDocument.create({
      data: {
        branchId: input.branchId,
        type: input.type,
        documentNo,
        customerName: String(input.customerName).trim().slice(0, 200),
        total: roundMoney(Number(input.total)),
        payload: JSON.stringify(input.payload ?? {})
      }
    })
  );
  return hydrateDocument(doc);
}

/** Edit a draft (customer, total, note). Issued documents are changed by voiding and re-creating. */
export async function updateBusinessDocument(id: number, input: { customerName?: string; total?: number; note?: string }) {
  const doc = await db.businessDocument.findUnique({ where: { id } });
  if (!doc) throw new Error("ไม่พบเอกสาร");
  if (doc.status !== "DRAFT") throw new Error("แก้ไขได้เฉพาะเอกสารร่าง เอกสารที่ออกแล้วให้ยกเลิกแล้วสร้างใหม่");
  assertDocumentFields(input);
  const payload = { ...parseJson(doc.payload, {}), ...(input.note !== undefined ? { note: input.note.trim().slice(0, 500) } : {}) };
  return hydrateDocument(await db.businessDocument.update({
    where: { id },
    data: {
      ...(input.customerName !== undefined ? { customerName: input.customerName.trim().slice(0, 200) } : {}),
      ...(input.total !== undefined ? { total: roundMoney(input.total) } : {}),
      payload: JSON.stringify(payload)
    }
  }));
}

export async function setBusinessDocumentStatus(id: number, status: string, reason = "") {
  const doc = await db.businessDocument.findUnique({ where: { id } });
  if (!doc) throw new Error("ไม่พบเอกสาร");
  if (!(DOCUMENT_TRANSITIONS[doc.status] ?? []).includes(status)) throw new Error(`เปลี่ยนสถานะจาก ${doc.status} เป็น ${status} ไม่ได้`);
  if (status === "PAID" && doc.type !== "INVOICE") throw new Error("ทำเครื่องหมายชำระแล้วได้เฉพาะใบแจ้งหนี้");
  if (status === "VOID" && !reason.trim()) throw new Error("กรุณาระบุเหตุผลที่ยกเลิก");
  const payload = { ...parseJson(doc.payload, {}), ...(status === "VOID" ? { voidReason: reason.trim().slice(0, 300) } : {}) };
  return hydrateDocument(await db.businessDocument.update({ where: { id }, data: { status, payload: JSON.stringify(payload) } }));
}

/** Quotation accepted -> a new invoice draft with the same customer and total; the quotation becomes ACCEPTED. */
export async function convertQuotationToInvoice(id: number) {
  const doc = await db.businessDocument.findUnique({ where: { id } });
  if (!doc) throw new Error("ไม่พบเอกสาร");
  if (doc.type !== "QUOTATION") throw new Error("แปลงเป็นใบแจ้งหนี้ได้เฉพาะใบเสนอราคา");
  if (doc.status === "VOID" || doc.status === "ACCEPTED") throw new Error("ใบเสนอราคานี้ถูกยกเลิกหรือแปลงไปแล้ว");
  const invoice = await createBusinessDocument({ branchId: doc.branchId, type: "INVOICE", customerName: doc.customerName, total: doc.total, payload: { ...parseJson(doc.payload, {}), fromQuotation: doc.documentNo } });
  await db.businessDocument.update({ where: { id }, data: { status: "ACCEPTED", payload: JSON.stringify({ ...parseJson(doc.payload, {}), convertedTo: invoice.documentNo }) } });
  return invoice;
}

export async function getTaxExportRows(input: { from?: string; to?: string; branchId?: number }) {
  const where: any = {};
  if (input.branchId) where.branchId = input.branchId;
  if (input.from || input.to) {
    where.createdAt = {};
    // dates are Thai calendar days
    if (input.from) where.createdAt.gte = new Date(`${input.from}T00:00:00+07:00`);
    if (input.to) where.createdAt.lte = new Date(`${input.to}T23:59:59.999+07:00`);
  }
  const rows = await db.taxInvoice.findMany({ where, include: { branch: true }, orderBy: { createdAt: "asc" } });
  return rows.map((row: any) => {
    const isVoid = row.status === "VOID";
    return {
      invoiceNo: row.invoiceNo,
      createdAt: row.createdAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }),
      orderId: row.orderId,
      branch: row.branch?.name ?? "",
      buyerName: row.buyerName,
      buyerTaxId: row.buyerTaxId,
      vatRate: row.vatRate,
      // a voided invoice stays in the list (its number was used) but carries no amounts
      base: isVoid ? 0 : roundMoney(row.total - row.tax),
      tax: isVoid ? 0 : row.tax,
      total: isVoid ? 0 : row.total,
      status: isVoid ? `ยกเลิก: ${row.voidReason}` : "ใช้งาน",
      eTaxStatus: row.eTaxStatus
    };
  });
}

export async function compareSales(input: {
  branchIdA?: number;
  branchIdB?: number;
  fromA: string;
  toA: string;
  fromB: string;
  toB: string;
}) {
  const makeWhere = (from: string, to: string, branchId?: number) => ({
    status: { notIn: ["CANCELLED", "REFUNDED"] },
    ...(branchId ? { branchId } : {}),
    createdAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59`) }
  });
  const [aCount, aSum, bCount, bSum] = await Promise.all([
    db.order.count({ where: makeWhere(input.fromA, input.toA, input.branchIdA) }),
    db.order.aggregate({ where: makeWhere(input.fromA, input.toA, input.branchIdA), _sum: { total: true } }),
    db.order.count({ where: makeWhere(input.fromB, input.toB, input.branchIdB) }),
    db.order.aggregate({ where: makeWhere(input.fromB, input.toB, input.branchIdB), _sum: { total: true } })
  ]);
  const revenueA = roundMoney(aSum._sum.total ?? 0);
  const revenueB = roundMoney(bSum._sum.total ?? 0);
  return {
    a: { orders: aCount, revenue: revenueA, averageTicket: aCount ? roundMoney(revenueA / aCount) : 0 },
    b: { orders: bCount, revenue: revenueB, averageTicket: bCount ? roundMoney(revenueB / bCount) : 0 },
    diff: { orders: aCount - bCount, revenue: roundMoney(revenueA - revenueB) }
  };
}

export async function getDailyEmailSetting(branchId?: number) {
  return db.dailyEmailSetting.findFirst({ where: { branchId: branchId ?? null }, orderBy: { id: "desc" } });
}

export async function saveDailyEmailSetting(input: { branchId?: number | null; recipients: string; sendTime?: string; enabled?: boolean }) {
  const existing = await getDailyEmailSetting(input.branchId ?? undefined);
  const data = {
    branchId: input.branchId ?? null,
    recipients: input.recipients.trim(),
    sendTime: input.sendTime?.trim() || "21:00",
    enabled: input.enabled === true
  };
  return existing
    ? db.dailyEmailSetting.update({ where: { id: existing.id }, data })
    : db.dailyEmailSetting.create({ data });
}

export async function enqueueDailySummaryEmail(input: { date: string; branchId?: number }) {
  const setting = await getDailyEmailSetting(input.branchId);
  if (!setting?.enabled || !setting.recipients.trim()) throw new Error("ยังไม่ได้เปิดอีเมลสรุปรายวัน");
  return db.integrationOutbox.create({
    data: {
      provider: "email",
      eventType: "DAILY_SALES_EMAIL_READY",
      entityType: "daily_summary",
      entityId: input.branchId ?? null,
      payload: JSON.stringify({ date: input.date, branchId: input.branchId ?? null, recipients: setting.recipients })
    }
  });
}

export async function getCustomerDisplay(branchId: number) {
  const order = await db.order.findFirst({
    where: { branchId, status: { in: ["PAID", "READY"] } },
    include: { items: true },
    orderBy: { id: "desc" }
  });
  if (!order) return null;
  return {
    orderId: order.id,
    total: order.total,
    status: order.status,
    items: order.items.map((item: any) => ({ name: item.name, qty: item.qty, lineTotal: item.lineTotal })),
    createdAt: order.createdAt.toISOString()
  };
}

export async function listMarketplaceConnections(branchId?: number) {
  const rows = await db.marketplaceConnection.findMany({ where: branchId ? { branchId } : undefined, include: { branch: true }, orderBy: { id: "desc" } });
  return rows.map((row: any) => ({ ...row, config: parseJson(row.config, {}) }));
}

export async function saveMarketplaceConnection(input: { branchId: number; provider: string; shopName?: string; config?: unknown }) {
  return db.marketplaceConnection.upsert({
    where: { branchId_provider: { branchId: input.branchId, provider: input.provider } },
    create: { branchId: input.branchId, provider: input.provider, shopName: input.shopName?.trim() ?? "", config: JSON.stringify(input.config ?? {}) },
    update: { shopName: input.shopName?.trim() ?? "", config: JSON.stringify(input.config ?? {}), status: "READY" }
  });
}

export async function enqueueMarketplaceSync(id: number) {
  const connection = await db.marketplaceConnection.findUnique({ where: { id } });
  if (!connection) throw new Error("ไม่พบ marketplace connection");
  return db.integrationOutbox.create({
    data: {
      provider: "lineman",
      eventType: "MARKETPLACE_SYNC_READY",
      entityType: "marketplace_connection",
      entityId: id,
      payload: JSON.stringify({ provider: connection.provider, branchId: connection.branchId, shopName: connection.shopName, config: parseJson(connection.config, {}) })
    }
  });
}
