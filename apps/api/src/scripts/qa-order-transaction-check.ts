import assert from 'node:assert/strict';
import prisma from '../prisma.js';
import { createOrder, updateOrderStatusWithContext } from '../store/orders.js';
import { publicError } from '../lib/publicError.js';

const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55433' && url.pathname === '/benzpos_qa' && process.env.QA_DISPOSABLE_DB === 'true', 'Use only an explicit disposable localhost:55433/benzpos_qa database');
const tag = `QA_ORDER_TIMEOUT_${Date.now()}`;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const originalTransaction = prisma.$transaction.bind(prisma);
let delay = 0;
let queryCount = 0;
let attempts = 0;
(prisma as any).$transaction = (callback: any, options?: any) => {
  if (typeof callback !== 'function') return originalTransaction(callback, options);
  attempts++;
  return originalTransaction((tx: any) => callback(new Proxy(tx, { get(target, prop) {
    const value = Reflect.get(target, prop, target);
    if (typeof value === 'function') return async (...args: any[]) => { queryCount++; if (delay) await pause(delay); return value.apply(target, args); };
    if (value && typeof value === 'object' && !String(prop).startsWith('$')) return new Proxy(value, { get(delegate, method) {
      const fn = Reflect.get(delegate, method, delegate);
      return typeof fn === 'function' ? async (...args: any[]) => { queryCount++; if (delay) await pause(delay); return fn.apply(delegate, args); } : fn;
    }});
    return value;
  }})), options);
};
let branchId: number | undefined;
let menuIds: number[] = [];
let ingredientIds: number[] = [];
async function main() {
try {
  const branch = await prisma.branch.create({ data: { name: tag, branchType: 'coffee' } }); branchId = branch.id;
  await prisma.storeSetting.create({ data: { branchId, vatMode: 'NONE', allowNegativeStock: true } });
  const shift = await prisma.shift.create({ data: { branchId } });
  for (const price of [47, 47, 47, 47, 13]) {
    const menu = await prisma.menuItem.create({ data: { name: `${tag}_${price}_${menuIds.length}`, branchType: 'coffee', category: 'grocery', basePrice: price } }); menuIds.push(menu.id);
    const ingredient = await prisma.ingredient.create({ data: { name: `${tag}_${menu.id}`, unit: 'pcs' } }); ingredientIds.push(ingredient.id);
    await prisma.recipe.create({ data: { menuItemId: menu.id, ingredientId: ingredient.id, qty: 1 } });
    await prisma.ingredientStock.create({ data: { branchId, ingredientId: ingredient.id, stockQty: 100 } });
  }
  const base = { branchId, shiftId: shift.id, customerId: null, discountType: null, discountValue: 0, loyaltyPointsToUse: 0, paymentMethod: 'CASH' as const, skipPromotions: true, paymentDetails: { cashReceived: 200 } };
  const items = menuIds.slice(0, 4).map(menuItemId => ({ menuItemId, qty: 1, modifiers: [] }));
  queryCount = 0; attempts = 0;
  const started = Date.now();
  const baseline = await createOrder({ ...base, items, idempotencyKey: `${tag}_baseline` });
  assert.equal(baseline.total, 188);
  console.log(JSON.stringify({ experiment: '188-four-item-no-latency', status: 'saved', elapsedMs: Date.now() - started, queryCount, attempts }));
  const pepsi = await createOrder({ ...base, items: [{ menuItemId: menuIds[4], qty: 1, modifiers: [] }], idempotencyKey: `${tag}_pepsi` });
  assert.equal(pepsi.total, 13);
  delay = 300; queryCount = 0; attempts = 0;
  const slowStarted = Date.now();
  let slowFailure: any;
  try { await createOrder({ ...base, items, idempotencyKey: `${tag}_slow` }); } catch (error: any) { slowFailure = error; }
  console.log(JSON.stringify({ experiment: '188-four-item-300ms-per-db-query', status: slowFailure ? 'rejected' : 'saved', elapsedMs: Date.now() - slowStarted, code: slowFailure?.code, message: slowFailure?.message, queryCount, attempts, savedOrders: await prisma.order.count({ where: { idempotencyKey: `${tag}_slow` } }) }));
  assert.equal(slowFailure, undefined, 'Normal cross-region query latency must fit the checkout transaction');
  assert.equal(attempts, 1);
  assert.equal(await prisma.order.count({ where: { idempotencyKey: `${tag}_slow` } }), 1);
  delay = 350; queryCount = 0; attempts = 0;
  const cancelStarted = Date.now();
  let cancelFailure: any;
  try { await updateOrderStatusWithContext(pepsi.id, { status: 'CANCELLED' }); } catch (error: any) { cancelFailure = error; }
  console.log(JSON.stringify({ experiment: '13-one-item-cancel-350ms-per-db-query', status: cancelFailure ? 'rejected' : 'cancelled', elapsedMs: Date.now() - cancelStarted, code: cancelFailure?.code, message: cancelFailure?.message, queryCount, attempts, persistedStatus: (await prisma.order.findUniqueOrThrow({ where: { id: pepsi.id } })).status }));
  assert.equal(cancelFailure, undefined, 'One-item cancellation must survive350ms query latency');
  assert.equal(attempts, 1);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: pepsi.id } })).status, 'CANCELLED');
  delay = 0; queryCount = 0; attempts = 0;
  const recovered = await updateOrderStatusWithContext(pepsi.id, { status: 'CANCELLED' });
  assert.equal(recovered.status, 'CANCELLED');
  console.log(JSON.stringify({ experiment: 'same-pepsi-cancel-no-latency', status: recovered.status, queryCount, attempts }));
  assert.equal((await prisma.ingredientStock.findUniqueOrThrow({ where: { branchId_ingredientId: { branchId, ingredientId: ingredientIds[4] } } })).stockQty, 100, 'Repeated cancellation must restore stock once');
  assert.equal(await prisma.orderEvent.count({ where: { orderId: pepsi.id, eventType: 'ORDER_CANCELLED' } }), 1);

  const stockBeforeTimeout = await prisma.ingredientStock.findMany({ where: { branchId }, orderBy: { ingredientId: 'asc' }, select: { ingredientId: true, stockQty: true } });
  delay = 900; queryCount = 0; attempts = 0;
  const extremeStarted = Date.now();
  let extremeFailure: any;
  try { await createOrder({ ...base, items, idempotencyKey: `${tag}_extreme` }); } catch (error: any) { extremeFailure = error; }
  console.log(JSON.stringify({ experiment: '188-four-item-900ms-per-db-query', elapsedMs: Date.now() - extremeStarted, code: extremeFailure?.code, queryCount, attempts }));
  assert.equal(extremeFailure?.code, 'P2028');
  assert.equal(publicError(extremeFailure), 'ระบบบันทึกใช้เวลานานเกินไป กรุณาลองใหม่');
  assert.equal(attempts, 1, 'Expiry must not replay the same transaction six times');
  assert.ok(Date.now() - extremeStarted < 13_000, 'Failure should return before the client checkout deadline');
  assert.equal(await prisma.order.count({ where: { idempotencyKey: `${tag}_extreme` } }), 0);
  assert.deepEqual(await prisma.ingredientStock.findMany({ where: { branchId }, orderBy: { ingredientId: 'asc' }, select: { ingredientId: true, stockQty: true } }), stockBeforeTimeout, 'Expired checkout must leave stock untouched');

  delay = 0;
  const duplicateInput = { ...base, items, idempotencyKey: `${tag}_double` };
  const duplicates = await Promise.all([createOrder(duplicateInput), createOrder(duplicateInput)]);
  assert.equal(duplicates[0].id, duplicates[1].id);
  assert.equal(await prisma.order.count({ where: { idempotencyKey: duplicateInput.idempotencyKey } }), 1);
  const stockBeforeCancel = await prisma.ingredientStock.findUniqueOrThrow({ where: { branchId_ingredientId: { branchId, ingredientId: ingredientIds[0] } } });
  await Promise.all([updateOrderStatusWithContext(duplicates[0].id, { status: 'CANCELLED' }), updateOrderStatusWithContext(duplicates[0].id, { status: 'CANCELLED' })]);
  assert.equal(await prisma.orderEvent.count({ where: { orderId: duplicates[0].id, eventType: 'ORDER_CANCELLED' } }), 1);
  assert.equal((await prisma.ingredientStock.findUniqueOrThrow({ where: { branchId_ingredientId: { branchId, ingredientId: ingredientIds[0] } } })).stockQty, stockBeforeCancel.stockQty + 1);
  await prisma.shift.update({ where: { id: shift.id }, data: { status: 'CLOSED' } });
  const stockBeforeRecovery = await prisma.ingredientStock.findMany({ where: { branchId }, orderBy: { ingredientId: 'asc' }, select: { ingredientId: true, stockQty: true } });
  const recoveredAfterClose = await createOrder({ ...base, items, idempotencyKey: `${tag}_baseline` });
  assert.equal(recoveredAfterClose.id, baseline.id, 'Lost response must recover its original bill after the shift closes');
  assert.equal(await prisma.order.count({ where: { idempotencyKey: `${tag}_baseline` } }), 1);
  assert.deepEqual(await prisma.ingredientStock.findMany({ where: { branchId }, orderBy: { ingredientId: 'asc' }, select: { ingredientId: true, stockQty: true } }), stockBeforeRecovery);
  await assert.rejects(createOrder({ ...base, branchId: branchId + 1, items, idempotencyKey: `${tag}_baseline` }), /สาขาอื่น/, 'An existing key must never expose another branch bill');
  console.log('PASS delayed checkout/cancellation, timeout rollback once, duplicate actions, closed-shift recovery and branch isolation');
} finally {
  delay = 0;
  (prisma as any).$transaction = originalTransaction;
  if (branchId) {
    const ids = (await prisma.order.findMany({ where: { branchId }, select: { id: true } })).map(o => o.id);
    await prisma.integrationOutbox.deleteMany({ where: { entityType: 'order', entityId: { in: ids } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { branchId } });
    await prisma.stockMovement.deleteMany({ where: { branchId } });
    await prisma.inventoryLot.deleteMany({ where: { branchId } });
    await prisma.ingredientStock.deleteMany({ where: { branchId } });
    await prisma.shift.deleteMany({ where: { branchId } });
    await prisma.storeSetting.deleteMany({ where: { branchId } });
    await prisma.branch.delete({ where: { id: branchId } });
  }
  await prisma.recipe.deleteMany({ where: { menuItemId: { in: menuIds } } });
  await prisma.menuItem.deleteMany({ where: { id: { in: menuIds } } });
  await prisma.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
  await prisma.$disconnect();
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
