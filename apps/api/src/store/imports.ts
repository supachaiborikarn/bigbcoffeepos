import prisma from "../prisma.js";
import { classifyMenuItem } from "../utils/menu-data-cleaning.js";

type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type ProductImportInput = {
  sku?: string;
  barcode?: string;
  name?: string;
  category?: string;
  basePrice?: number;
  cost?: number;
  stockQty?: number;
  reorderLevel?: number;
  unit?: string;
  imageUrl?: string;
  taxRate?: number;
  source?: string;
  sourceId?: string;
  optionGroup?: string;
  optionLabel?: string;
  metadata?: Record<string, unknown> | string;
};

type CustomerImportInput = {
  name?: string;
  phone?: string;
  points?: number;
};

type HistoricalOrderImportInput = {
  receiptNo?: string;
  createdAt?: string;
  customerName?: string;
  customerPhone?: string;
  productName?: string;
  qty?: number;
  unitPrice?: number;
  total?: number;
  discountAmount?: number;
  paymentMethod?: string;
};

const PAYMENT_METHODS = new Set(["CASH", "QR", "CARD", "EWALLET"]);

function makeResult(): ImportResult {
  return { imported: 0, updated: 0, skipped: 0, errors: [] };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function stringifyMetadata(value: ProductImportInput["metadata"]) {
  if (!value) return "{}";
  if (typeof value === "string") return value.trim() || "{}";
  return JSON.stringify(value);
}

export async function importProducts(input: { branchId: number; items: ProductImportInput[] }) {
  const result = makeResult();
  const branch = await prisma.branch.findUnique({ where: { id: input.branchId } });
  if (!branch) throw new Error("ไม่พบสาขาที่จะนำเข้า");

  for (const [index, raw] of input.items.entries()) {
    const line = index + 1;
    const name = cleanString(raw.name);
    const sku = cleanString(raw.sku) || null;
    const barcode = cleanString(raw.barcode) || null;
    const rawCategory = cleanString(raw.category) || "Uncategory";
    const basePrice = positiveNumber(raw.basePrice, -1);
    const cost = raw.cost === undefined || raw.cost === null ? null : positiveNumber(raw.cost, 0);
    const taxRate = raw.taxRate === undefined || raw.taxRate === null ? null : positiveNumber(raw.taxRate, 0);

    if (!name || basePrice < 0) {
      result.skipped++;
      result.errors.push(`สินค้าแถว ${line}: ต้องมีชื่อและราคาขาย`);
      continue;
    }

    const lookup = [
      sku ? { sku } : null,
      barcode ? { barcode } : null,
      { name, branchType: branch.branchType }
    ].filter(Boolean) as Array<{ sku?: string; barcode?: string; name?: string; branchType?: string }>;

    const existing = await prisma.menuItem.findFirst({ where: { OR: lookup } });
    const classification = classifyMenuItem({
      name,
      category: rawCategory,
      branchType: branch.branchType,
      basePrice,
      active: true,
      optionGroup: cleanString(raw.optionGroup) || null,
      optionLabel: cleanString(raw.optionLabel) || null,
      metadata: stringifyMetadata(raw.metadata)
    });
    const data = {
      sku,
      barcode,
      name,
      category: classification.category,
      basePrice: roundMoney(basePrice),
      cost,
      imageUrl: cleanString(raw.imageUrl) || null,
      unit: cleanString(raw.unit) || null,
      taxRate,
      source: cleanString(raw.source) || null,
      sourceId: cleanString(raw.sourceId) || null,
      optionGroup: cleanString(raw.optionGroup) || classification.optionGroup,
      optionLabel: cleanString(raw.optionLabel) || classification.optionLabel,
      metadata: stringifyMetadata(raw.metadata),
      branchType: branch.branchType,
      active: classification.active
    };

    const menuItem = existing
      ? await prisma.menuItem.update({ where: { id: existing.id }, data })
      : await prisma.menuItem.create({ data });

    if (existing) result.updated++;
    else result.imported++;

    if (raw.stockQty !== undefined || raw.reorderLevel !== undefined) {
      const unit = cleanString(raw.unit) || "ชิ้น";
      const ingredient = await prisma.ingredient.findFirst({ where: { name } })
        ?? await prisma.ingredient.create({ data: { name, unit, costPerUnit: cost ?? 0 } });

      await prisma.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId: input.branchId, ingredientId: ingredient.id } },
        create: {
          branchId: input.branchId,
          ingredientId: ingredient.id,
          stockQty: positiveNumber(raw.stockQty, 0),
          reorderLevel: positiveNumber(raw.reorderLevel, 0)
        },
        update: {
          ...(raw.stockQty !== undefined ? { stockQty: positiveNumber(raw.stockQty, 0) } : {}),
          ...(raw.reorderLevel !== undefined ? { reorderLevel: positiveNumber(raw.reorderLevel, 0) } : {})
        }
      });
    }

    if (!menuItem.active) result.errors.push(`สินค้าแถว ${line}: นำเข้าแล้วแต่สถานะไม่ active`);
  }

  return result;
}

export async function importCustomers(input: { items: CustomerImportInput[] }) {
  const result = makeResult();

  for (const [index, raw] of input.items.entries()) {
    const line = index + 1;
    const name = cleanString(raw.name);
    const phone = cleanString(raw.phone);
    const points = Math.max(0, Math.floor(Number(raw.points) || 0));

    if (!name || !phone) {
      result.skipped++;
      result.errors.push(`ลูกค้าแถว ${line}: ต้องมีชื่อและเบอร์โทร`);
      continue;
    }

    const existing = await prisma.customer.findUnique({ where: { phone } });
    if (existing) {
      await prisma.customer.update({ where: { id: existing.id }, data: { name, points } });
      result.updated++;
    } else {
      await prisma.customer.create({ data: { name, phone, points } });
      result.imported++;
    }
  }

  return result;
}

export async function importHistoricalOrders(input: { branchId: number; items: HistoricalOrderImportInput[] }) {
  const result = makeResult();
  const branch = await prisma.branch.findUnique({ where: { id: input.branchId } });
  if (!branch) throw new Error("ไม่พบสาขาที่จะนำเข้า");

  for (const [index, raw] of input.items.entries()) {
    const line = index + 1;
    const productName = cleanString(raw.productName);
    if (!productName) {
      result.skipped++;
      result.errors.push(`ออเดอร์แถว ${line}: ไม่มีรายการสินค้า จึงไม่นำเข้าเป็นยอดขายลอย`);
      continue;
    }

    const qty = Math.max(1, positiveNumber(raw.qty, 1));
    const totalInput = positiveNumber(raw.total, 0);
    const unitPrice = positiveNumber(raw.unitPrice, totalInput > 0 ? totalInput / qty : 0);
    if (unitPrice <= 0 && totalInput <= 0) {
      result.skipped++;
      result.errors.push(`ออเดอร์แถว ${line}: ต้องมีราคาหรือยอดรวม`);
      continue;
    }

    const lineTotal = roundMoney(totalInput > 0 ? totalInput : unitPrice * qty);
    const discountAmount = positiveNumber(raw.discountAmount, 0);
    const subtotal = roundMoney(lineTotal + discountAmount);
    const paymentMethod = PAYMENT_METHODS.has(cleanString(raw.paymentMethod)) ? cleanString(raw.paymentMethod) : "CASH";
    const createdAt = raw.createdAt && !Number.isNaN(new Date(raw.createdAt).getTime())
      ? new Date(raw.createdAt)
      : new Date();
    const customerPhone = cleanString(raw.customerPhone);
    const customerName = cleanString(raw.customerName) || customerPhone;
    const customer = customerPhone
      ? await prisma.customer.upsert({
          where: { phone: customerPhone },
          update: { name: customerName || customerPhone },
          create: { name: customerName || customerPhone, phone: customerPhone }
        })
      : null;

    const menuItem = await prisma.menuItem.findFirst({
      where: { name: productName, branchType: branch.branchType }
    }) ?? await prisma.menuItem.create({
      data: {
        name: productName,
        category: "Imported POSPOS",
        basePrice: roundMoney(unitPrice || lineTotal / qty),
        branchType: branch.branchType,
        active: true
      }
    });

    await prisma.order.create({
      data: {
        branchId: input.branchId,
        customerId: customer?.id ?? null,
        userId: null,
        shiftId: null,
        status: "READY",
        subtotal,
        discountType: discountAmount > 0 ? "FIXED" : null,
        discountValue: discountAmount,
        discountAmount,
        loyaltyPointsUsed: 0,
        loyaltyPointsEarned: 0,
        tax: 0,
        total: lineTotal,
        paymentMethod,
        createdAt,
        items: {
          create: [{
            menuItemId: menuItem.id,
            name: productName,
            qty,
            basePrice: roundMoney(unitPrice || lineTotal / qty),
            modifiers: "[]",
            lineTotal,
            note: raw.receiptNo ? `นำเข้าจาก POSPOS: ${raw.receiptNo}` : "นำเข้าจาก POSPOS"
          }]
        }
      }
    });
    result.imported++;
  }

  return result;
}
