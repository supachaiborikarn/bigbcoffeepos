// Actual API code with isolated browser storage, accelerated deadlines and mocked requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const storage = new Map();
const deadlines = [];
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.window = { setTimeout: (callback, ms) => { deadlines.push(ms); return setTimeout(callback, Math.min(ms, 20)); }, clearTimeout };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const api = await import(`data:text/javascript;base64,${Buffer.from(outputText.replace('import.meta.env.VITE_API_URL', '"https://fixture.invalid/api"')).toString('base64')}`);
localStorage.setItem('bb_pos_user', JSON.stringify({ id: 6, branchId: 1 }));
localStorage.setItem('bb_pos_branch_id:6', '1');
const pendingKey = 'bb_pos_offline_orders';
const failedKey = 'bb_pos_offline_failed';
const read = key => JSON.parse(localStorage.getItem(key) || '[]');
const bill = {
  userId: 6, branchId: 1, shiftId: 7, customerId: null,
  items: [35, 70, 70, 13].map((price, index) => ({ id: String(index), menuItemId: index + 1, name: ['ขนม', 'ลาเต้เย็น', 'ชาเขียวเย็น', 'เปปซี่'][index], basePrice: price, qty: 1, modifiers: [] })),
  paymentMethod: 'QR', paymentDetails: { paymentConfirmed: true },
  discountType: null, discountValue: 0, loyaltyPointsToUse: 0,
  idempotencyKey: 'watcharakiat-188-fixture'
};
const order = (id = 188, status = 'PAID') => ({ id, branchId: 1, status, total: 188, items: [{ id: 1 }] });
const response = payload => new Response(JSON.stringify(payload));
const hang = init => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));

// An online deadline must reach CartContext's existing idempotency recovery, keeping its cart.
globalThis.fetch = (_url, init) => hang(init);
await assert.rejects(api.createOrder(bill), error => error instanceof api.RequestTimeoutError && error.message.includes('บันทึกออเดอร์นานเกินไป'));
assert.equal(api.getOfflinePendingCount(), 0, 'a timeout must not silently clear the checkout cart as an offline success');
assert.ok(deadlines.includes(15_000));
globalThis.fetch = async () => response({ order: order() });
assert.equal((await api.getOrderByIdempotencyKey(bill.idempotencyKey)).id, 188);
console.log('PASS online checkout deadline remains unconfirmed and supports idempotency lookup');

// Genuine network loss still persists the sale locally with a stable identity.
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
const queued = await api.createOrder(bill);
assert.ok(queued.id < 0);
assert.equal(queued.total, 188);
const original = api.getOfflinePendingDetails()[0];
assert.equal(original.idempotencyKey, bill.idempotencyKey);
assert.ok(original.offlineQueueId);
assert.ok(original.queuedAt);
assert.equal(original.items.length, 4);
assert.equal(original.items[3].name, 'เปปซี่');
globalThis.fetch = (_url, init) => hang(init);
const sync = await api.flushOfflineOrders();
assert.deepEqual(sync, { sent: 0, remaining: 1, failed: 0 });
assert.equal(api.getOfflinePendingDetails()[0].offlineQueueId, original.offlineQueueId);
assert.equal(api.getOfflinePendingDetails()[0].idempotencyKey, original.idempotencyKey);
assert.match(api.getOfflinePendingDetails()[0].lastSyncError, /บันทึกออเดอร์นานเกินไป/);
console.log('PASS stalled queued writes retain the original bill and identity for safe retry');

// A successful status code alone cannot justify deleting the local sale.
for (const invalid of [null, {}, { order: null }, { order: { id: 188 } }, { order: { ...order(), branchId: 2 } }, { order: { ...order(), id: -188 } }, { order: { ...order(), total: null } }, { order: { ...order(), items: [] } }, { order: { ...order(), status: 'INVALID' } }]) {
  globalThis.fetch = async () => response(invalid);
  assert.deepEqual(await api.flushOfflineOrders(), { sent: 0, remaining: 1, failed: 0 });
  assert.equal(api.getOfflinePendingDetails()[0].offlineQueueId, original.offlineQueueId);
}
globalThis.fetch = async () => new Response('<html>wrong routing</html>', { headers: { 'Content-Type': 'text/html' } });
assert.deepEqual(await api.flushOfflineOrders(), { sent: 0, remaining: 1, failed: 0 });
for (const status of [429, 500, 503]) {
  globalThis.fetch = async () => new Response('{"error":"service busy"}', { status });
  assert.deepEqual(await api.flushOfflineOrders(), { sent: 0, remaining: 1, failed: 0 });
}
globalThis.fetch = async () => new Response('{"error":"ระบบบันทึกใช้เวลานานเกินไป กรุณาลองส่งบิลเดิมใหม่"}', { status: 400 });
assert.deepEqual(await api.flushOfflineOrders(), { sent: 0, remaining: 1, failed: 0 });
assert.equal(api.getOfflinePendingDetails()[0].idempotencyKey, original.idempotencyKey);
assert.deepEqual(read(failedKey), []);
let retried;
globalThis.fetch = async (_url, init) => { retried = JSON.parse(init.body); return response({ order: order() }); };
assert.deepEqual(await api.flushOfflineOrders(), { sent: 1, remaining: 0, failed: 0 });
assert.equal(retried.idempotencyKey, original.idempotencyKey);
assert.equal(api.getOfflinePendingCount(), 0);
console.log('PASS invalid success responses and temporary server failures never erase or permanently reject a queued bill');

// HTTP rejection text and browser onLine are not evidence of a failed network request.
navigator.onLine = false;
globalThis.fetch = async () => new Response('{"error":"Failed to fetch อินเทอร์เน็ต closed shift"}', { status: 400 });
await assert.rejects(api.createOrder(bill), error => error instanceof api.ApiError && error.status === 400);
assert.equal(api.getOfflinePendingCount(), 0);
navigator.onLine = true;
for (const error of [new TypeError('Cannot read properties of undefined'), new DOMException('Failed to fetch', 'AbortError')]) {
  globalThis.fetch = async () => { throw error; };
  await assert.rejects(api.createOrder(bill), actual => actual === error);
  assert.equal(api.getOfflinePendingCount(), 0);
}
console.log('PASS HTTP rejections remain errors even when their text mentions the network or navigator says offline');

// A lost cancellation reply can only be called successful after a matching read-back.
for (const confirmed of [true, false]) {
  let writes = 0;
  let reads = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'PATCH') { writes++; return hang(init); }
    reads++;
    return response({ order: order(13, confirmed ? 'CANCELLED' : 'PAID') });
  };
  if (confirmed) assert.equal((await api.updateOrderStatus(13, 'CANCELLED')).status, 'CANCELLED');
  else await assert.rejects(api.updateOrderStatus(13, 'CANCELLED'), error => error.code === 'ORDER_NOT_CONFIRMED' && error.message.includes('รีเฟรช'));
  assert.equal(writes, 1, 'the cancellation must never be sent again automatically');
  assert.equal(reads, 1);
}
assert.ok(deadlines.includes(5_000));
for (const invalid of [null, { order: order(99, 'CANCELLED') }, { order: order(13, 'PAID') }]) {
  globalThis.fetch = async (_url, init) => init?.method === 'PATCH' ? response({}) : response(invalid);
  await assert.rejects(api.updateOrderStatus(13, 'CANCELLED'), error => error.code === 'ORDER_NOT_CONFIRMED');
}
globalThis.fetch = (_url, init) => hang(init);
await assert.rejects(api.updateOrderStatus(13, 'CANCELLED'), error => error.code === 'ORDER_NOT_CONFIRMED');
let reads = 0;
globalThis.fetch = async (_url, init) => {
  if (init?.method === 'PATCH') return new Response('{"error":"NetworkError forbidden"}', { status: 403 });
  reads++;
  return response({ order: order(13, 'CANCELLED') });
};
await assert.rejects(api.updateOrderStatus(13, 'CANCELLED'), error => error.status === 403);
assert.equal(reads, 0);
console.log('PASS cancellation deadlines release pending requests, verify actual status and never blindly repeat or report success');
console.log('PASS QR 188 offline queue and recovery regression');
