import prisma from "../prisma.js";

interface PurchaseItemInput {
  ingredientId: number;
  qty: number;
  unitCost: number;
}

export async function createPurchase(branchId: number, supplier: string, note: string, items: PurchaseItemInput[]) {
  const totalCost = items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);

  // Prisma transaction
  const purchase = await prisma.$transaction(async (tx) => {
    // 1. Create Purchase and PurchaseItems
    const po = await tx.purchase.create({
      data: {
        branchId,
        supplier,
        note,
        total: totalCost,
        status: "RECEIVED",
        items: {
          create: items.map(item => ({
            ingredientId: item.ingredientId,
            qty: item.qty,
            unitCost: item.unitCost,
            lineTotal: item.qty * item.unitCost
          }))
        }
      }
    });

    // 2. Update stock & create stock movements
    for (const item of items) {
      // Upsert stock
      await tx.ingredientStock.upsert({
        where: {
          branchId_ingredientId: {
            branchId,
            ingredientId: item.ingredientId
          }
        },
        update: {
          stockQty: { increment: item.qty }
        },
        create: {
          branchId,
          ingredientId: item.ingredientId,
          stockQty: item.qty,
          reorderLevel: 5 // Default
        }
      });

      // Record movement
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: item.ingredientId,
          qty: item.qty,
          reason: `PO#${po.id}`
        }
      });
    }

    return po;
  });

  return getPurchase(purchase.id);
}

export async function getPurchase(id: number) {
  const po = await prisma.purchase.findUnique({
    where: { id },
    include: {
      items: true
    }
  });
  
  if (!po) return null;

  // We need to fetch ingredient names to match the old shape if possible,
  // but since we don't have relation from PurchaseItem -> Ingredient in schema currently,
  // let's fetch them manually or map them if needed. 
  // Wait, I didn't add relation in Prisma schema for PurchaseItem -> Ingredient?
  // Let's check: ingredientId is Int?, but no relation to Ingredient. 
  // I will just fetch ingredients to get the name and unit.
  
  const ingredientIds = po.items.map(i => i.ingredientId).filter(Boolean) as number[];
  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ingredientIds } }
  });
  const ingMap = new Map(ingredients.map(i => [i.id, i]));

  return {
    id: po.id,
    branchId: po.branchId,
    supplier: po.supplier,
    note: po.note,
    totalCost: po.total,
    status: po.status,
    receivedAt: po.createdAt.toISOString(),
    createdAt: po.createdAt.toISOString(),
    items: po.items.map(pi => {
      const ing = pi.ingredientId ? ingMap.get(pi.ingredientId) : null;
      return {
        id: pi.id,
        ingredientId: pi.ingredientId,
        ingredientName: ing ? ing.name : "Unknown",
        unit: ing ? ing.unit : "-",
        qty: pi.qty,
        unitCost: pi.unitCost,
        lineTotal: pi.lineTotal
      };
    })
  };
}

export async function getPurchases(branchId?: number) {
  const pos = await prisma.purchase.findMany({
    where: branchId ? { branchId } : undefined,
    include: {
      branch: true,
      _count: {
        select: { items: true }
      }
    },
    orderBy: { id: "desc" },
    take: 50
  });

  return pos.map(po => ({
    id: po.id,
    branchId: po.branchId,
    branchName: po.branch.name,
    supplier: po.supplier,
    note: po.note,
    totalCost: po.total,
    status: po.status,
    receivedAt: po.createdAt.toISOString(),
    createdAt: po.createdAt.toISOString(),
    itemCount: po._count.items
  }));
}
