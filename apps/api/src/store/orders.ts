import prisma from "../prisma.js";
import { getCustomer } from "./customers.js";
import { getCupStockRequirements, getCupStockRequirementsByOption } from "./cupStockSettings.js";
import { log } from "../logger.js";

type Modifier = { name: string; value: string; price: number };
type PaymentDetails = { cashReceived?: number; changeAmount?: number; paymentConfirmed?: boolean; referenceNo?: string };
type DiscountType = "PERCENT" | "FIXED" | null;
type PaymentMethod = "CASH" | "QR" | "CARD" | "EWALLET";
type DiscountRuleType = "ORDER_PERCENT" | "ORDER_FIXED" | "CATEGORY_PERCENT" | "BUY_X_GET_Y";
type DiscountRule = {
  id?: string;
  label?: string;
  type: DiscountRuleType;
  value?: number;
  category?: string;
  buyQty?: number;
  getQty?: number;
  maxDiscount?: number;
};

type OrderItemDraft = {
  menuItemId: number;
  name: string;
  category: string;
  qty: number;
  basePrice: number;
  modifiers: Modifier[];
  lineTotal: number;
  note?: string;
};

const PAYMENT_METHODS = new Set<PaymentMethod>(["CASH", "QR", "CARD", "EWALLET"]);
const ALLOWED_STATUSES = new Set(["PAID", "READY", "CANCELLED", "REFUNDED"]);
const REVERSAL_STATUSES = new Set(["CANCELLED", "REFUNDED"]);
const DRINK_CATEGORIES = ["กาแฟ", "ชา", "นม/โกโก้", "เครื่องดื่ม", "เครื่องดื่มชง", "COLD", "FRAPPE", "Hot"];
const checkoutTransactionRetries = Math.max(0, Math.floor(Number(process.env.CHECKOUT_TX_RETRIES || 5)));
const MODIFIER_CATALOG = {
  Type: new Map([
    ["Hot", { label: "Hot", price: 0 }],
    ["Iced", { label: "Iced", price: 0 }],
    ["Frappe", { label: "Frappe", price: 0 }]
  ]),
  Cup: new Map([
    ["แก้วเย็น", { label: "แก้วเย็น", price: 0 }],
    ["แก้วทานร้าน", { label: "แก้วทานร้าน", price: 0 }],
    ["แก้วเดินทาง", { label: "แก้วเดินทาง", price: 0 }],
    ["แก้วมาเอง", { label: "แก้วมาเอง", price: 0 }]
  ]),
  Sweetness: new Map([
    ["0%", { label: "0%", price: 0 }],
    ["25%", { label: "25%", price: 0 }],
    ["50%", { label: "50%", price: 0 }],
    ["100%", { label: "100%", price: 0 }],
    ["120%", { label: "120%", price: 0 }]
  ]),
  "Add-on": new Map([
    ["เพิ่มช็อตกาแฟ", { label: "เพิ่มช็อตกาแฟ", price: 15 }],
    ["เปลี่ยนเป็นนมโอ๊ต", { label: "เปลี่ยนเป็นนมโอ๊ต", price: 20 }],
    ["เปลี่ยนเป็นนมอัลมอนด์", { label: "เปลี่ยนเป็นนมอัลมอนด์", price: 20 }],
    ["เพิ่มไซรัปวานิลลา", { label: "เพิ่มไซรัปวานิลลา", price: 15 }],
    ["เพิ่มไซรัปคาราเมล", { label: "เพิ่มไซรัปคาราเมล", price: 15 }],
    ["วิปครีม", { label: "วิปครีม", price: 15 }]
  ])
} as const;
const IDEMPOTENCY_EVENT_PREFIX = "CHECKOUT_IDEMPOTENCY:";

function roundMoney(v: number) {
  return Math.round(v * 100) / 100;
}

function parsePaymentMethods(raw: unknown): PaymentMethod[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    if (Array.isArray(parsed)) {
      const methods = parsed.filter((item): item is PaymentMethod => PAYMENT_METHODS.has(item as PaymentMethod));
      if (methods.length) return methods;
    }
  } catch {
    // Keep checkout available if old settings are malformed.
  }
  return ["CASH", "QR", "CARD"];
}

function computeVatTotal(amountBeforeTax: number, vatMode: string | undefined, vatRate: number | undefined) {
  const rate = Number.isFinite(vatRate) && Number(vatRate) > 0 ? Number(vatRate) : 0;
  if (!rate || vatMode === "NONE") {
    return { tax: 0, total: roundMoney(amountBeforeTax) };
  }
  if (vatMode === "EXCLUSIVE") {
    const tax = roundMoney(amountBeforeTax * rate / 100);
    return { tax, total: roundMoney(amountBeforeTax + tax) };
  }
  const tax = roundMoney(amountBeforeTax * rate / (100 + rate));
  return { tax, total: roundMoney(amountBeforeTax) };
}

function hydrateOrder(row: any) {
  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((i: any) => ({
      ...i,
      modifiers: typeof i.modifiers === "string" ? JSON.parse(i.modifiers) : i.modifiers
    }))
  };
}

function normalizeModifiers(value: Modifier[], category: string) {
  if (!Array.isArray(value)) return [];
  if (!DRINK_CATEGORIES.includes(category) && value.length) throw new Error("สินค้านี้ไม่มีตัวเลือกเพิ่มเติม");
  return value.map((modifier) => {
    const name = String(modifier?.name ?? "").trim();
    const modValue = String(modifier?.value ?? "").trim();
    const catalog = MODIFIER_CATALOG[name as keyof typeof MODIFIER_CATALOG];
    const catalogItem = catalog?.get(modValue);
    if (!catalogItem) {
      throw new Error("ตัวเลือกสินค้าไม่ถูกต้อง");
    }
    return { name, value: catalogItem.label, price: catalogItem.price };
  });
}

function normalizeRule(rule: DiscountRule): DiscountRule | null {
  if (!rule?.type) return null;
  const value = Number(rule.value ?? 0);
  const maxDiscount = rule.maxDiscount === undefined ? undefined : Math.max(0, Number(rule.maxDiscount));

  if (rule.type === "ORDER_PERCENT") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return { ...rule, value: Math.min(value, 100), maxDiscount, label: rule.label || `ลดทั้งบิล ${value}%` };
  }

  if (rule.type === "ORDER_FIXED") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return { ...rule, value, maxDiscount, label: rule.label || `ลดทั้งบิล ${value} บาท` };
  }

  if (rule.type === "CATEGORY_PERCENT") {
    if (!rule.category || !Number.isFinite(value) || value <= 0) return null;
    return { ...rule, value: Math.min(value, 100), maxDiscount, label: rule.label || `ลดหมวด ${rule.category} ${value}%` };
  }

  if (rule.type === "BUY_X_GET_Y") {
    const buyQty = Math.max(1, Math.floor(Number(rule.buyQty ?? 2)));
    const getQty = Math.max(1, Math.floor(Number(rule.getQty ?? 1)));
    if (!rule.category) return null;
    return { ...rule, buyQty, getQty, value: 0, maxDiscount, label: rule.label || `${rule.category} ซื้อ ${buyQty} แถม ${getQty}` };
  }

  return null;
}

function legacyDiscountRule(discountType: DiscountType, discountValue: number): DiscountRule | null {
  if (discountType === "PERCENT" && discountValue > 0) return normalizeRule({ type: "ORDER_PERCENT", value: discountValue });
  if (discountType === "FIXED" && discountValue > 0) return normalizeRule({ type: "ORDER_FIXED", value: discountValue });
  return null;
}

function promotionToDiscountRule(promotion: any): DiscountRule | null {
  return normalizeRule({
    id: `PROMO-${promotion.id}`,
    label: promotion.name,
    type: promotion.type,
    value: Number(promotion.value) || 0,
    category: promotion.category || undefined
  });
}

function computeDiscount(rules: DiscountRule[], subtotal: number, orderItems: OrderItemDraft[]) {
  let totalDiscount = 0;
  const applied: Array<{ label: string; amount: number }> = [];

  const applyCap = (amount: number, rule: DiscountRule) => {
    const cappedByRule = rule.maxDiscount === undefined ? amount : Math.min(amount, rule.maxDiscount);
    return roundMoney(Math.min(Math.max(0, subtotal - totalDiscount), cappedByRule));
  };

  rules.forEach((rule) => {
    let amount = 0;

    if (rule.type === "ORDER_PERCENT") {
      amount = subtotal * ((rule.value ?? 0) / 100);
    } else if (rule.type === "ORDER_FIXED") {
      amount = rule.value ?? 0;
    } else if (rule.type === "CATEGORY_PERCENT") {
      const eligible = orderItems
        .filter((item) => item.category === rule.category)
        .reduce((sum, item) => sum + item.lineTotal, 0);
      amount = eligible * ((rule.value ?? 0) / 100);
    } else if (rule.type === "BUY_X_GET_Y") {
      const buyQty = rule.buyQty ?? 2;
      const getQty = rule.getQty ?? 1;
      const unitPrices: number[] = [];

      orderItems
        .filter((item) => item.category === rule.category && item.qty > 0)
        .forEach((item) => {
          const wholeQty = Math.floor(item.qty);
          const unitPrice = item.lineTotal / item.qty;
          for (let index = 0; index < wholeQty; index += 1) unitPrices.push(unitPrice);
        });

      const freeCount = Math.floor(unitPrices.length / (buyQty + getQty)) * getQty;
      amount = unitPrices.sort((a, b) => a - b).slice(0, freeCount).reduce((sum, price) => sum + price, 0);
    }

    const discount = applyCap(amount, rule);
    if (discount > 0) {
      totalDiscount = roundMoney(totalDiscount + discount);
      applied.push({ label: rule.label || rule.type, amount: discount });
    }
  });

  return { discountAmount: roundMoney(totalDiscount), applied };
}

function normalizePaymentMethod(value: string): PaymentMethod {
  if (!PAYMENT_METHODS.has(value as PaymentMethod)) throw new Error("วิธีชำระเงินไม่ถูกต้อง");
  return value as PaymentMethod;
}

function normalizePaymentDetails(paymentMethod: PaymentMethod, total: number, details: PaymentDetails = {}) {
  const referenceNo = typeof details.referenceNo === "string" && details.referenceNo.trim()
    ? details.referenceNo.trim().slice(0, 120)
    : null;
  if (paymentMethod === "CASH") {
    const cashReceived = Number(details.cashReceived);
    if (!Number.isFinite(cashReceived) || cashReceived < total) throw new Error("ยอดรับเงินสดไม่พอ");
    return {
      status: "CONFIRMED",
      cashReceived: roundMoney(cashReceived),
      changeAmount: roundMoney(cashReceived - total),
      referenceNo
    };
  }

  if (details.paymentConfirmed !== true) throw new Error("กรุณายืนยันการชำระเงินก่อนบันทึกออเดอร์");
  return {
    status: "CONFIRMED",
    cashReceived: null,
    changeAmount: null,
    referenceNo
  };
}

function isRetryableCheckoutError(error: any) {
  const message = String(error?.message ?? "");
  return error?.code === "P2034"
    || /write conflict|deadlock|could not serialize|transaction.*(conflict|closed|timeout)/i.test(message)
    || message.includes("สต็อกมีการเปลี่ยนแปลง");
}

function waitForCheckoutRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(250, 25 * (attempt + 1))));
}

function parseStoredModifiers(value: unknown): Modifier[] {
  if (Array.isArray(value)) return value as Modifier[];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as Modifier[] : [];
  } catch {
    return [];
  }
}

function addRequiredStock(requiredStock: Map<number, number>, ingredientId: number, qty: number) {
  requiredStock.set(ingredientId, roundMoney((requiredStock.get(ingredientId) ?? 0) + qty));
}

async function addModifierStockRequirements(tx: any, requiredStock: Map<number, number>, modifiers: Modifier[], qty: number, branchId: number) {
  for (const modifier of modifiers) {
    if (modifier.name !== "Cup") continue;
    const requirements = await getCupStockRequirements(tx, branchId, modifier.value);
    for (const requirement of requirements) {
      addRequiredStock(requiredStock, requirement.ingredientId, requirement.qty * qty);
    }
  }
}

async function addModifierStockRequirementsForItems(tx: any, requiredStock: Map<number, number>, items: OrderItemDraft[], branchId: number) {
  const cupQtyByOption = new Map<string, number>();
  for (const item of items) {
    for (const modifier of item.modifiers) {
      if (modifier.name !== "Cup") continue;
      cupQtyByOption.set(modifier.value, roundMoney((cupQtyByOption.get(modifier.value) ?? 0) + item.qty));
    }
  }
  if (cupQtyByOption.size === 0) return;

  const requirementsByOption = await getCupStockRequirementsByOption(tx, branchId, Array.from(cupQtyByOption.keys()));
  for (const [cupOption, cupQty] of cupQtyByOption) {
    const requirements = requirementsByOption.get(cupOption as any) ?? [];
    for (const requirement of requirements) {
      addRequiredStock(requiredStock, requirement.ingredientId, requirement.qty * cupQty);
    }
  }
}

async function applyStrictStockDecrements(tx: any, branchId: number, stock: Map<number, number>, orderId: number) {
  if (stock.size === 0) return;

  for (const [ingredientId, requiredQty] of stock) {
    const decrementResult = await tx.ingredientStock.updateMany({
      where: {
        branchId,
        ingredientId,
        stockQty: { gte: requiredQty }
      },
      data: { stockQty: { decrement: requiredQty } }
    });
    if (decrementResult.count !== 1) {
      const stockRow = await tx.ingredientStock.findUnique({
        where: {
          branchId_ingredientId: {
            branchId,
            ingredientId
          }
        },
        include: { ingredient: { select: { name: true } } }
      });
      if (!stockRow || stockRow.stockQty < requiredQty) {
        const name = stockRow?.ingredient.name ?? `วัตถุดิบ #${ingredientId}`;
        const available = stockRow?.stockQty ?? 0;
        throw new Error(`สต็อกไม่พอ: ${name} คงเหลือ ${available}, ต้องใช้ ${requiredQty}`);
      }
      throw new Error("สต็อกมีการเปลี่ยนแปลง กรุณาลองชำระเงินใหม่");
    }
  }
}

async function applyFlexibleStockDecrements(tx: any, branchId: number, stock: Map<number, number>) {
  if (stock.size === 0) return;

  for (const [ingredientId, requiredQty] of stock) {
    await tx.ingredientStock.upsert({
      where: {
        branchId_ingredientId: {
          branchId,
          ingredientId
        }
      },
      update: { stockQty: { decrement: requiredQty } },
      create: {
        branchId,
        ingredientId,
        stockQty: -requiredQty,
        reorderLevel: 0
      }
    });
  }
}

async function createSaleStockMovements(tx: any, branchId: number, orderId: number, ...stocks: Map<number, number>[]) {
  const rows = stocks.flatMap((stock) => Array.from(stock.entries()))
    .filter(([, qty]) => qty > 0)
    .map(([ingredientId, qty]) => ({
      branchId,
      ingredientId,
      qty: -qty,
      reason: `SALE-${orderId}`
    }));
  if (rows.length > 0) await tx.stockMovement.createMany({ data: rows });
}

async function writeIntegrationOutbox(outboxPayload: Record<string, unknown>) {
  await prisma.integrationOutbox.createMany({
    data: [
      { provider: "rd_tax", eventType: "ORDER_TAX_RECEIPT_READY", entityType: "order", entityId: Number(outboxPayload.orderId), payload: JSON.stringify(outboxPayload) },
      { provider: "line_oa", eventType: "ORDER_RECEIPT_MESSAGE_READY", entityType: "order", entityId: Number(outboxPayload.orderId), payload: JSON.stringify(outboxPayload) },
      { provider: "lineman", eventType: "ORDER_SYNC_READY", entityType: "order", entityId: Number(outboxPayload.orderId), payload: JSON.stringify(outboxPayload) }
    ]
  });
}

function scheduleIntegrationOutbox(outboxPayload: Record<string, unknown>) {
  setTimeout(() => {
    void writeIntegrationOutbox(outboxPayload).catch((error) => {
      log("warn", "checkout_outbox_write_failed", {
        orderId: outboxPayload.orderId ?? null,
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }, 0);
}

export async function getOrders(branchId?: number) {
  const orders = await prisma.order.findMany({
    where: branchId ? { branchId } : undefined,
    include: { items: true },
    orderBy: { id: "desc" }
  });
  return orders.map(hydrateOrder);
}

export async function getOrder(id: number) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true }
  });
  return hydrateOrder(order);
}

export async function getOrderByIdempotencyKey(idempotencyKey: string) {
  const key = idempotencyKey.trim().slice(0, 120);
  if (!key) return null;
  const order = await prisma.order.findUnique({
    where: { idempotencyKey: key },
    include: { items: true }
  });
  return hydrateOrder(order);
}

export async function updateOrderStatus(id: number, status: string) {
  return updateOrderStatusWithContext(id, { status });
}

export async function updateOrderStatusWithContext(id: number, input: {
  status: string;
  actorId?: number | null;
  reason?: string | null;
}) {
  const status = input.status;
  if (!ALLOWED_STATUSES.has(status)) throw new Error("สถานะออเดอร์ไม่ถูกต้อง");

  if (REVERSAL_STATUSES.has(status)) {
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id },
        include: { items: true }
      });
      if (!current) return null;
      if (REVERSAL_STATUSES.has(current.status)) return current;
      const reversalPayload = {
        previousStatus: current.status,
        newStatus: status,
        total: current.total,
        paymentMethod: current.paymentMethod,
        stockRestored: [] as Array<{ ingredientId: number; qty: number }>,
        loyaltyPointsDelta: current.loyaltyPointsUsed - current.loyaltyPointsEarned,
        shiftDelta: current.shiftId ? {
          totalSales: -current.total,
          totalOrders: -1
        } : null
      };

      const saleMovements = await tx.stockMovement.findMany({
        where: {
          branchId: current.branchId,
          reason: `SALE-${current.id}`,
          qty: { lt: 0 }
        }
      });
      const stockToRestore = new Map<number, number>();

      if (saleMovements.length > 0) {
        for (const movement of saleMovements) {
          addRequiredStock(stockToRestore, movement.ingredientId, Math.abs(movement.qty));
        }
      } else {
        for (const item of current.items) {
          const recipes = await tx.recipe.findMany({ where: { menuItemId: item.menuItemId } });
          for (const recipe of recipes) {
            const restoreQty = recipe.qty * item.qty;
            addRequiredStock(stockToRestore, recipe.ingredientId, restoreQty);
          }
          await addModifierStockRequirements(tx, stockToRestore, parseStoredModifiers(item.modifiers), item.qty, current.branchId);
        }
      }

      for (const [ingredientId, restoreQty] of stockToRestore) {
        reversalPayload.stockRestored.push({ ingredientId, qty: restoreQty });
        await tx.ingredientStock.upsert({
          where: {
            branchId_ingredientId: {
              branchId: current.branchId,
              ingredientId
            }
          },
          update: { stockQty: { increment: restoreQty } },
          create: {
            branchId: current.branchId,
            ingredientId,
            stockQty: restoreQty,
            reorderLevel: 0
          }
        });
        await tx.stockMovement.create({
          data: {
            branchId: current.branchId,
            ingredientId,
            qty: restoreQty,
            reason: `${status}-${current.id}`
          }
        });
      }

      if (current.customerId) {
        await tx.customer.update({
          where: { id: current.customerId },
          data: {
            points: {
              increment: current.loyaltyPointsUsed - current.loyaltyPointsEarned
            }
          }
        });
        await tx.customer.updateMany({
          where: { id: current.customerId, points: { lt: 0 } },
          data: { points: 0 }
        });
      }

      if (current.shiftId) {
        const cashAdd = current.paymentMethod === "CASH" ? -current.total : 0;
        const qrAdd = current.paymentMethod === "QR" ? -current.total : 0;
        const cardAdd = current.paymentMethod === "CARD" || current.paymentMethod === "EWALLET" ? -current.total : 0;
        await tx.shift.update({
          where: { id: current.shiftId },
          data: {
            totalSales: { increment: -current.total },
            totalOrders: { increment: -1 },
            cashSales: { increment: cashAdd },
            qrSales: { increment: qrAdd },
            cardSales: { increment: cardAdd }
          }
        });
      }

      const updated = await tx.order.update({
        where: { id },
        data: { status },
        include: { items: true }
      });
      await tx.orderEvent.create({
        data: {
          orderId: current.id,
          eventType: status === "REFUNDED" ? "ORDER_REFUNDED" : "ORDER_CANCELLED",
          actorId: input.actorId ?? null,
          reason: input.reason?.trim() || null,
          payload: JSON.stringify(reversalPayload)
        }
      });
      return updated;
    });
    return hydrateOrder(order);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id }, select: { status: true } });
      const order = await tx.order.update({
        where: { id },
        data: { status },
        include: { items: true }
      });
      await tx.orderEvent.create({
        data: {
          orderId: id,
          eventType: "ORDER_STATUS_CHANGED",
          actorId: input.actorId ?? null,
          reason: input.reason?.trim() || null,
          payload: JSON.stringify({ previousStatus: current?.status ?? null, newStatus: status })
        }
      });
      return order;
    });
    return hydrateOrder(updated);
  } catch {
    return null;
  }
}

export async function createOrder(input: {
  branchId: number;
  customerId: number | null;
  items: { menuItemId: number; productUnitId?: number | null; qty: number; modifiers: Modifier[]; note?: string }[];
  paymentMethod: PaymentMethod;
  discountType: DiscountType;
  discountValue: number;
  loyaltyPointsToUse: number;
  userId?: number;
  shiftId?: number;
  discounts?: DiscountRule[];
  paymentDetails?: PaymentDetails;
  idempotencyKey?: string | null;
}) {
  const checkoutStartedAt = Date.now();
  let preflightMs = 0;
  let transactionMs = 0;
  const checkoutStepMs: Record<string, number> = {};
  let attempts = 0;
  let strictStockItems = 0;
  let flexibleStockItems = 0;
  const measureCheckoutStep = async <T>(name: string, fn: () => Promise<T>) => {
    if (process.env.CHECKOUT_PERF_LOG !== "1") return fn();
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      checkoutStepMs[name] = (checkoutStepMs[name] ?? 0) + Date.now() - startedAt;
    }
  };
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
    ? input.idempotencyKey.trim().slice(0, 120)
    : null;
  for (const item of input.items) {
    if (!Number.isFinite(item.menuItemId) || !Number.isFinite(item.qty) || item.qty <= 0 || item.qty > 999) {
      throw new Error("รายการสินค้าไม่ถูกต้อง");
    }
  }

  const menuIds = Array.from(new Set(input.items.map((item) => item.menuItemId)));
  const productUnitIds = Array.from(new Set(input.items.map((item) => Number(item.productUnitId)).filter((id) => Number.isFinite(id) && id > 0)));
  const [branch, customer, menuItems, productUnits, priceRules, storeSetting] = await Promise.all([
    prisma.branch.findFirst({ where: { id: input.branchId, active: true } }),
    input.customerId ? getCustomer(input.customerId) : Promise.resolve(null),
    prisma.menuItem.findMany({
      where: {
        id: { in: menuIds },
        active: true
      }
    }),
    productUnitIds.length
      ? (prisma as any).productUnit.findMany({ where: { id: { in: productUnitIds }, active: true } })
      : Promise.resolve([]),
    (prisma as any).priceRule.findMany({
      where: {
        active: true,
        OR: [{ menuItemId: { in: menuIds } }, { menuItemId: null }]
      },
      orderBy: [{ minQty: "desc" }, { id: "desc" }]
    }).catch(() => []),
    prisma.storeSetting.findUnique({ where: { branchId: input.branchId } })
  ]);
  if (!branch) throw new Error("ไม่พบสาขาที่ระบุ");
  if (input.customerId && !customer) throw new Error("ไม่พบสมาชิกที่ระบุ");
  if (storeSetting && !parsePaymentMethods(storeSetting.paymentMethods).includes(paymentMethod)) {
    throw new Error("วิธีชำระเงินนี้ถูกปิดไว้");
  }

  const menuById = new Map(menuItems.map((item) => [item.id, item]));
  const productUnitById = new Map<number, any>(productUnits.map((item: any) => [item.id, item]));
  const orderItems: OrderItemDraft[] = [];

  for (const item of input.items) {
    const mi = menuById.get(item.menuItemId);
    if (!mi) throw new Error(`ไม่พบสินค้า ID ${item.menuItemId}`);
    if (mi.branchType !== branch.branchType) throw new Error(`สินค้า ${mi.name} ไม่ตรงกับประเภทสาขา`);
    const productUnit = item.productUnitId ? productUnitById.get(item.productUnitId) : null;
    if (item.productUnitId && (!productUnit || productUnit.menuItemId !== mi.id)) throw new Error("หน่วยสินค้าไม่ถูกต้อง");

    const modifiers = normalizeModifiers(item.modifiers, mi.category);
    const modTotal = modifiers.reduce((s, m) => s + m.price, 0);
    const unitFactor = productUnit ? Number(productUnit.factor || 1) : 1;
    const customerTier = String((customer as any)?.tier ?? "").trim();
    const matchedPriceRule = priceRules.find((rule: any) => {
      const tierMatches = !rule.customerTier || rule.customerTier === customerTier;
      const itemMatches = rule.menuItemId === null || rule.menuItemId === mi.id;
      return tierMatches && itemMatches && item.qty >= Number(rule.minQty || 1);
    });
    const normalUnitPrice = productUnit?.price != null ? Number(productUnit.price) : mi.basePrice * unitFactor;
    const unitBasePrice = matchedPriceRule ? Number(matchedPriceRule.price) : normalUnitPrice;
    const lineTotal = roundMoney((unitBasePrice + modTotal) * item.qty);
    orderItems.push({
      menuItemId: mi.id,
      name: productUnit ? `${mi.name} (${productUnit.unitName})` : mi.name,
      category: mi.category,
      qty: roundMoney(item.qty * unitFactor),
      basePrice: unitBasePrice,
      modifiers,
      lineTotal,
      note: item.note
    });
  }
  preflightMs = Date.now() - checkoutStartedAt;
  const qtyByMenuItemId = new Map<number, number>();
  orderItems.forEach((item) => {
    qtyByMenuItemId.set(item.menuItemId, roundMoney((qtyByMenuItemId.get(item.menuItemId) ?? 0) + item.qty));
  });

  const subtotal = roundMoney(orderItems.reduce((s, i) => s + i.lineTotal, 0));
  const activePromotions: any[] = await (prisma as any).promotion.findMany({
    where: {
      active: true,
      OR: [
        { startAt: null },
        { startAt: { lte: new Date() } }
      ],
      AND: [
        {
          OR: [
            { endAt: null },
            { endAt: { gte: new Date() } }
          ]
        }
      ]
    },
    orderBy: { id: "asc" }
  }).catch(() => []);
  const requestedRules = Array.isArray(input.discounts)
    ? input.discounts.map(normalizeRule).filter((rule): rule is DiscountRule => Boolean(rule))
    : [];
  const promotionRules = activePromotions.map(promotionToDiscountRule).filter((rule: DiscountRule | null): rule is DiscountRule => Boolean(rule));
  const fallbackRule = legacyDiscountRule(input.discountType, input.discountValue);
  const discountRules = [...promotionRules, ...(requestedRules.length ? requestedRules : (fallbackRule ? [fallbackRule] : []))];
  const { discountAmount, applied: appliedDiscounts } = computeDiscount(discountRules, subtotal, orderItems);

  const discountable = Math.max(0, subtotal - discountAmount);
  const availablePoints = customer ? customer.points : 0;
  const requestedPoints = Math.max(0, Math.floor(input.loyaltyPointsToUse));
  const pointsToUse = Math.min(requestedPoints, availablePoints, Math.floor(discountable));
  const amountAfterPointsBeforeTax = roundMoney(discountable - pointsToUse);
  const vatResult = computeVatTotal(amountAfterPointsBeforeTax, storeSetting?.vatMode, storeSetting?.vatRate);
  const tax = vatResult.tax;
  const total = vatResult.total;

  const drinkCount = customer ? orderItems.reduce((sum, oi) => sum + (DRINK_CATEGORIES.includes(oi.category) ? oi.qty : 0), 0) : 0;
  const pointsEarned = Math.floor(drinkCount);
  const paymentDetails = normalizePaymentDetails(paymentMethod, total, input.paymentDetails);

  const integrationPayload = {
    branchId: input.branchId,
    customerId: input.customerId,
    userId: input.userId ?? null,
    shiftId: input.shiftId ?? null,
    paymentMethod,
    subtotal,
    discountAmount,
    discounts: appliedDiscounts,
    loyaltyPointsUsed: pointsToUse,
    loyaltyPointsEarned: pointsEarned,
    tax,
    total,
    paymentStatus: paymentDetails.status,
    cashReceived: paymentDetails.cashReceived,
    changeAmount: paymentDetails.changeAmount,
    items: orderItems.map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      category: item.category,
      qty: item.qty,
      lineTotal: item.lineTotal
    }))
  };

  let order;
  for (let attempt = 0; attempt <= checkoutTransactionRetries; attempt += 1) {
    attempts = attempt + 1;
    const transactionStartedAt = Date.now();
    try {
      order = await prisma.$transaction(async (tx) => {
    const requiredStock = new Map<number, number>();
    const flexibleStock = new Map<number, number>();
    const recipes = await measureCheckoutStep("recipes", () => tx.recipe.findMany({
      where: { menuItemId: { in: Array.from(qtyByMenuItemId.keys()) } }
    }));
    for (const recipe of recipes) {
      addRequiredStock(requiredStock, recipe.ingredientId, recipe.qty * (qtyByMenuItemId.get(recipe.menuItemId) ?? 0));
    }
    await measureCheckoutStep("modifierStock", () => addModifierStockRequirementsForItems(tx, flexibleStock, orderItems, input.branchId));
    strictStockItems = requiredStock.size;
    flexibleStockItems = flexibleStock.size;

    const newOrder = await measureCheckoutStep("orderCreate", () => tx.order.create({
      data: {
        branchId: input.branchId,
        customerId: input.customerId,
        userId: input.userId ?? null,
        shiftId: input.shiftId ?? null,
        status: "PAID",
        subtotal,
        discountType: discountRules.length ? "FIXED" : null,
        discountValue: discountAmount,
        discountAmount,
        loyaltyPointsUsed: pointsToUse,
        loyaltyPointsEarned: pointsEarned,
        tax,
        total,
        paymentMethod,
        idempotencyKey,
        items: {
          create: orderItems.map(i => ({
            menuItemId: i.menuItemId,
            name: i.name,
            qty: i.qty,
            basePrice: i.basePrice,
            modifiers: JSON.stringify(i.modifiers),
            lineTotal: i.lineTotal,
            note: i.note ?? null
          }))
        }
      },
      include: { items: true }
    }));

    await measureCheckoutStep("paymentCreate", () => tx.payment.create({
      data: {
        orderId: newOrder.id,
        method: paymentMethod,
        status: paymentDetails.status,
        amountDue: total,
        amountReceived: paymentDetails.cashReceived,
        changeAmount: paymentDetails.changeAmount,
        referenceNo: paymentDetails.referenceNo,
        confirmedByUserId: input.userId ?? null
      }
    }));
    const orderEvents = [{
        orderId: newOrder.id,
        eventType: "ORDER_CREATED",
        actorId: input.userId ?? null,
        payload: JSON.stringify({
          subtotal,
          discountAmount,
          tax,
          total,
          paymentMethod,
          paymentStatus: paymentDetails.status,
          idempotencyKey
        })
      }];
    if (idempotencyKey) {
      orderEvents.push({
          orderId: newOrder.id,
          eventType: `${IDEMPOTENCY_EVENT_PREFIX}${idempotencyKey}`,
          actorId: input.userId ?? null,
          payload: JSON.stringify({ idempotencyKey })
      });
    }
    await measureCheckoutStep("orderEventCreateMany", () => tx.orderEvent.createMany({ data: orderEvents }));

    if (customer && pointsToUse > 0) {
      const pointsResult = await measureCheckoutStep("customerPointsUpdate", () => tx.customer.updateMany({
        where: { id: input.customerId!, points: { gte: pointsToUse } },
        data: { points: { increment: -pointsToUse + pointsEarned } }
      }));
      if (pointsResult.count !== 1) throw new Error("แต้มสมาชิกไม่พอ กรุณารีเฟรชข้อมูลสมาชิก");
    } else if (customer && pointsEarned > 0) {
      await measureCheckoutStep("customerPointsUpdate", () => tx.customer.update({
        where: { id: input.customerId! },
        data: { points: { increment: pointsEarned } }
      }));
    }

    await measureCheckoutStep("strictStock", () => applyStrictStockDecrements(tx, input.branchId, requiredStock, newOrder.id));
    await measureCheckoutStep("flexibleStock", () => applyFlexibleStockDecrements(tx, input.branchId, flexibleStock));
    await measureCheckoutStep("stockMovements", () => createSaleStockMovements(tx, input.branchId, newOrder.id, requiredStock, flexibleStock));

    if (input.shiftId) {
      const cashAdd = paymentMethod === "CASH" ? total : 0;
      const qrAdd = paymentMethod === "QR" ? total : 0;
      const cardAdd = paymentMethod === "CARD" || paymentMethod === "EWALLET" ? total : 0;
      await measureCheckoutStep("shiftUpdate", () => tx.shift.update({
        where: { id: input.shiftId },
        data: {
          totalSales: { increment: total },
          totalOrders: { increment: 1 },
          cashSales: { increment: cashAdd },
          qrSales: { increment: qrAdd },
          cardSales: { increment: cardAdd }
        }
      }));
    }

      return newOrder;
      });
      transactionMs += Date.now() - transactionStartedAt;
      break;
    } catch (error: any) {
      transactionMs += Date.now() - transactionStartedAt;
      if (idempotencyKey && error?.code === "P2002") {
        const existingOrder = await prisma.order.findUnique({
          where: { idempotencyKey },
          include: { items: true }
        });
        if (existingOrder) return hydrateOrder(existingOrder);
      }
      if (!isRetryableCheckoutError(error) || attempt >= checkoutTransactionRetries) throw error;
      await waitForCheckoutRetry(attempt);
    }
  }

  if (process.env.CHECKOUT_PERF_LOG === "1") {
    log("info", "checkout_performance", {
      durationMs: Date.now() - checkoutStartedAt,
      preflightMs,
      transactionMs,
      attempts,
      branchId: input.branchId,
      itemCount: orderItems.length,
      uniqueMenuItems: qtyByMenuItemId.size,
      strictStockItems,
      flexibleStockItems,
      paymentMethod,
      orderId: order?.id ?? null,
      stepMs: checkoutStepMs
    });
  }
  if (order?.id) {
    const outboxPayload = { ...integrationPayload, orderId: order.id };
    if (process.env.CHECKOUT_SYNC_OUTBOX === "1") await writeIntegrationOutbox(outboxPayload);
    else scheduleIntegrationOutbox(outboxPayload);
  }
  return hydrateOrder(order);
}
