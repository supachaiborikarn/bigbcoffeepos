import prisma from "../prisma.js";
import { getDailyCloseReport, getSalesSummary } from "../store/reports.js";
import { createOrder, getOrders, updateOrderStatusWithContext } from "../store/orders.js";
import { getShiftSummary } from "../store/shifts.js";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const tag = `QA_CHECK_${Date.now()}`;
  const createdOrderIds: number[] = [];
  let branchId: number | null = null;
  let otherBranchId: number | null = null;
  let userId: number | null = null;
  let menuItemId: number | null = null;
  let ingredientId: number | null = null;
  let cupIngredientId: number | null = null;
  let lidIngredientId: number | null = null;
  let createdCupIngredientId: number | null = null;
  let customerId: number | null = null;
  let shiftId: number | null = null;

  try {
    const branch = await prisma.branch.create({
      data: { name: `${tag}_branch`, location: "integration", branchType: "coffee", active: true }
    });
    branchId = branch.id;
    const otherBranch = await prisma.branch.create({
      data: { name: `${tag}_other_branch`, location: "integration", branchType: "coffee", active: true }
    });
    otherBranchId = otherBranch.id;

    const user = await prisma.user.create({
      data: { name: `${tag}_user`, pin: `${tag}_pin`, role: "admin", active: true, branchId }
    });
    userId = user.id;

    const customer = await prisma.customer.create({
      data: { name: `${tag}_customer`, phone: `${Date.now()}`, points: 5 }
    });
    customerId = customer.id;

    const ingredient = await prisma.ingredient.create({
      data: { name: `${tag}_bean`, unit: "g", costPerUnit: 1 }
    });
    ingredientId = ingredient.id;

    const menuItem = await prisma.menuItem.create({
      data: { sku: tag, name: `${tag}_latte`, category: "กาแฟ", basePrice: 50, branchType: "coffee", active: true }
    });
    menuItemId = menuItem.id;

    await prisma.recipe.create({ data: { menuItemId, ingredientId, qty: 2 } });
    await prisma.ingredientStock.create({ data: { branchId, ingredientId, stockQty: 10, reorderLevel: 2 } });
    const existingCup = await prisma.ingredient.findFirst({ where: { name: "แก้วพลาสติก 16oz" }, select: { id: true } });
    if (existingCup) {
      cupIngredientId = existingCup.id;
    } else {
      const cup = await prisma.ingredient.create({ data: { name: "แก้วพลาสติก 16oz", unit: "ใบ", costPerUnit: 1 } });
      cupIngredientId = cup.id;
      createdCupIngredientId = cup.id;
    }
    await prisma.ingredientStock.upsert({
      where: { branchId_ingredientId: { branchId, ingredientId: cupIngredientId } },
      update: { stockQty: 5, reorderLevel: 1 },
      create: { branchId, ingredientId: cupIngredientId, stockQty: 5, reorderLevel: 1 }
    });
    const lidIngredient = await prisma.ingredient.create({
      data: { name: `${tag}_lid`, unit: "ชิ้น", costPerUnit: 0.5 }
    });
    lidIngredientId = lidIngredient.id;
    await prisma.ingredientStock.create({
      data: { branchId, ingredientId: lidIngredientId, stockQty: 0, reorderLevel: 1 }
    });
    await prisma.cupStockSetting.create({
      data: {
        branchId,
        cupOption: "แก้วเย็น",
        deductStock: true,
        items: {
          create: [
            { ingredientId: cupIngredientId, qty: 1 },
            { ingredientId: lidIngredientId, qty: 1 }
          ]
        }
      }
    });

    const shift = await prisma.shift.create({
      data: { branchId, userId, status: "OPEN", openingCash: 0 }
    });
    shiftId = shift.id;

    let insufficientPaymentFailed = false;
    try {
      await createOrder({
        branchId,
        customerId: null,
        userId,
        shiftId,
        items: [{ menuItemId, qty: 1, modifiers: [] }],
        paymentMethod: "CASH",
        discountType: null,
        discountValue: 0,
        loyaltyPointsToUse: 0,
        paymentDetails: { cashReceived: 10 },
        idempotencyKey: `${tag}_insufficient`
      });
    } catch (error) {
      insufficientPaymentFailed = String((error as Error).message).includes("ยอดรับเงินสดไม่พอ");
    }
    assert(insufficientPaymentFailed, "Insufficient cash payment was accepted");

    const order = await createOrder({
      branchId,
      customerId,
      userId,
      shiftId,
      items: [{ menuItemId, qty: 1, modifiers: [{ name: "Cup", value: "แก้วเย็น", price: 0 }] }],
      paymentMethod: "CASH",
      discountType: null,
      discountValue: 0,
      loyaltyPointsToUse: 2,
      paymentDetails: { cashReceived: 60, referenceNo: tag },
      idempotencyKey: `${tag}_order`
    });
    assert(order?.id, "Order was not created");
    createdOrderIds.push(order.id);

    const duplicate = await createOrder({
      branchId,
      customerId,
      userId,
      shiftId,
      items: [{ menuItemId, qty: 1, modifiers: [] }],
      paymentMethod: "CASH",
      discountType: null,
      discountValue: 0,
      loyaltyPointsToUse: 2,
      paymentDetails: { cashReceived: 60, referenceNo: tag },
      idempotencyKey: `${tag}_order`
    });
    assert(duplicate?.id === order.id, "Idempotency key created a duplicate order");

    const stockAfterSale = await prisma.ingredientStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId } }
    });
    assert(stockAfterSale?.stockQty === 8, `Stock decrement mismatch: ${stockAfterSale?.stockQty}`);
    const cupStockAfterSale = await prisma.ingredientStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId: cupIngredientId! } }
    });
    assert(cupStockAfterSale?.stockQty === 4, `Cup stock decrement mismatch: ${cupStockAfterSale?.stockQty}`);
    const lidStockAfterSale = await prisma.ingredientStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId: lidIngredientId! } }
    });
    assert(lidStockAfterSale?.stockQty === -1, `Cup setting should allow negative lid stock: ${lidStockAfterSale?.stockQty}`);

    const payment = await prisma.payment.findFirst({ where: { orderId: order.id } });
    assert(payment?.amountReceived === 60 && payment.referenceNo === tag, "Payment evidence was not persisted");

    await updateOrderStatusWithContext(order.id, { status: "REFUNDED", actorId: userId, reason: "integration check" });
    const stockAfterRefund = await prisma.ingredientStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId } }
    });
    assert(stockAfterRefund?.stockQty === 10, `Refund did not restore stock: ${stockAfterRefund?.stockQty}`);
    const cupStockAfterRefund = await prisma.ingredientStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId: cupIngredientId! } }
    });
    assert(cupStockAfterRefund?.stockQty === 5, `Refund did not restore cup stock: ${cupStockAfterRefund?.stockQty}`);
    const lidStockAfterRefund = await prisma.ingredientStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId: lidIngredientId! } }
    });
    assert(lidStockAfterRefund?.stockQty === 0, `Refund did not restore configured cup stock: ${lidStockAfterRefund?.stockQty}`);

    const refundEvent = await prisma.orderEvent.findFirst({ where: { orderId: order.id, eventType: "ORDER_REFUNDED" } });
    assert(refundEvent?.reason === "integration check", "Refund event history missing");

    await prisma.ingredientStock.update({
      where: { branchId_ingredientId: { branchId, ingredientId } },
      data: { stockQty: 6 }
    });

    const raceInputs = [1, 2].map((index) => createOrder({
      branchId: branchId!,
      customerId: null,
      userId: userId!,
      shiftId: shiftId!,
      items: [{ menuItemId: menuItemId!, qty: 2, modifiers: [] }],
      paymentMethod: "CASH" as const,
      discountType: null,
      discountValue: 0,
      loyaltyPointsToUse: 0,
      paymentDetails: { cashReceived: 100 },
      idempotencyKey: `${tag}_race_${index}`
    }));
    const raceResults = await Promise.allSettled(raceInputs);
    const raceSuccesses = raceResults.filter((result) => result.status === "fulfilled");
    const raceFailures = raceResults.filter((result) => result.status === "rejected");
    raceSuccesses.forEach((result) => {
      if (result.status === "fulfilled" && result.value?.id) createdOrderIds.push(result.value.id);
    });
    assert(raceSuccesses.length === 1 && raceFailures.length === 1, "Concurrent stock guard did not allow exactly one sale");

    const stockAfterRace = await prisma.ingredientStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId } }
    });
    assert(stockAfterRace?.stockQty === 2, `Concurrent stock remainder mismatch: ${stockAfterRace?.stockQty}`);

    const branchOrders = await getOrders(branchId);
    const otherBranchOrders = await getOrders(otherBranchId);
    assert(branchOrders.some((item) => createdOrderIds.includes(item.id)), "Branch order list did not include test order");
    assert(!otherBranchOrders.some((item) => createdOrderIds.includes(item.id)), "Branch isolation leaked test order");

    const summary = await getSalesSummary({ branchId, source: "system" });
    assert(summary.totalOrders === 1, `Report should exclude refunded order and include one paid order, got ${summary.totalOrders}`);
    assert(summary.totalRevenue === 100, `Report revenue mismatch: ${summary.totalRevenue}`);

    const shiftSummary = await getShiftSummary(shiftId!);
    assert(shiftSummary?.totals.totalOrders === 1, `Shift summary should exclude refunded order, got ${shiftSummary?.totals.totalOrders}`);
    assert(shiftSummary?.totals.totalSales === 100, `Shift summary revenue should be 100, got ${shiftSummary?.totals.totalSales}`);

    const todayBangkok = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const dayClose = await getDailyCloseReport({ date: todayBangkok, branchId, source: "system" });
    assert(dayClose.totals.totalOrders === 1, `Daily close should exclude refunded order, got ${dayClose.totals.totalOrders}`);
    assert(dayClose.totals.totalRevenue === 100, `Daily close revenue mismatch: ${dayClose.totals.totalRevenue}`);
    const dayShift = dayClose.shifts.find((item) => item.id === shiftId);
    assert(dayShift?.totalOrders === 1, `Daily close shift summary should exclude refunded order, got ${dayShift?.totalOrders}`);
    assert(dayShift?.totalSales === 100, `Daily close shift revenue mismatch: ${dayShift?.totalSales}`);

    console.log("Checkout integration checks passed");
    console.log(`Created/refunded order: #${order.id}`);
    console.log(`Race results: ${raceSuccesses.length} success, ${raceFailures.length} rejected`);
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
    if (branchId) await prisma.cupStockSetting.deleteMany({ where: { branchId } });
    if (branchId) await prisma.ingredientStock.deleteMany({ where: { branchId, ingredientId: { in: [ingredientId, cupIngredientId, lidIngredientId].filter((id): id is number => Boolean(id)) } } });
    if (menuItemId) await prisma.menuItem.deleteMany({ where: { id: menuItemId } });
    if (createdCupIngredientId) await prisma.ingredient.deleteMany({ where: { id: createdCupIngredientId } });
    if (lidIngredientId) await prisma.ingredient.deleteMany({ where: { id: lidIngredientId } });
    if (ingredientId) await prisma.ingredient.deleteMany({ where: { id: ingredientId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (otherBranchId) await prisma.branch.deleteMany({ where: { id: otherBranchId } });
    if (branchId) await prisma.branch.deleteMany({ where: { id: branchId } });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
