// Executes the actual TypeScript functions against an in-memory adapter; no DB client or .env is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const jwt = require('jsonwebtoken');
const { createHash } = require('node:crypto');
const source = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
const section = (text, start, end) => text.slice(text.indexOf(start), end ? text.indexOf(end, text.indexOf(start)) : undefined).replaceAll('export ', '');
function evaluate(code, names, values, returns) {
  const js = ts.transpileModule(`${code}\nreturn ${returns};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...names, js)(...values);
}
const ordersSource = source('store/orders.ts');
const roundMoney = (n) => Math.round(n * 100) / 100;
const discount = evaluate(section(ordersSource, 'function computeDiscount(', 'function normalizePaymentMethod('), ['roundMoney'], [roundMoney], '{computeDiscount,selectBillDiscounts}');
const getShiftSalesTotals = evaluate(source('store/shiftTotals.ts').replaceAll('export ', ''), [], [], 'getShiftSalesTotals');
const auth = evaluate(section(source('middleware/auth.ts'), 'function discountDraftIdentity(', 'export function requireAuth('), ['createHash', 'jwt', 'JWT_SECRET'], [createHash, jwt, 'financial-test-only-secret'], '{signDiscountApproval,verifyDiscountApproval}');
function locks() {
  const tails = new Map();
  return async (key) => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release;
    tails.set(key, new Promise((resolve) => { release = resolve; }));
    await previous;
    return release;
  };
}
function fixture(gateReady = false) {
  const state = {
    order: { id: 1, branchId: 1, status: 'PAID', total: 65, paymentMethod: 'CASH', shiftId: 1, loyaltyPointsUsed: 0, loyaltyPointsEarned: 0, customerId: null, items: [], payments: [] },
    shift: { id: 1, branchId: 1, status: 'OPEN', openingCash: 100, totalSales: 65, totalOrders: 1, cashSales: 65, qrSales: 0, cardSales: 0 },
    events: [], entries: []
  };
  const acquire = locks();
  let releaseReady, enterReady;
  const readyEntered = new Promise((resolve) => { enterReady = resolve; });
  const readyGate = new Promise((resolve) => { releaseReady = resolve; });
  const order = {
    findUnique: async () => structuredClone(state.order),
    groupBy: async () => [{ status: state.order.status, paymentMethod: state.order.paymentMethod, _sum: { total: state.order.total }, _count: { _all: 1 } }],
    updateMany: async (q) => { if (q.where.status.notIn.includes(state.order.status)) return { count: 0 }; state.order.status = q.data.status; return { count: 1 }; },
    update: async (q) => { if (gateReady && q.data.status === 'READY') { enterReady(); await readyGate; } state.order.status = q.data.status; return structuredClone(state.order); }
  };
  const shift = {
    findFirst: async () => structuredClone(state.shift), findUnique: async () => structuredClone(state.shift), findUniqueOrThrow: async () => structuredClone(state.shift),
    update: async (q) => { for (const [key, value] of Object.entries(q.data)) state.shift[key] = typeof value === 'object' && value && 'increment' in value ? state.shift[key] + value.increment : value; return structuredClone(state.shift); }
  };
  const prisma = { order, shift, $transaction: async (callback) => {
    const releases = [];
    const tx = { order, shift, taxInvoice: { findFirst: async () => null }, stockMovement: { findMany: async () => [], create: async () => {} }, orderEvent: { create: async (q) => state.events.push(q.data.eventType) },
      $queryRaw: async (strings, ...values) => {
        const sql = strings.join('?');
        if (sql.includes('FOR UPDATE')) { releases.push(await acquire(`${sql.includes('FROM shifts') ? 'shift' : 'order'}:${values[0]}`)); return [{ id: values[0] }]; }
        if (sql.includes('AS net')) return [{ net: state.entries.reduce((sum, entry) => sum + (entry.type === 'IN' ? entry.amount : -entry.amount), 0) }];
        if (sql.includes('INSERT INTO cash_drawer_entries')) { const row = { id: state.entries.length + 1, shiftId: values[1], type: values[2], amount: values[3], category: values[4] }; state.entries.push(row); return [{ id: row.id }]; }
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    };
    try { return await callback(tx); } finally { for (const release of releases.reverse()) release(); }
  } };
  const update = evaluate(section(ordersSource, 'export async function updateOrderStatusWithContext(', 'export async function createOrder('), ['prisma', 'ALLOWED_STATUSES', 'REVERSAL_STATUSES', 'ORDER_ITEMS_INCLUDE', 'hydrateOrder', 'getShiftSalesTotals'], [prisma, new Set(['PAID', 'READY', 'CANCELLED', 'REFUNDED']), new Set(['CANCELLED', 'REFUNDED']), {}, (row) => row, getShiftSalesTotals], 'updateOrderStatusWithContext');
  return { state, prisma, update, releaseReady, readyEntered };
}
async function main() {
  const manual = [{ type: 'ORDER_PERCENT', value: 40 }], promo = [{ type: 'ORDER_PERCENT', value: 60 }], coupon = { type: 'ORDER_PERCENT', value: 30 };
  assert.equal(discount.computeDiscount(discount.selectBillDiscounts(manual, coupon, promo), 100, []).discountAmount, 40);
  assert.equal(discount.computeDiscount(discount.selectBillDiscounts([], coupon, promo), 100, []).discountAmount, 30);
  assert.equal(discount.computeDiscount(discount.selectBillDiscounts([], null, promo), 100, []).discountAmount, 60);
  console.log('PASS one discount source: manual / coupon / auto');

  const duplicate = fixture();
  await Promise.all([duplicate.update(1, { status: 'CANCELLED' }), duplicate.update(1, { status: 'CANCELLED' })]);
  assert.equal(duplicate.state.shift.totalSales, 0); assert.equal(duplicate.state.shift.totalOrders, 0); assert.equal(duplicate.state.events.length, 1);
  console.log('PASS duplicate cancellation restores totals once');

  const race = fixture(true);
  const ready = race.update(1, { status: 'READY' });
  await race.readyEntered;
  let cancelled = false;
  const cancel = race.update(1, { status: 'CANCELLED' }).then(() => { cancelled = true; });
  await new Promise(setImmediate);
  assert.equal(cancelled, false, 'cancellation must wait for the READY order lock');
  race.releaseReady(); await ready; await cancel;
  assert.equal(race.state.order.status, 'CANCELLED'); assert.equal(race.state.shift.totalSales, 0); assert.equal(race.state.shift.totalOrders, 0);
  await assert.rejects(race.update(1, { status: 'READY' }), /ถูกยกเลิก/);
  console.log('PASS READY/cancel interleaving cannot resurrect a reversed order');

  const damaged = fixture(); damaged.state.order.status = 'CANCELLED'; damaged.state.shift.totalSales = -65; damaged.state.shift.totalOrders = -1; damaged.state.shift.cashSales = -65;
  const getCurrentShift = evaluate(section(source('store/shifts.ts'), 'export async function getCurrentShift(', 'export async function getShift('), ['prisma', 'getShiftSalesTotals'], [damaged.prisma, getShiftSalesTotals], 'getCurrentShift');
  assert.equal((await getCurrentShift(1)).totalSales, 0); assert.equal((await getCurrentShift(1)).totalOrders, 0);
  damaged.state.order.status = 'PAID'; damaged.state.order.total = 100;
  assert.equal((await getCurrentShift(1)).totalSales, 100); assert.equal((await getCurrentShift(1)).totalOrders, 1);
  console.log('PASS damaged cached totals do not hide a new 100-baht sale');

  const cash = fixture(); cash.state.order.status = 'CANCELLED'; cash.state.shift.totalSales = 0; cash.state.shift.totalOrders = 0; cash.state.shift.cashSales = 0;
  const cashSource = source('store/cashDrawer.ts');
  const expected = evaluate(section(cashSource, 'export async function getExpectedDrawerCash(', 'export async function addCashEntry('), ['getShiftSalesTotals'], [getShiftSalesTotals], 'getExpectedDrawerCash');
  const add = evaluate(section(cashSource, 'export async function addCashEntry(', 'export async function getCashEntryBranch('), ['prisma', 'ensureCashDrawerTable', 'getExpectedDrawerCash', 'listCashEntries'], [cash.prisma, async () => {}, expected, async () => cash.state.entries], 'addCashEntry');
  const payouts = await Promise.allSettled([add({ shiftId: 1, type: 'OUT', amount: 80, category: 'test' }), add({ shiftId: 1, type: 'OUT', amount: 80, category: 'test' })]);
  assert.equal(payouts.filter((row) => row.status === 'fulfilled').length, 1); assert.equal(cash.state.entries.reduce((sum, row) => sum + row.amount, 0), 80);
  console.log('PASS concurrent payouts cannot spend 160 from a 100-baht drawer');

  const draft = { idempotencyKey: 'checkout-review', items: [{ menuItemId: 1, qty: 1, modifiers: [] }], customerId: null, discountType: 'PERCENT', discountValue: 60, discounts: [], loyaltyPointsToUse: 0 };
  const token = auth.signDiscountApproval({ id: 99, name: 'Manager' }, 1, draft);
  assert.ok(auth.verifyDiscountApproval(token, 1, draft));
  for (const altered of [{ ...draft, idempotencyKey: 'second-bill' }, { ...draft, discountValue: 100 }, { ...draft, items: [{ menuItemId: 1, qty: 2, modifiers: [] }] }]) assert.equal(auth.verifyDiscountApproval(token, 1, altered), null);
  assert.equal(auth.verifyDiscountApproval(token, 2, draft), null);
  const payload = jwt.decode(token); assert.equal(payload.exp - payload.iat, 900);
  console.log('PASS approval is bound to one bill draft for 15 minutes');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
