import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";
import { consumeStockLots } from "./stockLots.js";

const SALES_ONLY_ITEM_NAME = "POSPOS sales-only record";

/** Trimmed barcode, null to clear; undefined when the field was not sent. Throws on unusable input. */
export function normalizeBarcode(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const code = String(raw).trim();
  if (!code) return null;
  if (code.length > 64 || !/^[\x21-\x7E]+$/.test(code)) throw new Error("บาร์โค้ดต้องเป็นตัวอักษรอังกฤษ/ตัวเลข ไม่เกิน 64 ตัว");
  return code;
}

/** A barcode belongs to at most one stock item; name the owner so the user knows what to fix. */
export async function assertBarcodeFree(code: string | null | undefined, exceptIngredientId?: number) {
  if (!code) return;
  const owner = await prisma.ingredient.findFirst({ where: { barcode: code, ...(exceptIngredientId ? { id: { not: exceptIngredientId } } : {}) }, select: { name: true } });
  if (owner) throw new Error(`บาร์โค้ด ${code} ผูกกับ "${owner.name}" อยู่แล้ว`);
}

export async function getIngredients() {
  return prisma.ingredient.findMany({
    orderBy: { id: "asc" }
  });
}

export async function addIngredient(input: {
  name: string;
  unit: string;
  costPerUnit: number;
  barcode?: string | null;
  stockQty: number;
  reorderLevel: number;
  branchId: number;
}) {
  const ingredient = await prisma.ingredient.create({
    data: {
      name: input.name,
      unit: input.unit,
      costPerUnit: input.costPerUnit,
      ...(input.barcode ? { barcode: input.barcode } : {})
    }
  });

  const branches = await prisma.branch.findMany({ where: { active: true } });
  
  for (const branch of branches) {
    await prisma.ingredientStock.create({
      data: {
        branchId: branch.id,
        ingredientId: ingredient.id,
        stockQty: branch.id === input.branchId ? input.stockQty : 0,
        reorderLevel: input.reorderLevel
      }
    });
  }

  return prisma.ingredient.findUnique({ where: { id: ingredient.id } });
}

export async function updateIngredient(
  id: number,
  input: Partial<{ name: string; unit: string; costPerUnit: number; barcode: string | null }>
) {
  const hasUpdates = input.name !== undefined || input.unit !== undefined || input.costPerUnit !== undefined || input.barcode !== undefined;
  if (!hasUpdates) return null;

  try {
    const updated = await prisma.ingredient.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.costPerUnit !== undefined ? { costPerUnit: input.costPerUnit } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {})
      }
    });
    return updated;
  } catch {
    return null;
  }
}

export async function getInventoryItems(branchId: number) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { branchType: true } });
  if (!branch) return [];
  const ingredients = await prisma.ingredient.findMany({
    where: { OR: [
      { stocks: { some: { branchId } } },
      { stocks: { some: { branch: { branchType: branch.branchType } } } },
      { recipes: { some: { menuItem: { branchType: branch.branchType, active: true } } } },
      { stocks: { none: {} }, recipes: { none: {} } }
    ] },
    include: {
      stocks: {
        where: { branchId }
      }
    },
    orderBy: { id: "asc" }
  });

  return ingredients.map(i => {
    const stock = i.stocks[0];
    return {
      ingredientId: i.id,
      name: i.name,
      unit: i.unit,
      costPerUnit: i.costPerUnit,
      barcode: i.barcode,
      stockQty: stock ? stock.stockQty : 0,
      reorderLevel: stock ? stock.reorderLevel : 0
    };
  });
}

export async function updateInventoryItem(input: {
  branchId: number;
  ingredientId: number;
  name?: string;
  unit?: string;
  costPerUnit?: number;
  barcode?: string | null;
  stockQty?: number;
  reorderLevel?: number;
}) {
  const ingredient = await prisma.ingredient.findUnique({
    where: { id: input.ingredientId }
  });
  if (!ingredient) return null;

  const currentStock = await prisma.ingredientStock.findUnique({
    where: {
      branchId_ingredientId: {
        branchId: input.branchId,
        ingredientId: input.ingredientId
      }
    }
  });
  const currentQty = currentStock?.stockQty ?? 0;
  const hasIngredientUpdates =
    input.name !== undefined ||
    input.unit !== undefined ||
    input.costPerUnit !== undefined ||
    input.barcode !== undefined;
  const hasStockUpdates =
    input.stockQty !== undefined ||
    input.reorderLevel !== undefined;

  await prisma.$transaction(async (tx) => {
    if (hasIngredientUpdates) {
      await tx.ingredient.update({
        where: { id: input.ingredientId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.costPerUnit !== undefined ? { costPerUnit: input.costPerUnit } : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {})
        }
      });
    }

    if (hasStockUpdates) {
      await tx.ingredientStock.upsert({
        where: {
          branchId_ingredientId: {
            branchId: input.branchId,
            ingredientId: input.ingredientId
          }
        },
        update: {
          ...(input.stockQty !== undefined ? { stockQty: input.stockQty } : {}),
          ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {})
        },
        create: {
          branchId: input.branchId,
          ingredientId: input.ingredientId,
          stockQty: input.stockQty ?? 0,
          reorderLevel: input.reorderLevel ?? 0
        }
      });

      if (input.stockQty !== undefined) {
        const diff = input.stockQty - currentQty;
        if (diff !== 0) {
          await tx.stockMovement.create({
            data: {
              branchId: input.branchId,
              ingredientId: input.ingredientId,
              qty: diff,
              reason: "STOCK_EDIT"
            }
          });
        }
      }
    }
  });

  const items = await getInventoryItems(input.branchId);
  return items.find((item) => item.ingredientId === input.ingredientId) ?? null;
}

export async function adjustStock(input: { branchId: number; ingredientId: number; qty: number; reason: string; actorUserId?: number }) {
  if (!Number.isFinite(input.qty) || input.qty === 0) throw new Error("จำนวนปรับสต็อกไม่ถูกต้อง");
  return prisma.$transaction(async tx => {
    await tx.ingredientStock.upsert({ where: { branchId_ingredientId: { branchId: input.branchId, ingredientId: input.ingredientId } }, update: {}, create: { branchId: input.branchId, ingredientId: input.ingredientId, stockQty: 0 } });
    const rows = await tx.$queryRaw<Array<{ stock_qty: number }>>(Prisma.sql`SELECT stock_qty FROM ingredient_stocks WHERE branch_id = ${input.branchId} AND ingredient_id = ${input.ingredientId} FOR UPDATE`);
    const beforeQty = rows[0].stock_qty;
    const nextQty = Math.round((beforeQty + input.qty) * 10000) / 10000;
    if (!Number.isFinite(nextQty)) throw new Error("จำนวนปรับสต็อกมากเกินไป");
    if (beforeQty + input.qty < -1e-8) throw new Error(`สต็อกไม่พอ: คงเหลือ ${beforeQty}, ต้องตัด ${-input.qty}`);
    const stock = await tx.ingredientStock.update({ where: { branchId_ingredientId: { branchId: input.branchId, ingredientId: input.ingredientId } }, data: { stockQty: Math.max(0, nextQty) } });
    if (input.qty < 0) await consumeStockLots(tx, input.branchId, input.ingredientId, -input.qty);
    const movement = await tx.stockMovement.create({ data: { branchId: input.branchId, ingredientId: input.ingredientId, qty: input.qty, reason: input.reason, beforeQty, afterQty: stock.stockQty, actorUserId: input.actorUserId ?? null } });
    return { stock, movement };
  });
}

export async function getStockMovements(branchId?: number, options: { ingredientId?: number; manualOnly?: boolean; take?: number } = {}) {
  return prisma.stockMovement.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(options.ingredientId ? { ingredientId: options.ingredientId } : {}),
      // "Manual" = everything except per-sale deductions (SALE-<orderId>).
      ...(options.manualOnly ? { NOT: { reason: { startsWith: "SALE-" } } } : {})
    },
    orderBy: { id: "desc" },
    ...(options.take ? { take: options.take } : {})
  });
}

export async function getRecipes(branchType?: string) {
  const recipes = await prisma.recipe.findMany({
    where: branchType ? { menuItem: { branchType } } : undefined,
    orderBy: { menuItemId: "asc" }
  });

  const map = new Map<number, { menuItemId: number; ingredients: { ingredientId: number; qty: number }[] }>();
  recipes.forEach(r => {
    if (!map.has(r.menuItemId)) map.set(r.menuItemId, { menuItemId: r.menuItemId, ingredients: [] });
    map.get(r.menuItemId)!.ingredients.push({ ingredientId: r.ingredientId, qty: r.qty });
  });

  return Array.from(map.values());
}

export async function getRecipeCoverage(input: { branchId?: number; from?: string; to?: string } = {}) {
  const branch = input.branchId
    ? await prisma.branch.findUnique({ where: { id: input.branchId }, select: { branchType: true } })
    : null;
  const menuItems = await prisma.menuItem.findMany({
    where: branch?.branchType ? { branchType: branch.branchType } : undefined,
    include: { _count: { select: { recipes: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }]
  });

  const orderWhere: Prisma.OrderWhereInput = {
    status: { notIn: ["CANCELLED", "REFUNDED"] }
  };
  if (input.branchId) orderWhere.branchId = input.branchId;
  if (input.from) orderWhere.createdAt = { gte: new Date(input.from) };
  if (input.to) orderWhere.createdAt = { ...(orderWhere.createdAt as object), lte: new Date(input.to + "T23:59:59Z") };

  const soldRows = await prisma.orderItem.groupBy({
    by: ["menuItemId", "name"],
    where: {
      name: { not: SALES_ONLY_ITEM_NAME },
      order: orderWhere
    },
    _sum: { qty: true, lineTotal: true }
  });

  const soldByMenuItemId = new Map(soldRows.map((row) => [
    row.menuItemId,
    {
      qty: Number(row._sum.qty ?? 0),
      revenue: Math.round(Number(row._sum.lineTotal ?? 0) * 100) / 100
    }
  ]));

  const items = menuItems.map((item) => {
    const recipeIngredientCount = item._count.recipes;
    const sold = soldByMenuItemId.get(item.id) ?? { qty: 0, revenue: 0 };
    const status =
      !item.active || item.name === SALES_ONLY_ITEM_NAME
        ? "not_stock_tracked"
        : recipeIngredientCount > 0
          ? "has_recipe"
          : "missing_recipe";

    return {
      menuItemId: item.id,
      name: item.name,
      category: item.category,
      branchType: item.branchType,
      active: item.active,
      status,
      recipeIngredientCount,
      soldQty: sold.qty,
      soldRevenue: sold.revenue
    };
  });

  const soldMissingRecipeItems = items.filter((item) => item.status === "missing_recipe" && item.soldQty > 0);
  return {
    summary: {
      totalMenuItems: items.length,
      activeMenuItems: items.filter((item) => item.active && item.name !== SALES_ONLY_ITEM_NAME).length,
      hasRecipe: items.filter((item) => item.status === "has_recipe").length,
      missingRecipe: items.filter((item) => item.status === "missing_recipe").length,
      notStockTracked: items.filter((item) => item.status === "not_stock_tracked").length,
      soldMissingRecipe: soldMissingRecipeItems.length,
      soldMissingRecipeQty: Math.round(soldMissingRecipeItems.reduce((sum, item) => sum + item.soldQty, 0) * 1000) / 1000,
      soldMissingRecipeRevenue: Math.round(soldMissingRecipeItems.reduce((sum, item) => sum + item.soldRevenue, 0) * 100) / 100
    },
    items
  };
}

export async function getRecipe(menuItemId: number) {
  const recipes = await prisma.recipe.findMany({
    where: { menuItemId }
  });

  return {
    menuItemId,
    ingredients: recipes.map(r => ({ ingredientId: r.ingredientId, qty: r.qty }))
  };
}

export async function setRecipe(input: { menuItemId: number; ingredients: { ingredientId: number; qty: number }[] }) {
  // Delete existing
  await prisma.recipe.deleteMany({
    where: { menuItemId: input.menuItemId }
  });

  // Create new
  if (input.ingredients.length > 0) {
    await prisma.recipe.createMany({
      data: input.ingredients.map(i => ({
        menuItemId: input.menuItemId,
        ingredientId: i.ingredientId,
        qty: i.qty
      }))
    });
  }

  return getRecipe(input.menuItemId);
}
