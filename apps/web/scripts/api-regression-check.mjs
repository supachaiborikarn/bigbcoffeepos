import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source + '\nexport { fetchJson };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
// Keep deadlines deterministic and fast while still exercising AbortController.
const deadlines = [];
globalThis.window = { setTimeout: (callback, ms) => { deadlines.push(ms); return setTimeout(callback, Math.min(ms, 20)); }, clearTimeout };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const api = await import(`data:text/javascript;base64,${Buffer.from(outputText.replace('import.meta.env.VITE_API_URL', '"https://fixture.invalid/api"')).toString('base64')}`);

let calls = 0;
globalThis.fetch = (_url, { signal }) => {
  calls++;
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
};
await assert.rejects(api.getCurrentUser(), error => error.status === 408 && error.code === 'REQUEST_TIMEOUT' && error.message.includes('โหลดข้อมูล'));
assert.equal(calls, 1, 'a stalled read must not restart unbounded retries');
assert.ok(deadlines.includes(12_000));

globalThis.fetch = async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) });
await assert.rejects(api.getBranches(), error => error.status === 408, 'the read deadline also covers a stalled response body');

globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Caller canceled', 'AbortError')), { once: true }));
const caller = new AbortController();
const pending = api.fetchJson('https://fixture.invalid/api/cancel', { signal: caller.signal });
caller.abort();
await assert.rejects(pending, error => error.name === 'AbortError', 'caller cancellation must survive the added deadline');

let sent;
globalThis.fetch = async (_url, init) => { sent = JSON.parse(init.body); return new Response('{"order":{"id":1}}'); };
await api.createOrder({ branchId: 2, shiftId: 3, userId: 1, customerId: null, items: [{ menuItemId: 1, qty: 1, modifiers: [], note: 'fixture' }], paymentMethod: 'CASH', paymentDetails: { cashReceived: 100 }, discountType: null, discountValue: 0, loyaltyPointsToUse: 0, skipPromotions: true, discountApprovalToken: 'approved-fixture', idempotencyKey: 'fixture-checkout-key' });
assert.equal(sent.skipPromotions, true);
assert.equal(sent.discountApprovalToken, 'approved-fixture');
assert.equal(sent.idempotencyKey, 'fixture-checkout-key');
await api.approveDiscount(2, '1234', { idempotencyKey: 'fixture-checkout-key', items: sent.items });
assert.equal(sent.draft.idempotencyKey, 'fixture-checkout-key');
console.log('PASS API regressions: stalled request/body deadlines, caller abort, approval and promotion fields, approval draft; no network or real browser storage');
