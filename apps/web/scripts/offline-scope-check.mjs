// Runs the real API queue functions with in-memory browser storage and intercepted fetch.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.window = { setTimeout, clearTimeout };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const api = await import(`data:text/javascript;base64,${Buffer.from(outputText.replace('import.meta.env.VITE_API_URL', '"https://fixture.invalid/api"')).toString('base64')}`);
const pendingKey = 'bb_pos_offline_orders', failedKey = 'bb_pos_offline_failed';
const read = key => JSON.parse(localStorage.getItem(key) || '[]');
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
function login(userId, branchId) { write('bb_pos_user', { id: userId, branchId }); localStorage.setItem(`bb_pos_branch_id:${userId}`, String(branchId)); }
const bill = (userId, branchId, note) => ({ userId, branchId, shiftId: branchId, items: [{ menuItemId: 1, name: note, basePrice: 50, qty: 1, modifiers: [] }], paymentMethod: 'CASH', paymentDetails: { cashReceived: 50 }, discountType: null, discountValue: 0, customerId: null, loyaltyPointsToUse: 0 });
const sent = [];
let onSend = () => new Response(JSON.stringify({ order: { id: sent.length } }), { status: 200 });
globalThis.fetch = async (_url, init) => { const body = JSON.parse(init.body); sent.push(body); return onSend(body); };
login(6, 1);
// Legacy bills lacking an idempotency key must never erase bills of other users or branches.
write(pendingKey, [bill(6, 1, 'mine'), bill(7, 1, 'other user'), bill(6, 2, 'other branch')]);
assert.equal(api.getOfflinePendingCount(), 1);
const parallel = await Promise.all([api.flushOfflineOrders(), api.flushOfflineOrders()]);
assert.equal(sent.length, 1);
assert.equal(parallel[0].sent, 1);
assert.ok(sent[0].idempotencyKey);
assert.deepEqual(read(pendingKey).map(order => order.items[0].name), ['other user', 'other branch']);
// Bills added while a request is in flight must remain queued.
write(pendingKey, [bill(6, 1, 'in flight')]);
onSend = () => { write(pendingKey, [...read(pendingKey), bill(6, 1, 'new arrival')]); return new Response('{"order":{"id":2}}'); };
await api.flushOfflineOrders();
assert.deepEqual(read(pendingKey).map(order => order.items[0].name), ['new arrival']);
// Switching workspaces during a flush stops subsequent requests.
write(pendingKey, [bill(6, 1, 'first'), bill(6, 1, 'second')]);
onSend = () => { login(6, 2); return new Response('{"order":{"id":3}}'); };
const switched = await api.flushOfflineOrders();
assert.equal(switched.sent, 1);
assert.equal(read(pendingKey)[0].items[0].name, 'second');
assert.equal(api.getOfflinePendingCount(), 0);
// Rejected orders remain reviewable within their original workspace.
login(6, 1);
write(failedKey, [{ input: bill(7, 2, 'other rejected'), error: 'fixture', failedAt: new Date().toISOString() }]);
onSend = () => new Response('{"error":"closed shift"}', { status: 400 });
await api.flushOfflineOrders();
assert.equal(api.getOfflineFailedCount(), 1);
assert.equal(api.getOfflineFailedDetails()[0].error, 'closed shift');
api.discardFailedOfflineOrders();
assert.equal(read(failedKey).length, 1);
assert.equal(read(failedKey)[0].input.userId, 7);
// A network retry keeps the same idempotency key.
write(pendingKey, [bill(6, 1, 'network retry')]);
onSend = () => { throw new TypeError('Failed to fetch'); };
await api.flushOfflineOrders();
const retryKey = read(pendingKey)[0].idempotencyKey;
assert.ok(retryKey);
onSend = () => new Response('{"order":{"id":4}}');
await api.flushOfflineOrders();
assert.equal(sent.at(-1).idempotencyKey, retryKey);
assert.equal(api.getOfflinePendingCount(), 0);
console.log('PASS offline scope: legacy bills, concurrent flush, arrivals during sync, branch switch, rejected bills, stable retry; no network or real storage used');
