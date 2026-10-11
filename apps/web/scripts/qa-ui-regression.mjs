import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Every API request is fulfilled here; this check never connects to a database.
const require = createRequire(import.meta.url);
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(webDir, '../..');
const artifactDir = path.join(rootDir, 'output/playwright/ui-qa');
const user = { id: 11, name: 'ผู้ตรวจทดสอบ', role: 'admin', active: true, branchId: null };
const branch = { id: 21, name: 'Big B Coffee สาขาเชียงใหม่ถนนสนามบินแห่งที่หนึ่ง', location: 'ทดสอบ', active: true, branchType: 'coffee' };
const branches = [branch, { ...branch, id: 22, name: 'Big B Coffee สาขาสอง' }];
const menu = [{ id: 31, name: 'คุกกี้ทดสอบ', category: 'POSPOS - เบเกอรี่', basePrice: 65, branchType: 'coffee', active: true, createdAt: new Date().toISOString() }];
const shift = { id: 41, branchId: branch.id, userId: user.id, openingCash: 500, totalSales: 65, totalOrders: 1, cashSales: 65, qrSales: 0, cardSales: 0, status: 'OPEN', openedAt: new Date().toISOString(), closedAt: null };
const summary = { source: 'system', sourceBreakdown: { system: { orders: 1, revenue: 65 }, pospos: { orders: 0, revenue: 0 }, all: { orders: 1, revenue: 65 } }, importedSalesOnlyOrders: 0, importedSalesOnlyRevenue: 0, totalOrders: 1, totalRevenue: 65, averageTicket: 65, topItems: [], daily: [] };
const setting = { branchId: branch.id, shopName: 'Big B Coffee', addressLine: 'ทดสอบ', taxId: '', vatMode: 'INCLUSIVE', vatRate: 7, paymentMethods: ['CASH', 'QR', 'CARD'] };
const printKey = `bbpos.print.job:${user.id}:${branch.id}`;
const printJob = { id: 'fixture-print', branchId: branch.id, billId: 51, html: '<html><body>ใบเสร็จทดสอบ</body></html>', documents: ['<html><body>ใบเสร็จทดสอบ</body></html>'], labels: ['ลูกค้า'], escpos: 'ใบเสร็จทดสอบ', widthMm: 58, createdAt: Date.now() };
const oldOrder = { id: 51, branchId: branch.id, shiftId: shift.id, customerId: 61, userId: user.id, createdAt: new Date().toISOString(), status: 'PAID', subtotal: 75, discountType: null, discountValue: 0, discountAmount: 15, loyaltyPointsUsed: 2, loyaltyPointsEarned: 1, tax: 0, total: 58, paymentMethod: 'CASH', cashReceived: 100, changeAmount: 42, items: [{ id: 71, menuItemId: 31, name: menu[0].name, category: menu[0].category, qty: 1, basePrice: 65, modifiers: [{ group: 'เพิ่ม', value: 'ช็อกโกแลต', price: 10 }], note: 'แยกถุง', lineTotal: 75 }] };
let server;
let browser;
let serverOutput = '';
let webUrl;
const results = [];

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
async function startWeb() {
  const port = await freePort();
  webUrl = `http://127.0.0.1:${port}`;
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: webDir, env: { ...process.env, VITE_API_URL: `${webUrl}/api` }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (value) => { serverOutput += value.toString(); });
  server.stderr.on('data', (value) => { serverOutput += value.toString(); });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Vite stopped: ${serverOutput}`);
    try { if ((await fetch(webUrl)).ok) return; } catch { /* Wait only for this local server. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not start: ${serverOutput}`);
}
async function fixture({ viewport = { width: 1280, height: 900 }, native = false, storedPrint = null, hangingSession = false, refunded = false, currentAddOnPrice = null } = {}) {
  const context = await browser.newContext({ viewport });
  const writes = [];
  const errors = [];
  const orders = [{ ...structuredClone(oldOrder), status: refunded ? 'REFUNDED' : 'PAID' }];
  if (currentAddOnPrice !== null) orders[0].items[0].modifiers[0].name = 'Add-on';
  await context.addInitScript(({ user, branch, branches, native, printKey, storedPrint }) => {
    localStorage.setItem('bb_pos_token', 'local-fixture-token');
    localStorage.setItem('bb_pos_user', JSON.stringify(user));
    localStorage.setItem(`bb_pos_branch_id:${user.id}`, String(branch.id));
    localStorage.setItem(`bb_pos_branches_cache:${user.id}`, JSON.stringify(branches));
    localStorage.setItem('bbpos.appearance', 'light');
    localStorage.removeItem('bbpos.print.auto');
    if (storedPrint) localStorage.setItem(printKey, JSON.stringify(storedPrint));
    if (native) window.BBPOSNative = { printReceipt: (json) => { window.__nativePrintPayload = JSON.parse(json); } };
  }, { user, branch, branches, native, printKey, storedPrint });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== webUrl) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.slice(4);
    const method = request.method();
    if (hangingSession && (endpoint === '/auth/me' || endpoint === '/branches')) return;
    if (method !== 'GET') writes.push({ endpoint, method, body: request.postDataJSON() });
    let body = { items: [] };
    if (endpoint === '/auth/me') body = { user };
    else if (endpoint === '/branches') body = { items: branches };
    else if (endpoint === '/users') body = { items: [user] };
    else if (endpoint === '/menu') body = { items: currentAddOnPrice === null ? menu : [...menu, { ...menu[0], id: 32, name: 'ช็อกโกแลต', category: 'ADD ON', basePrice: currentAddOnPrice }] };
    else if (endpoint === '/settings/store') body = { settings: setting };
    else if (endpoint === '/shifts/current') body = { shift };
    else if (endpoint === '/cup-stock-settings') body = { settings: [] };
    else if (endpoint === '/reports/summary') body = { summary };
    else if (endpoint === '/reports/profit') body = { items: [], totalRevenue: 65, totalCost: 0, totalProfit: 65 };
    else if (endpoint === '/reports/staff') body = { staff: [] };
    else if (endpoint === '/integrations/summary') body = { summary: { byStatus: [] } };
    else if (endpoint === '/orders' && method === 'GET') body = { items: orders };
    else if (endpoint === '/orders' && method === 'POST') {
      const input = request.postDataJSON();
      const subtotal = input.items.reduce((sum, item) => sum + (65 + item.modifiers.reduce((n, mod) => n + mod.price, 0)) * item.qty, 0);
      body = { order: { ...oldOrder, ...input, id: 52, customerId: null, subtotal, total: subtotal, discountAmount: 0, loyaltyPointsUsed: 0, loyaltyPointsEarned: 0, status: 'PAID', items: input.items.map((item, index) => ({ ...menu[0], ...item, id: 72 + index, lineTotal: subtotal })) } };
    } else if (endpoint === '/orders/51' && method === 'PATCH') {
      orders[0].status = request.postDataJSON().status;
      body = { order: orders[0] };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', (error) => errors.push(error.message));
  const goto = async (pathname) => {
    await page.goto(webUrl + pathname);
    await page.locator('.studio-app').waitFor({ timeout: 5_000 });
  };
  return { context, page, goto, writes, errors, orders };
}
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function addCookie(page) {
  await page.getByRole('button', { name: `เพิ่ม ${menu[0].name}`, exact: true }).click();
}
async function submitPrint(page) {
  await page.evaluate(async (job) => {
    const { submitPrintJob } = await import('/src/utils/printJob.ts');
    if (!submitPrintJob(job)) throw new Error('Print receiver unavailable');
  }, { ...printJob, createdAt: Date.now() });
}

try {
  await fs.mkdir(artifactDir, { recursive: true });
  await startWeb();
  browser = await chromium.launch({ headless: true });
  await check('default receipt printing stays off after payment', async () => {
    const f = await fixture();
    try {
      await f.goto('/pos');
      await addCookie(f.page);
      await f.page.getByRole('button', { name: /^ชำระเงิน ฿65/ }).click();
      await f.page.getByRole('button', { name: 'พอดี', exact: true }).click();
      await f.page.getByRole('button', { name: 'ยืนยันรับเงิน', exact: true }).click();
      await f.page.locator('.studio-sale-success').waitFor();
      assert.equal(f.context.pages().length, 1, 'Default payment opened a print popup');
      assert.equal(f.writes.filter((w) => w.endpoint === '/orders' && w.method === 'POST').length, 1);
      assert.equal(await f.page.evaluate((key) => localStorage.getItem(key), printKey), null);
      await f.page.getByRole('button', { name: 'ตั้งค่าเครื่องพิมพ์', exact: true }).click();
      assert.equal(await f.page.getByRole('checkbox', { name: 'พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน' }).isChecked(), false);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
  for (const height of [480, 600]) await check(`390×${height}: full branch name, reachable totals and payment without overlap`, async () => {
    const f = await fixture({ viewport: { width: 390, height } });
    try {
      await f.goto('/pos');
      const title = f.page.locator('.studio-branch-picker strong');
      assert.equal(await title.textContent(), branch.name);
      assert.equal(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), true, 'Branch title is clipped');
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(/POSPOS/i.test(await f.page.locator('.studio-categories').innerText()), false);
      await f.page.getByRole('button', { name: /^เบเกอรี่ 1/ }).click();
      await addCookie(f.page);
      await f.page.locator('.pos-cart-fab').click();
      await f.page.locator('.studio-pay-button').scrollIntoViewIfNeeded();
      const geometry = await f.page.evaluate(() => {
        const pay = document.querySelector('.studio-pay-button').getBoundingClientRect();
        const total = [...document.querySelectorAll('span')].find((el) => el.textContent === 'ยอดสุทธิ').parentElement.getBoundingClientRect();
        return { pay: pay.toJSON(), total: total.toJSON(), overlap: pay.top < total.bottom && pay.bottom > total.top };
      });
      assert.equal(geometry.overlap, false, JSON.stringify(geometry));
      assert.ok(geometry.pay.bottom <= height + 1, 'Payment cannot be reached');
      await f.page.screenshot({ path: path.join(artifactDir, `cart-390-${height}.png`) });
      console.log(JSON.stringify({ viewport: [390, height], geometry }));
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
  await check('Staff validates empty name and missing branch in Thai without native validation', async () => {
    const f = await fixture();
    try {
      await f.goto('/staff');
      await f.page.getByRole('button', { name: 'เพิ่มพนักงาน', exact: true }).click();
      await f.page.evaluate(() => { window.__invalidEvents = 0; document.addEventListener('invalid', () => window.__invalidEvents++, true); });
      await f.page.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
      await f.page.locator('.toast').filter({ hasText: 'กรุณากรอกชื่อพนักงาน' }).waitFor();
      await f.page.getByPlaceholder('เช่น สมชาย ใจดี').fill('ผู้ทดสอบ');
      await f.page.getByPlaceholder('เช่น 1234').fill('1234');
      await f.page.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
      await f.page.locator('.toast').filter({ hasText: 'กรุณาเลือกสาขาประจำของพนักงาน' }).waitFor();
      assert.deepEqual(await f.page.evaluate(() => ({ noValidate: document.querySelector('form').noValidate, invalid: window.__invalidEvents })), { noValidate: true, invalid: 0 });
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
  await check('Reports uses imported-sales label', async () => {
    const f = await fixture();
    try {
      await f.goto('/reports');
      await f.page.getByText('ยอดขายนำเข้า', { exact: true }).last().waitFor();
      assert.equal(/POSPOS/i.test(await f.page.locator('main').innerText()), false);
      const printOutputs = await f.page.evaluate(async () => {
        const { buildDailySummaryHtml, buildDailySummaryEscPos, createDailySummaryJob } = await import('/src/utils/dailySummaryPrint.ts');
        const report = {
          date: '2026-10-11', generatedAt: '2026-10-11T01:00:00Z', source: 'pospos', branch: null,
          sourceBreakdown: { system: { orders: 0, revenue: 0 }, pospos: { orders: 1, revenue: 65 }, all: { orders: 1, revenue: 65 } },
          totals: { totalRevenue: 65, totalOrders: 1, averageTicket: 65, subtotal: 65, discountAmount: 0, cancelledOrders: 0, refundedOrders: 0, loyaltyPointsUsed: 0 },
          shifts: [], payments: [], topItems: [], cash: { cashSales: 0 }, cups: [], cashEntries: [], staffHours: []
        };
        const job = createDailySummaryJob(report, 21);
        return [buildDailySummaryHtml(report, 58), buildDailySummaryHtml(report, 80, true), buildDailySummaryEscPos(report, 58), buildDailySummaryEscPos(report, 80), job.html, ...job.documents, job.escpos];
      });
      assert.ok(printOutputs.every((output) => !/POSPOS/i.test(output)), 'Printed daily report still shows the old provider label');
      assert.ok(printOutputs[0].includes('ยอดขายนำเข้า'));
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
  await check('native receipt status hides outside POS/orders and clears after confirmed success', async () => {
    const f = await fixture({ native: true });
    try {
      await f.page.clock.install();
      await f.goto('/pos');
      await submitPrint(f.page);
      await f.page.locator('.printer-status').waitFor();
      await f.page.getByRole('link', { name: 'พนักงานและสิทธิ์', exact: true }).click();
      await f.page.waitForURL('**/staff');
      await f.page.locator('.printer-status').waitFor({ state: 'hidden' });
      assert.equal(await f.page.locator('.printer-status').count(), 0);
      assert.ok(await f.page.evaluate((key) => localStorage.getItem(key), printKey));
      await f.page.getByRole('link', { name: 'รับออเดอร์', exact: true }).click();
      await f.page.locator('.printer-status').waitFor();
      await f.page.evaluate(() => window.dispatchEvent(new CustomEvent('bbpos-native-print-result', { detail: { requestId: window.__nativePrintPayload.requestId, success: true, completedCopies: 1 } })));
      await f.page.locator('.printer-status').filter({ hasText: 'เครื่องพิมพ์แจ้งว่าพิมพ์ครบแล้ว' }).waitFor();
      await f.page.clock.fastForward(8_001);
      await f.page.locator('.printer-status').waitFor({ state: 'hidden' });
      assert.equal(await f.page.locator('.printer-status').count(), 0);
      assert.equal(await f.page.evaluate((key) => localStorage.getItem(key), printKey), null);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
  await check('browser afterprint clears completed status', async () => {
    const f = await fixture();
    try {
      await f.page.clock.install();
      await f.goto('/pos');
      await f.page.evaluate(() => {
        window.open = () => {
          const win = { closed: false, document: document.implementation.createHTMLDocument(), focus() {}, close() { this.closed = true; }, print() { this.onafterprint?.(); } };
          return win;
        };
      });
      await submitPrint(f.page);
      await f.page.clock.fastForward(100);
      await f.page.locator('.printer-status').filter({ hasText: 'ปิดหน้าต่างพิมพ์แล้ว' }).waitFor();
      await f.page.clock.fastForward(8_001);
      await f.page.locator('.printer-status').waitFor({ state: 'hidden' });
      assert.equal(await f.page.locator('.printer-status').count(), 0);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
  await check('PassPRNT callback and restored completed status expire', async () => {
    const pending = { job: { ...printJob, createdAt: Date.now() }, mode: 'passprnt', copy: 0, attempt: 'fixture-attempt', message: 'กำลังพิมพ์', awaiting: true };
    const f = await fixture({ storedPrint: pending });
    try {
      await f.page.clock.install();
      await f.goto('/pos?passprnt_code=0&print_attempt=fixture-attempt');
      await f.page.locator('.printer-status').filter({ hasText: 'Star PassPRNT แจ้งว่าพิมพ์ครบแล้ว' }).waitFor();
      await f.page.clock.fastForward(8_001);
      await f.page.locator('.printer-status').waitFor({ state: 'hidden' });
      assert.equal(await f.page.locator('.printer-status').count(), 0);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
    const done = await fixture({ storedPrint: { ...pending, awaiting: false, message: 'เครื่องพิมพ์แจ้งว่าพิมพ์ครบแล้ว', clearAt: Date.now() - 1 } });
    try {
      await done.goto('/orders');
      assert.equal(await done.page.locator('.printer-status').count(), 0);
      assert.equal(await done.page.evaluate((key) => localStorage.getItem(key), printKey), null);
    } finally { await done.context.close(); }
  });
  await check('refund and reopen creates an editable unpaid cart while the original remains refunded', async () => {
    const f = await fixture();
    try {
      await f.goto('/orders');
      f.page.once('dialog', (dialog) => dialog.accept('แก้รายการสินค้า'));
      await f.page.getByRole('button', { name: 'คืนเงินและแก้บิล', exact: true }).click();
      await f.page.waitForURL('**/pos');
      await f.page.getByRole('button', { name: /^ชำระเงิน ฿75/ }).waitFor();
      const draft = await f.page.evaluate(({ user, branch }) => JSON.parse(sessionStorage.getItem(`bbpos.cart:${user.id}:${branch.id}`)), { user, branch });
      assert.equal(f.orders[0].status, 'REFUNDED');
      assert.equal(draft.cart[0].qty, 1);
      assert.deepEqual(draft.cart[0].modifiers, oldOrder.items[0].modifiers);
      assert.equal(draft.cart[0].note, oldOrder.items[0].note);
      assert.equal(draft.cart[0].category, menu[0].category);
      assert.deepEqual(draft.discountRules, []);
      assert.equal(draft.selectedMember, null);
      assert.equal(draft.pointsToUse, '');
      assert.equal(draft.appliedCoupon, null);
      assert.equal(draft.skipPromotions, true);
      assert.deepEqual(f.writes.map(({ endpoint, method }) => ({ endpoint, method })), [{ endpoint: '/orders/51', method: 'PATCH' }]);
      await f.page.getByRole('button', { name: `เพิ่มจำนวน ${menu[0].name}`, exact: true }).click();
      await f.page.getByRole('button', { name: /^ชำระเงิน ฿150/ }).waitFor();
      assert.equal(f.orders[0].items[0].qty, 1);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
    const reopened = await fixture({ refunded: true });
    try {
      await reopened.goto('/orders');
      await reopened.page.getByRole('button', { name: 'เปิดเป็นบิลใหม่', exact: true }).click();
      await reopened.page.waitForURL('**/pos');
      await reopened.page.getByRole('button', { name: /^ชำระเงิน ฿75/ }).waitFor();
      assert.deepEqual(reopened.writes, []);
      assert.equal(reopened.orders[0].status, 'REFUNDED');
    } finally { await reopened.context.close(); }
  });
  for (const [route, title] of [['/parity', 'เอกสาร ภาษี และโปรโมชัน'], ['/admin', 'ภาพรวมทุกสาขา']]) await check(`${route}: cached workspace renders while auth and branch requests never answer`, async () => {
    const f = await fixture({ hangingSession: true });
    try {
      const started = Date.now();
      await f.goto(route);
      await f.page.getByText(title, { exact: true }).last().waitFor({ timeout: 2_000 });
      assert.ok(Date.now() - started < 2_000, 'Cached workspace was blocked by session requests');
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
  await check('reopened bill refreshes add-on prices while preserving the historical bill', async () => {
    const f = await fixture({ refunded: true, currentAddOnPrice: 20 });
    try {
      await f.goto('/orders');
      await f.page.getByRole('button', { name: 'เปิดเป็นบิลใหม่', exact: true }).click();
      await f.page.waitForURL('**/pos');
      await f.page.getByRole('button', { name: /^ชำระเงิน ฿85/ }).waitFor();
      const draft = await f.page.evaluate(({ user, branch }) => JSON.parse(sessionStorage.getItem(`bbpos.cart:${user.id}:${branch.id}`)), { user, branch });
      assert.equal(draft.cart[0].modifiers[0].price, 20);
      assert.equal(f.orders[0].items[0].modifiers[0].price, 10);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  });
  console.log(`Verified ${results.length} UI regression cases with mocked APIs.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await stopped;
  }
}
