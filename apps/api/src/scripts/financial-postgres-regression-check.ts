import assert from "node:assert/strict";
import prisma from "../prisma.js";
import { createOrder, updateOrderStatusWithContext } from "../store/orders.js";
import { getCurrentShift, getShiftSummary } from "../store/shifts.js";
import { addCashEntry, ensureCashDrawerTable } from "../store/cashDrawer.js";
import { updateStoreSetting } from "../store/settings.js";
import { signDiscountApproval, verifyDiscountApproval } from "../middleware/auth.js";

// This check creates data, and is deliberately restricted to the disposable local QA database.
const target = new URL(process.env.DATABASE_URL ?? "invalid:");
assert.ok(["127.0.0.1", "localhost"].includes(target.hostname) && target.pathname === "/benzpos_qa", "Use only the disposable local benzpos_qa database; never load the production .env");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const tag = `FINANCIAL_QA_${Date.now()}`;
  let branchId: number | undefined, menuId: number | undefined, promoId: number | undefined, couponId: number | undefined;
  try {
    const branch = await prisma.branch.create({ data: { name: tag, branchType: "coffee" } }); branchId = branch.id;
    const menu = await prisma.menuItem.create({ data: { name: tag, category: tag, basePrice: 100, branchType: "coffee" } }); menuId = menu.id;
    await updateStoreSetting(branch.id, { vatMode: "NONE", vatRate: 0, paymentMethods: ["CASH"], allowNegativeStock: true });
    const shift = await prisma.shift.create({ data: { branchId: branch.id, openingCash: 100 } });
    const promotion = await prisma.promotion.create({ data: { name: tag, type: "CATEGORY_PERCENT", category: tag, value: 60, active: true } }); promoId = promotion.id;
    const coupon = await prisma.coupon.create({ data: { code: tag, type: "PERCENT", value: 30, active: true } }); couponId = coupon.id;
    const input = { branchId: branch.id, customerId: null, shiftId: shift.id, items: [{ menuItemId: menu.id, qty: 1, modifiers: [] }], paymentMethod: "CASH" as const, paymentDetails: { cashReceived: 100 }, discountType: null, discountValue: 0, loyaltyPointsToUse: 0 };
    const manual = await createOrder({ ...input, idempotencyKey: `${tag}_manual`, discounts: [{ type: "ORDER_PERCENT", value: 40 }], couponCode: coupon.code });
    assert.equal(manual.total, 60, "manual40 replaces auto60 and coupon30 instead of making total0");
    assert.equal((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount, 0, "unused coupon must not consume its usage");
    const couponOrder = await createOrder({ ...input, idempotencyKey: `${tag}_coupon`, couponCode: coupon.code }); assert.equal(couponOrder.total, 70);
    const auto = await createOrder({ ...input, idempotencyKey: `${tag}_auto` }); assert.equal(auto.total, 40);
    console.log("PASS PostgreSQL checkout manual/coupon/auto each use one source");

    await Promise.all([updateOrderStatusWithContext(manual.id, { status: "CANCELLED" }), updateOrderStatusWithContext(manual.id, { status: "CANCELLED" })]);
    assert.equal(await prisma.orderEvent.count({ where: { orderId: manual.id, eventType: "ORDER_CANCELLED" } }), 1);
    assert.equal((await getCurrentShift(branch.id))?.totalSales, 110);
    console.log("PASS PostgreSQL duplicate reversal records one event and one deduction");

    // Hold the shift to force cancellation and READY to overlap; the new cancellation
    // waits before claiming the order, leaving READY free to finish before cancellation.
    let release!: () => void, announce!: () => void;
    const held = new Promise<void>((resolve) => { announce = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM shifts WHERE id = ${shift.id} FOR UPDATE`; announce(); await gate; }, { timeout: 10_000 });
    await held;
    const cancelling = updateOrderStatusWithContext(couponOrder.id, { status: "CANCELLED" });
    let waiting = false;
    for (let attempt = 0; attempt < 30 && !waiting; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%shifts%'`;
      waiting = Number(rows[0]?.count) > 0;
      if (!waiting) await pause(20);
    }
    try {
      assert.ok(waiting, "cancellation should wait on the held shift lock");
      await Promise.race([updateOrderStatusWithContext(couponOrder.id, { status: "READY" }), pause(1_000).then(() => { throw new Error("READY blocked behind a cancellation that prematurely claimed its order"); })]);
    } finally { release(); await holder; }
    await cancelling;
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: couponOrder.id } })).status, "CANCELLED");
    await assert.rejects(updateOrderStatusWithContext(couponOrder.id, { status: "READY" }), /ถูกยกเลิก/);
    assert.equal((await getCurrentShift(branch.id))?.totalSales, 40);
    console.log("PASS PostgreSQL overlapping READY/cancel leaves reversed order closed");

    await updateOrderStatusWithContext(auto.id, { status: "CANCELLED" });
    await prisma.shift.update({ where: { id: shift.id }, data: { totalSales: -65, totalOrders: -1, cashSales: -65 } });
    assert.equal((await getCurrentShift(branch.id))?.totalSales, 0);
    assert.equal((await getCurrentShift(branch.id))?.totalOrders, 0);
    const newSale = await createOrder({ ...input, skipPromotions: true, idempotencyKey: `${tag}_new` }); assert.equal(newSale.total, 100);
    const current = await getCurrentShift(branch.id), summary = await getShiftSummary(shift.id);
    assert.equal(current?.totalSales, 100); assert.equal(current?.totalOrders, 1); assert.equal(summary?.totals.totalSales, 100);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).totalSales, 100);
    console.log("PASS PostgreSQL a new sale repairs old damaged cached totals");

    const drawerShift = await prisma.shift.create({ data: { branchId: branch.id, openingCash: 100 } });
    await ensureCashDrawerTable();
    const payouts = await Promise.allSettled([addCashEntry({ shiftId: drawerShift.id, type: "OUT", amount: 80, category: "QA" }), addCashEntry({ shiftId: drawerShift.id, type: "OUT", amount: 80, category: "QA" })]);
    assert.equal(payouts.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal((await getShiftSummary(drawerShift.id))?.cash.expectedCash, 20);
    console.log("PASS PostgreSQL concurrent payouts keep 20 of an opening 100");

    const approvalDraft = { ...input, shiftId: drawerShift.id, idempotencyKey: `${tag}_approved`, discountType: "PERCENT" as const, discountValue: 60 };
    await assert.rejects(createOrder({ ...approvalDraft, canApproveDiscount: false }), /DISCOUNT_APPROVAL_REQUIRED/);
    const token = signDiscountApproval({ id: 99, name: tag }, branch.id, approvalDraft);
    const approver = verifyDiscountApproval(token, branch.id, approvalDraft); assert.ok(approver);
    const approved = await createOrder({ ...approvalDraft, canApproveDiscount: Boolean(approver) }); assert.equal(approved.total, 40);
    const changedDraft = { ...approvalDraft, idempotencyKey: `${tag}_replayed`, discountValue: 100 };
    assert.equal(verifyDiscountApproval(token, branch.id, changedDraft), null);
    await assert.rejects(createOrder({ ...changedDraft, canApproveDiscount: Boolean(verifyDiscountApproval(token, branch.id, changedDraft)) }), /DISCOUNT_APPROVAL_REQUIRED/);
    assert.equal(await prisma.order.count({ where: { idempotencyKey: changedDraft.idempotencyKey } }), 0);
    console.log("PASS PostgreSQL cashier approval accepts its signed bill and rejects changed/replayed discounts");
  } finally {
    await pause(30); // allow the checkout's queued outbox writes to finish before removing fixtures
    if (branchId) {
      const orders = await prisma.order.findMany({ where: { branchId }, select: { id: true } }); const ids = orders.map((order) => order.id);
      await prisma.integrationOutbox.deleteMany({ where: { entityType: "order", entityId: { in: ids } } });
      await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: ids } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
      await prisma.order.deleteMany({ where: { branchId } });
      await prisma.shift.deleteMany({ where: { branchId } });
      await prisma.storeSetting.deleteMany({ where: { branchId } });
      await prisma.branch.delete({ where: { id: branchId } });
    }
    if (couponId) await prisma.coupon.delete({ where: { id: couponId } });
    if (promoId) await prisma.promotion.delete({ where: { id: promoId } });
    if (menuId) await prisma.menuItem.delete({ where: { id: menuId } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
