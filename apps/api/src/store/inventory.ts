import prisma from "../prisma.js";

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

export async function getRecipe(menuItemId: number) {
  const recipes = await prisma.recipe.findMany({
    where: { menuItemId }
  });
  if (recipes.length === 0) return null;

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
