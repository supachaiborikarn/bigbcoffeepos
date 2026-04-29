import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";

const SALES_ONLY_ITEM_NAME = "POSPOS sales-only record";

export async function getIngredients() {
  return prisma.ingredient.findMany({
    orderBy: { id: "asc" }
  });
}

export async function addIngredient(input: {
  name: string;
  unit: string;
  costPerUnit: number;
  stockQty: number;
  reorderLevel: number;
  branchId: number;
}) {
  const ingredient = await prisma.ingredient.create({
    data: {
      name: input.name,
      unit: input.unit,
      costPerUnit: input.costPerUnit
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
  input: Partial<{ name: string; unit: string; costPerUnit: number }>
) {
  const hasUpdates = input.name !== undefined || input.unit !== undefined || input.costPerUnit !== undefined;
  if (!hasUpdates) return null;

  try {
    const updated = await prisma.ingredient.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.costPerUnit !== undefined ? { costPerUnit: input.costPerUnit } : {})
      }
    });
    return updated;
  } catch {
    return null;
  }
}

export async function getInventoryItems(branchId: number) {
  const ingredients = await prisma.ingredient.findMany({
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
    input.costPerUnit !== undefined;
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
          ...(input.costPerUnit !== undefined ? { costPerUnit: input.costPerUnit } : {})
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

export async function adjustStock(input: { branchId: number; ingredientId: number; qty: number; reason: string }) {
  // Upsert stock record
  const stock = await prisma.ingredientStock.upsert({
    where: {
      branchId_ingredientId: {
        branchId: input.branchId,
        ingredientId: input.ingredientId
      }
    },
    update: {
      stockQty: { increment: input.qty }
    },
    create: {
      branchId: input.branchId,
      ingredientId: input.ingredientId,
      stockQty: input.qty,
      reorderLevel: 0
    }
  });

  // Create movement
  const movement = await prisma.stockMovement.create({
    data: {
      branchId: input.branchId,
      ingredientId: input.ingredientId,
      qty: input.qty,
      reason: input.reason
    }
  });

  return { stock, movement };
}

export async function getStockMovements(branchId?: number) {
  return prisma.stockMovement.findMany({
    where: branchId ? { branchId } : undefined,
    orderBy: { id: "desc" }
  });
}

export async function getRecipes() {
  const recipes = await prisma.recipe.findMany({
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
