import prisma from "../prisma.js";

interface PurchaseItemInput {
  ingredientId: number;
  /** stock units received (packs already converted: 2 ลัง × 12 = 24) */
  qty: number;
  /** cost per stock unit */
  unitCost: number;
  /** how it was bought, e.g. "2 ลัง × 12" — shown on the receipt */
  description?: string;
  lotNo?: string;
  expiryDate?: string | null;
}

/** Units that are counted, so a fraction (2.5 ขวด) is a typo, not a measurement. */
export const COUNTED_UNITS = new Set(["ชิ้น", "ขวด", "กระป๋อง", "แพ็ค", "ใบ", "ซอง", "กล่อง", "ลัง", "ถุง", "แก้ว", "อัน", "ห่อ", "หลอด", "ฝา", "ถ้วย", "ลูก", "ตัว", "แผ่น", "ม้วน", "คู่"]);

const round = (value: number, dp = 4) => Math.round(value * 10 ** dp) / 10 ** dp;
const money = (value: number) => Math.round(value * 100) / 100;

/**
 * Receive goods into a branch. Stock goes up now (one PO#id movement per line),
 * an expiry date makes a lot for FEFO, and with updateCost each item's shared
 * cost becomes the weighted average of what's on hand (all branches) and this
 * delivery. ฿0 lines (free goods) still add stock but never pull the cost down.
 */
export async function createPurchase(branchId: number, supplier: string, note: string, items: PurchaseItemInput[], options: { updateCost?: boolean } = {}) {
  const ingredients = await prisma.ingredient.findMany({ where: { id: { in: [...new Set(items.map((i) => i.ingredientId))] } }, select: { id: true, name: true, unit: true } });
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));
  for (const item of items) {
    const ingredient = ingredientById.get(item.ingredientId);
    if (!ingredient) throw new Error(`ไม่พบสินค้า #${item.ingredientId}`);
    if (COUNTED_UNITS.has(ingredient.unit.trim()) && Math.abs(item.qty - Math.round(item.qty)) > 1e-9) {
      throw new Error(`${ingredient.name} นับเป็น${ingredient.unit} ต้องรับเป็นจำนวนเต็ม (ใส่ ${item.qty})`);
    }
    if (item.expiryDate && Number.isNaN(new Date(item.expiryDate).getTime())) throw new Error(`วันหมดอายุของ ${ingredient.name} ไม่ถูกต้อง`);
  }

  const totalCost = money(items.reduce((sum, i) => sum + i.qty * i.unitCost, 0));
  const costChanges: { ingredientId: number; from: number; to: number }[] = [];

  const purchase = await prisma.$transaction(async (tx: any) => {
    // on-hand before this delivery, across branches, for the weighted average
    const onHandRows = options.updateCost
      ? await tx.ingredientStock.groupBy({ by: ["ingredientId"], where: { ingredientId: { in: [...ingredientById.keys()] }, stockQty: { gt: 0 } }, _sum: { stockQty: true } })
      : [];
    const onHand = new Map<number, number>(onHandRows.map((r: any) => [r.ingredientId, Number(r._sum.stockQty) || 0]));

    const po = await tx.purchase.create({
      data: {
        branchId,
        supplier,
        note,
        total: totalCost,
        status: "RECEIVED",
        items: {
          create: items.map((item) => ({
            ingredientId: item.ingredientId,
            description: (item.description ?? "").slice(0, 120),
            qty: item.qty,
            unitCost: item.unitCost,
            lineTotal: money(item.qty * item.unitCost)
          }))
        }
      }
    });

    for (const item of items) {
      await tx.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId, ingredientId: item.ingredientId } },
        update: { stockQty: { increment: item.qty } },
        create: { branchId, ingredientId: item.ingredientId, stockQty: item.qty, reorderLevel: 0 }
      });
      await tx.stockMovement.create({ data: { branchId, ingredientId: item.ingredientId, qty: item.qty, reason: `PO#${po.id}` } });
      if (item.expiryDate) {
        await tx.inventoryLot.create({
          data: { branchId, ingredientId: item.ingredientId, purchaseId: po.id, lotNo: (item.lotNo ?? "").trim().slice(0, 40), qty: item.qty, expiryDate: new Date(item.expiryDate) }
        });
      }
    }

    if (options.updateCost) {
      // the same item twice on one bill counts as one delivery
      const received = new Map<number, { qty: number; value: number }>();
      for (const item of items) {
        if (!(item.unitCost > 0)) continue;
        const r = received.get(item.ingredientId) ?? { qty: 0, value: 0 };
        received.set(item.ingredientId, { qty: r.qty + item.qty, value: r.value + item.qty * item.unitCost });
      }
      const current = await tx.ingredient.findMany({ where: { id: { in: [...received.keys()] } }, select: { id: true, costPerUnit: true } });
      for (const ing of current) {
        const r = received.get(ing.id)!;
        const stock = ing.costPerUnit > 0 ? onHand.get(ing.id) ?? 0 : 0;
        const to = round((stock * ing.costPerUnit + r.value) / (stock + r.qty));
        if (Math.abs(to - ing.costPerUnit) < 1e-6) continue;
        await tx.ingredient.update({ where: { id: ing.id }, data: { costPerUnit: to } });
        costChanges.push({ ingredientId: ing.id, from: ing.costPerUnit, to });
      }
    }

    return po;
  });

  const result = await getPurchase(purchase.id);
  return result ? { ...result, costChanges } : null;
}

/**
 * Cancel a receipt keyed in by mistake: its stock comes back out (PO_VOID#id)
 * and its lots are removed. Refused if part of it was already used up, so stock
 * never goes negative — count the stock instead in that case. Costs are left
 * as they are (an average can't be un-mixed); fix one by hand if needed.
 */
export async function voidPurchase(id: number, reason: string) {
  const why = reason.trim();
  if (!why) throw new Error("กรุณาระบุเหตุผลที่ยกเลิก");
  await prisma.$transaction(async (tx: any) => {
    const po = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new Error("ไม่พบใบรับสินค้า");
    if (po.status === "VOID") throw new Error("ใบรับนี้ถูกยกเลิกไปแล้ว");
    const byIngredient = new Map<number, number>();
    for (const item of po.items) if (item.ingredientId) byIngredient.set(item.ingredientId, (byIngredient.get(item.ingredientId) ?? 0) + item.qty);
    for (const [ingredientId, qty] of byIngredient) {
      const taken = await tx.ingredientStock.updateMany({ where: { branchId: po.branchId, ingredientId, stockQty: { gte: qty } }, data: { stockQty: { decrement: qty } } });
      if (taken.count !== 1) {
        const ing = await tx.ingredient.findUnique({ where: { id: ingredientId }, select: { name: true } });
        throw new Error(`ยกเลิกไม่ได้: ${ing?.name ?? `#${ingredientId}`} ถูกใช้ไปแล้วบางส่วน (คงเหลือน้อยกว่าที่รับ) ให้นับสต็อกแทน`);
      }
      await tx.stockMovement.create({ data: { branchId: po.branchId, ingredientId, qty: -qty, reason: `PO_VOID#${id}` } });
    }
    await tx.inventoryLot.deleteMany({ where: { purchaseId: id } });
    await tx.purchase.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidReason: why.slice(0, 300) } });
  });
  return getPurchase(id);
}

function hydratePurchase(po: any, ingMap: Map<number, { name: string; unit: string }>) {
  return {
    id: po.id,
    branchId: po.branchId,
    branchName: po.branch?.name,
    supplier: po.supplier,
    note: po.note,
    totalCost: po.total,
    status: po.status,
    voidReason: po.voidReason ?? "",
    voidedAt: po.voidedAt ? po.voidedAt.toISOString() : null,
    receivedAt: po.createdAt.toISOString(),
    createdAt: po.createdAt.toISOString(),
    itemCount: po._count?.items ?? po.items.length,
    items: po.items.map((pi: any) => {
      const ing = pi.ingredientId ? ingMap.get(pi.ingredientId) : null;
      return {
        id: pi.id,
        ingredientId: pi.ingredientId,
        ingredientName: ing ? ing.name : "Unknown",
        unit: ing ? ing.unit : "-",
        description: pi.description || "",
        qty: pi.qty,
        unitCost: pi.unitCost,
        lineTotal: pi.lineTotal
      };
    })
  };
}

async function ingredientNames(pos: any[]) {
  // PurchaseItem has no relation to Ingredient, so names are looked up once
  const ids = [...new Set(pos.flatMap((po) => po.items.map((i: any) => i.ingredientId)).filter(Boolean))] as number[];
  const rows = ids.length ? await prisma.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } }) : [];
  return new Map(rows.map((i) => [i.id, i]));
}

export async function getPurchase(id: number) {
  const po = await prisma.purchase.findUnique({ where: { id }, include: { items: true, branch: true } });
  if (!po) return null;
  return hydratePurchase(po, await ingredientNames([po]));
}

export async function getPurchases(branchId?: number) {
  const pos = await prisma.purchase.findMany({
    where: branchId ? { branchId } : undefined,
    include: { branch: true, items: true, _count: { select: { items: true } } },
    orderBy: { id: "desc" },
    take: 50
  });
  const ingMap = await ingredientNames(pos);
  return pos.map((po) => hydratePurchase(po, ingMap));
}
