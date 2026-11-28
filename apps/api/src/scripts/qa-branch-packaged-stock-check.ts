import assert from "node:assert/strict";
import prisma from "../prisma.js";
import { createOrder, updateOrderStatusWithContext } from "../store/orders.js";

const target = new URL(process.env.DATABASE_URL ?? "invalid:");
assert(process.env.QA_DISPOSABLE_DB === "true" && target.protocol === "postgresql:" &&
  target.hostname === "127.0.0.1" && target.pathname === "/benzpos_qa_packaged",
  "Run only against a new disposable local QA database");

const products = [
  [1212, 1147], [1213, 1573], [1220, 1567], [1231, 1001], [1232, 947], [1233, 1582],
  [1236, 1596], [1242, 1591], [1243, 1380], [1244, 1270], [1250, 988], [1251, 1590]
] as const;
const m150 = { menuItemId: 1251, qty: 2, modifiers: [] };
const checkOut = (branchId: number, items: Parameters<typeof createOrder>[0]["items"], idempotencyKey: string) =>
  createOrder({ branchId, items, idempotencyKey, customerId: null, paymentMethod: "CASH", discountType: null,
    discountValue: 0, loyaltyPointsToUse: 0, paymentDetails: { cashReceived: 500 }, skipPromotions: true });
const qty = async (branchId: number, ingredientId: number) => (await prisma.ingredientStock.findUnique({
  where: { branchId_ingredientId: { branchId, ingredientId } }
}))?.stockQty;
const movements = (branchId: number, reason: string) =>
  prisma.stockMovement.findMany({ where: { branchId, reason }, orderBy: { ingredientId: "asc" } });

try {
  assert.equal(await prisma.branch.count(), 0, "Fresh test database required");
  await prisma.branch.createMany({ data: [
    { id: 1, name: "QA Watcharakiat", branchType: "coffee" },
    { id: 2, name: "QA other shop", branchType: "coffee" }
  ] });
  await prisma.menuItem.createMany({ data: products.map(([id]) =>
    ({ id, name: `QA menu ${id}`, category: "เครื่องดื่มพร้อมขาย", basePrice: 10, branchType: "coffee" })) });
  await prisma.ingredient.createMany({ data: products.map(([,id]) => ({ id, name: `QA stock ${id}` })) });
  await prisma.ingredientStock.createMany({ data: products.map(([,ingredientId]) => ({ branchId: 1, ingredientId, stockQty: 5 })) });

  const beforeFix = await prisma.order.create({ data: {
    branchId: 1, status: "PAID", subtotal: 10, total: 10,
    items: { create: [{ menuItemId: 1251, name: "QA old M-150", qty: 1, basePrice: 10, lineTotal: 10 }] }
  } });
  await updateOrderStatusWithContext(beforeFix.id, { status: "CANCELLED", reason: "QA legacy bill" });
  assert.equal(await qty(1, 1590), 5);
  assert.equal((await movements(1, `CANCELLED-${beforeFix.id}`)).length, 0);

  const basket = products.map(([menuItemId]) => ({ menuItemId, qty: 2, modifiers: [] }));
  const sale = await checkOut(1, basket, "qa-branch-sale");
  assert(sale?.id);
  assert.equal((await checkOut(1, basket, "qa-branch-sale"))?.id, sale.id);
  const saleMovements = await movements(1, `SALE-${sale.id}`);
  assert.equal(saleMovements.length, products.length);
  for (const [,ingredientId] of products) {
    assert.equal(await qty(1, ingredientId), 3);
    assert.equal(saleMovements.find(row => row.ingredientId === ingredientId)?.qty, -2);
  }

  const other = await checkOut(2, basket, "qa-other-sale");
  assert(other?.id, "Another shop without stock entries must still be able to sell");
  assert.equal((await movements(2, `SALE-${other.id}`)).length, 0);
  assert.equal(await qty(2, 1590), undefined);

  await updateOrderStatusWithContext(sale.id, { status: "REFUNDED", reason: "QA reversal" });
  await updateOrderStatusWithContext(sale.id, { status: "REFUNDED", reason: "QA retry" });
  assert.equal((await movements(1, `REFUNDED-${sale.id}`)).length, products.length);
  for (const [,ingredientId] of products) assert.equal(await qty(1, ingredientId), 5);

  await assert.rejects(() => checkOut(1, [{ ...m150, qty: 6 }], "qa-over-stock"), /สต็อกไม่พอ/);
  assert.equal(await qty(1, 1590), 5);
  assert.equal(await prisma.order.count({ where: { idempotencyKey: "qa-over-stock" } }), 0);

  await prisma.recipe.create({ data: { menuItemId: 1251, ingredientId: 1590, qty: 1 } });
  const recipeSale = await checkOut(1, [m150], "qa-recipe-wins");
  assert(recipeSale?.id);
  assert.equal(await qty(1, 1590), 3);
  assert.equal((await movements(1, `SALE-${recipeSale.id}`))[0]?.qty, -2);

  console.log("PASS: 12 SKU deductions, unchanged other branch without stock, no legacy restore, idempotent checkout/refund, strict-stock rollback, explicit recipe precedence.");
} finally {
  await prisma.$disconnect();
}
