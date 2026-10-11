import assert from "node:assert/strict";
import prisma from "../prisma.js";
import { getInventoryItems, updateInventoryItem } from "../store/inventory.js";

const target = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (!["127.0.0.1", "localhost"].includes(target.hostname) || !target.pathname.startsWith("/benzpos_qa")) {
  throw new Error("Inventory regression checks require the disposable local benzpos_qa database");
}

async function main() {
  const tag = `QA_INVENTORY_${Date.now()}`;
  const branchIds: number[] = [], ingredientIds: number[] = [], menuIds: number[] = [];
  try {
    const branches = await Promise.all(["coffee", "coffee", "oil_service"].map((branchType, i) => prisma.branch.create({ data: { name: `${tag}_branch_${i}`, branchType } })));
    branchIds.push(...branches.map(b => b.id));
    const ingredients = await Promise.all(["zero", "missing_branch_row", "recipe_only", "other_business", "unassigned"].map(name => prisma.ingredient.create({ data: { name: `${tag}_${name}`, unit: "ขวด" } })));
    ingredientIds.push(...ingredients.map(i => i.id));
    await prisma.ingredientStock.createMany({ data: [
      { branchId: branches[0].id, ingredientId: ingredients[0].id, stockQty: 0 },
      { branchId: branches[1].id, ingredientId: ingredients[1].id, stockQty: 10 },
      { branchId: branches[2].id, ingredientId: ingredients[3].id, stockQty: 5 }
    ] });
    const menu = await prisma.menuItem.create({ data: { name: `${tag}_menu`, branchType: "coffee", basePrice: 50 } });
    menuIds.push(menu.id);
    await prisma.recipe.create({ data: { menuItemId: menu.id, ingredientId: ingredients[2].id, qty: 1 } });
    const inventory = await getInventoryItems(branches[0].id);
    for (const index of [0, 1, 2, 4]) {
      const row = inventory.find(item => item.ingredientId === ingredients[index].id);
      assert.ok(row, `${ingredients[index].name} should be visible at zero`);
      assert.equal(row.stockQty, 0, "another branch's balance must not leak into this branch");
    }
    assert.ok(!inventory.some(item => item.ingredientId === ingredients[3].id), "unrelated oil stock must stay outside the coffee branch");
    assert.equal(await prisma.ingredientStock.count({ where: { branchId: branches[0].id } }), 1, "listing must not create stock rows");
    const counted = await updateInventoryItem({ branchId: branches[0].id, ingredientId: ingredients[1].id, stockQty: 3 });
    assert.equal(counted?.stockQty, 3, "zero stock without a row must be editable through normal counting");
    const other = await prisma.ingredientStock.findUniqueOrThrow({ where: { branchId_ingredientId: { branchId: branches[1].id, ingredientId: ingredients[1].id } } });
    assert.equal(other.stockQty, 10);
    console.log("PASS inventory regressions: existing zero, missing branch stock, recipe-linked stock, business isolation, count/upsert, no writes on read");
  } finally {
    await prisma.stockMovement.deleteMany({ where: { ingredientId: { in: ingredientIds } } });
    await prisma.recipe.deleteMany({ where: { menuItemId: { in: menuIds } } });
    await prisma.ingredientStock.deleteMany({ where: { ingredientId: { in: ingredientIds } } });
    await prisma.menuItem.deleteMany({ where: { id: { in: menuIds } } });
    await prisma.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
    await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
