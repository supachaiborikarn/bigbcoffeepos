import prisma from "../prisma.js";

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

async function nextRunningNo(prefix: string, branchId: number, table: string, field: string) {
  const year = new Date().getFullYear();
  const count = await db[table].count({ where: { branchId } });
  return `${prefix}-${branchId}-${year}-${String(count + 1).padStart(6, "0")}`;
}

export async function listTaxInvoices(branchId?: number) {
  const rows = await db.taxInvoice.findMany({
    where: branchId ? { branchId } : undefined,
    include: { order: true, customer: true, branch: true },
    orderBy: { id: "desc" }
  });
  return rows.map((row: any) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

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
  if (!input.buyerName.trim()) throw new Error("กรุณาระบุชื่อผู้ซื้อ");

  const invoiceNo = await nextRunningNo("TAX", order.branchId, "taxInvoice", "invoiceNo");
  const invoice = await db.taxInvoice.create({
    data: {
      branchId: order.branchId,
      orderId: order.id,
      customerId: order.customerId ?? null,
      invoiceNo,
      buyerName: input.buyerName.trim().slice(0, 200),
      buyerTaxId: String(input.buyerTaxId ?? "").replace(/[^0-9]/g, "").slice(0, 13),
      buyerAddress: String(input.buyerAddress ?? "").trim().slice(0, 600),
      buyerBranch: String(input.buyerBranch ?? "").trim().slice(0, 100),
      subtotal: roundMoney(order.subtotal),
      discountAmount: roundMoney(order.discountAmount),
      tax: roundMoney(order.tax),
      total: roundMoney(order.total)
    }
  });

  await db.integrationOutbox.create({
    data: {
      provider: "rd_tax",
      eventType: "TAX_INVOICE_ISSUED",
      entityType: "tax_invoice",
      entityId: invoice.id,
      payload: JSON.stringify({
        invoiceNo,
        orderId: order.id,
        branchId: order.branchId,
        buyerName: invoice.buyerName,
        buyerTaxId: invoice.buyerTaxId,
        buyerAddress: invoice.buyerAddress,
        buyerBranch: invoice.buyerBranch,
        subtotal: invoice.subtotal,
        discountAmount: invoice.discountAmount,
        tax: invoice.tax,
        total: invoice.total
      })
    }
  });

  return invoice;
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

export async function postStockCount(id: number) {
  return db.$transaction(async (tx: any) => {
    const stockCount = await tx.stockCount.findUnique({ where: { id }, include: { items: true } });
    if (!stockCount) throw new Error("ไม่พบรอบนับสต็อก");
    if (stockCount.status === "POSTED") return stockCount;

    for (const item of stockCount.items) {
      if (item.differenceQty === 0) continue;
      await tx.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId: stockCount.branchId, ingredientId: item.ingredientId } },
        update: { stockQty: item.countedQty },
        create: { branchId: stockCount.branchId, ingredientId: item.ingredientId, stockQty: item.countedQty, reorderLevel: 0 }
      });
      await tx.stockMovement.create({
        data: { branchId: stockCount.branchId, ingredientId: item.ingredientId, qty: item.differenceQty, reason: `STOCKTAKE#${id}` }
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
  return db.stockTransfer.create({
    data: {
      fromBranchId: input.fromBranchId,
      toBranchId: input.toBranchId,
      note: input.note?.trim() ?? "",
      items: {
        create: input.items.map((item) => ({ ingredientId: item.ingredientId, qty: roundMoney(item.qty) }))
      }
    },
    include: { fromBranch: true, toBranch: true, items: { include: { ingredient: true } } }
  });
}

export async function receiveStockTransfer(id: number) {
  return db.$transaction(async (tx: any) => {
    const transfer = await tx.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!transfer) throw new Error("ไม่พบใบโอน");
    if (transfer.status === "RECEIVED") return transfer;

    for (const item of transfer.items) {
      await tx.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId } },
        update: { stockQty: { increment: -item.qty } },
        create: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId, stockQty: -item.qty, reorderLevel: 0 }
      });
      await tx.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId: transfer.toBranchId, ingredientId: item.ingredientId } },
        update: { stockQty: { increment: item.qty } },
        create: { branchId: transfer.toBranchId, ingredientId: item.ingredientId, stockQty: item.qty, reorderLevel: 0 }
      });
      await tx.stockMovement.create({ data: { branchId: transfer.fromBranchId, ingredientId: item.ingredientId, qty: -item.qty, reason: `TRANSFER_OUT#${id}` } });
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

export async function listProductUnits(menuItemId?: number) {
  return db.productUnit.findMany({ where: menuItemId ? { menuItemId } : undefined, include: { menuItem: true }, orderBy: { id: "desc" } });
}

export async function saveProductUnit(input: { menuItemId: number; unitName: string; factor: number; price?: number | null; barcode?: string }) {
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
      OR: [{ expiryDate: null }, { expiryDate: { lte: until } }]
    },
    include: { ingredient: true, branch: true },
    orderBy: [{ expiryDate: "asc" }, { id: "desc" }]
  });
}

export async function saveInventoryLot(input: { branchId: number; ingredientId: number; lotNo?: string; qty: number; expiryDate?: string }) {
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

export async function savePromotion(input: { name: string; type: string; value: number; category?: string; startAt?: string; endAt?: string; active?: boolean }) {
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

export async function saveCoupon(input: { code: string; type: string; value: number; maxUses?: number | null; expiresAt?: string; active?: boolean }) {
  return db.coupon.create({
    data: {
      code: input.code.trim().toUpperCase(),
      type: input.type,
      value: roundMoney(input.value),
      maxUses: input.maxUses ?? null,
      expiresAt: toDate(input.expiresAt),
      active: input.active !== false
    }
  });
}

export async function listBusinessDocuments(branchId?: number) {
  return db.businessDocument.findMany({ where: branchId ? { branchId } : undefined, include: { branch: true }, orderBy: { id: "desc" } });
}

export async function createBusinessDocument(input: { branchId: number; type: string; customerName?: string; total?: number; payload?: unknown }) {
  const documentNo = await nextRunningNo(input.type.toUpperCase().slice(0, 4), input.branchId, "businessDocument", "documentNo");
  return db.businessDocument.create({
    data: {
      branchId: input.branchId,
      type: input.type,
      documentNo,
      customerName: input.customerName?.trim() ?? "",
      total: roundMoney(input.total || 0),
      payload: JSON.stringify(input.payload ?? {})
    }
  });
}

export async function getTaxExportRows(input: { from?: string; to?: string; branchId?: number }) {
  const where: any = {};
  if (input.branchId) where.branchId = input.branchId;
  if (input.from || input.to) {
    where.createdAt = {};
    if (input.from) where.createdAt.gte = new Date(input.from);
    if (input.to) where.createdAt.lte = new Date(`${input.to}T23:59:59`);
  }
  const rows = await db.taxInvoice.findMany({ where, include: { branch: true }, orderBy: { createdAt: "asc" } });
  return rows.map((row: any) => ({
    invoiceNo: row.invoiceNo,
    createdAt: row.createdAt.toISOString(),
    branch: row.branch?.name ?? "",
    buyerName: row.buyerName,
    buyerTaxId: row.buyerTaxId,
    subtotal: row.subtotal,
    discountAmount: row.discountAmount,
    tax: row.tax,
    total: row.total,
    eTaxStatus: row.eTaxStatus
  }));
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
