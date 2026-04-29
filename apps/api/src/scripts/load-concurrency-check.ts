import prisma from "../prisma.js";
import { createOrder, updateOrderStatusWithContext } from "../store/orders.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const tag = `QA_LOAD_${Date.now()}`;
  const concurrency = Number(process.env.LOAD_CHECK_CONCURRENCY || 20);
  const stockUnits = Number(process.env.LOAD_CHECK_STOCK_UNITS || 30);
  const recipeQty = 3;
  const expectedSuccesses = Math.floor(stockUnits / recipeQty);
  const createdOrderIds: number[] = [];
  let branchId: number | null = null;
  let userId: number | null = null;
  let shiftId: number | null = null;
  let menuItemId: number | null = null;
  let ingredientId: number | null = null;
  const startedAt = Date.now();

  try {
    const branch = await prisma.branch.create({
      data: { name: `${tag}_branch`, location: "load-test", branchType: "coffee", active: true }
    });
    branchId = branch.id;

    const user = await prisma.user.create({
      data: { name: `${tag}_cashier`, pin: `${tag}_pin`, role: "cashier", active: true, branchId }
    });
    userId = user.id;

    const ingredient = await prisma.ingredient.create({
      data: { name: `${tag}_stock`, unit: "unit", costPerUnit: 1 }
    });
    ingredientId = ingredient.id;

    const menuItem = await prisma.menuItem.create({
      data: { sku: tag, name: `${tag}_item`, category: "กาแฟ", basePrice: 50, branchType: "coffee", active: true }
    });
    menuItemId = menuItem.id;

    await prisma.recipe.create({ data: { menuItemId, ingredientId, qty: recipeQty } });
    await prisma.ingredientStock.create({ data: { branchId, ingredientId, stockQty: stockUnits, reorderLevel: 5 } });
    const shift = await prisma.shift.create({ data: { branchId, userId, openingCash: 0, status: "OPEN" } });
    shiftId = shift.id;

    const requests = Array.from({ length: concurrency }, (_, index) => createOrder({
      branchId: branchId!,
      customerId: null,
      userId: userId!,
      shiftId: shiftId!,
      items: [{ menuItemId: menuItemId!, qty: 1, modifiers: [] }],
      paymentMethod: "CASH" as const,
      discountType: null,
      discountValue: 0,
      loyaltyPointsToUse: 0,
      paymentDetails: { cashReceived: 50 },
      idempotencyKey: `${tag}_${index}`
    }));

    const results = await Promise.allSettled(requests);
    const successes = results.filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    successes.forEach((result) => {
      if (result.value?.id) createdOrderIds.push(result.value.id);
    });

    assert(successes.length === expectedSuccesses, `Expected ${expectedSuccesses} successful orders, got ${successes.length}`);
    assert(failures.length === concurrency - expectedSuccesses, `Expected ${concurrency - expectedSuccesses} rejected orders, got ${failures.length}`);

    const stock = await prisma.ingredientStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId } }
    });
    assert(stock?.stockQty === stockUnits - expectedSuccesses * recipeQty, `Stock remainder mismatch: ${stock?.stockQty}`);
    assert((stock?.stockQty ?? 0) >= 0, "Stock went negative under load");

    const shiftAfter = await prisma.shift.findUnique({ where: { id: shiftId } });
    assert(shiftAfter?.totalOrders === expectedSuccesses, `Shift totalOrders mismatch: ${shiftAfter?.totalOrders}`);
    assert(shiftAfter?.totalSales === expectedSuccesses * 50, `Shift totalSales mismatch: ${shiftAfter?.totalSales}`);

    const uniqueIdempotencyKeys = await prisma.order.findMany({
      where: { id: { in: createdOrderIds } },
      select: { idempotencyKey: true }
    });
    assert(new Set(uniqueIdempotencyKeys.map((row) => row.idempotencyKey)).size === createdOrderIds.length, "Duplicate idempotency keys were persisted");

    const elapsedMs = Date.now() - startedAt;
    const p95ProxyMs = Math.ceil(elapsedMs / Math.max(1, successes.length));
    console.log("Load concurrency check passed");
    console.log(JSON.stringify({
      concurrency,
      stockUnits,
      expectedSuccesses,
      successes: successes.length,
      rejected: failures.length,
      elapsedMs,
      p95ProxyMs
    }, null, 2));

    for (const orderId of createdOrderIds) {
      await updateOrderStatusWithContext(orderId, { status: "CANCELLED", actorId: userId, reason: "load check cleanup" });
    }
  } finally {
    if (createdOrderIds.length) {
      await prisma.integrationOutbox.deleteMany({ where: { entityType: "order", entityId: { in: createdOrderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
      await prisma.stockMovement.deleteMany({
        where: { OR: createdOrderIds.flatMap((id) => [{ reason: `SALE-${id}` }, { reason: `REFUNDED-${id}` }, { reason: `CANCELLED-${id}` }]) }
      });
    }
    if (shiftId) await prisma.shift.deleteMany({ where: { id: shiftId } });
    if (menuItemId && ingredientId) await prisma.recipe.deleteMany({ where: { menuItemId, ingredientId } });
    if (branchId && ingredientId) await prisma.ingredientStock.deleteMany({ where: { branchId, ingredientId } });
    if (menuItemId) await prisma.menuItem.deleteMany({ where: { id: menuItemId } });
    if (ingredientId) await prisma.ingredient.deleteMany({ where: { id: ingredientId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (branchId) await prisma.branch.deleteMany({ where: { id: branchId } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
