import prisma from "../prisma.js";
import { adjustStock, getRecipe } from "./inventory.js";
import { updateCustomerPoints, getCustomer } from "./customers.js";
import { enqueueIntegrationEvent } from "./integrations.js";

type Modifier = { name: string; value: string; price: number };
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

function roundMoney(v: number) {
  return Math.round(v * 100) / 100;
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
  if (discountType === "PERCENT" && discountValue > 0) {
    return normalizeRule({ type: "ORDER_PERCENT", value: discountValue });
  }
  if (discountType === "FIXED" && discountValue > 0) {
    return normalizeRule({ type: "ORDER_FIXED", value: discountValue });
  }
  return null;
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

export async function updateOrderStatus(id: number, status: string) {
  try {
    const updated = await prisma.order.update({
      where: { id },
      data: { status },
      include: { items: true }
    });
    return hydrateOrder(updated);
  } catch {
    return null;
  }
}

export async function createOrder(input: {
  branchId: number;
  customerId: number | null;
  items: { menuItemId: number; qty: number; modifiers: Modifier[]; note?: string }[];
  paymentMethod: PaymentMethod;
  discountType: DiscountType;
  discountValue: number;
  loyaltyPointsToUse: number;
  userId?: number;
  shiftId?: number;
  discounts?: DiscountRule[];
}) {
  const branch = await prisma.branch.findFirst({ where: { id: input.branchId, active: true } });
  if (!branch) throw new Error("ไม่พบสาขาที่ระบุ");

  const customer = input.customerId ? await getCustomer(input.customerId) : null;
  if (input.customerId && !customer) throw new Error("ไม่พบสมาชิกที่ระบุ");

  const orderItems: OrderItemDraft[] = [];

  for (const item of input.items) {
    const mi = await prisma.menuItem.findFirst({ where: { id: item.menuItemId, active: true } });
    if (!mi) throw new Error(`ไม่พบสินค้า ID ${item.menuItemId}`);
    const modTotal = item.modifiers.reduce((s, m) => s + m.price, 0);
    const lineTotal = roundMoney((mi.basePrice + modTotal) * item.qty);
    orderItems.push({
      menuItemId: mi.id,
      name: mi.name,
      category: mi.category,
      qty: item.qty,
      basePrice: mi.basePrice,
      modifiers: item.modifiers,
      lineTotal,
      note: item.note
    });
  }

  const subtotal = roundMoney(orderItems.reduce((s, i) => s + i.lineTotal, 0));
  const requestedRules = Array.isArray(input.discounts)
    ? input.discounts.map(normalizeRule).filter((rule): rule is DiscountRule => Boolean(rule))
    : [];
  const fallbackRule = legacyDiscountRule(input.discountType, input.discountValue);
  const discountRules = requestedRules.length ? requestedRules : (fallbackRule ? [fallbackRule] : []);
  const { discountAmount, applied: appliedDiscounts } = computeDiscount(discountRules, subtotal, orderItems);

  const discountable = Math.max(0, subtotal - discountAmount);
  const availablePoints = customer ? customer.points : 0;
  const pointsToUse = Math.min(Math.max(0, Math.floor(input.loyaltyPointsToUse)), availablePoints, Math.floor(discountable));
  const total = roundMoney(discountable - pointsToUse);

  const DRINK_CATEGORIES = ["กาแฟ", "ชา", "เครื่องดื่ม"];
  const drinkCount = customer ? orderItems.reduce((sum, oi) => {
    return sum + (DRINK_CATEGORIES.includes(oi.category) ? oi.qty : 0);
  }, 0) : 0;
  const pointsEarned = Math.floor(drinkCount);

  // Use a transaction for atomic DB updates
  const order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.order.create({
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
        tax: 0,
        total,
        paymentMethod: input.paymentMethod,
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
    });

    if (input.shiftId) {
      const pm = input.paymentMethod;
      const cashAdd = pm === "CASH" ? total : 0;
      const qrAdd = pm === "QR" ? total : 0;
      const cardAdd = (pm === "CARD" || pm === "EWALLET") ? total : 0;
      await tx.shift.update({
        where: { id: input.shiftId },
        data: {
          totalSales: { increment: total },
          totalOrders: { increment: 1 },
          cashSales: { increment: cashAdd },
          qrSales: { increment: qrAdd },
          cardSales: { increment: cardAdd }
        }
      });
    }

    return newOrder;
  });

  // These can be done outside transaction as they manage their own logic/transactions
  for (const i of orderItems) {
    const recipe = await getRecipe(i.menuItemId);
    if (recipe) {
      for (const ing of recipe.ingredients) {
        await adjustStock({
          branchId: input.branchId,
          ingredientId: ing.ingredientId,
          qty: -(ing.qty * i.qty),
          reason: `SALE-${order.id}`
        });
      }
    }
  }

  if (customer) {
    await updateCustomerPoints(input.customerId!, -pointsToUse + pointsEarned);
  }

  const integrationPayload = {
    orderId: order.id,
    branchId: input.branchId,
    customerId: input.customerId,
    userId: input.userId ?? null,
    shiftId: input.shiftId ?? null,
    paymentMethod: input.paymentMethod,
    subtotal,
    discountAmount,
    discounts: appliedDiscounts,
    loyaltyPointsUsed: pointsToUse,
    loyaltyPointsEarned: pointsEarned,
    total,
    items: orderItems.map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      category: item.category,
      qty: item.qty,
      lineTotal: item.lineTotal
    }))
  };

  await enqueueIntegrationEvent({ provider: "rd_tax", eventType: "ORDER_TAX_RECEIPT_READY", entityType: "order", entityId: order.id, payload: integrationPayload });
  await enqueueIntegrationEvent({ provider: "line_oa", eventType: "ORDER_RECEIPT_MESSAGE_READY", entityType: "order", entityId: order.id, payload: integrationPayload });
  await enqueueIntegrationEvent({ provider: "lineman", eventType: "ORDER_SYNC_READY", entityType: "order", entityId: order.id, payload: integrationPayload });

  return hydrateOrder(order);
}
