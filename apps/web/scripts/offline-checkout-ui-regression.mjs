import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// The actual React providers and pages run in Chromium with fixture API responses only.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.resolve(webDir, '../../output/playwright/offline-checkout');
const user = { id: 6, name: 'ผู้ตรวจทดสอบ', role: 'admin', active: true, branchId: 1 };
const branch = { id: 1, name: 'วัชรเกียรติ ทดสอบ', active: true, branchType: 'coffee' };
const shift = { id: 7, branchId: 1, userId: 6, openingCash: 0, totalSales: 13, totalOrders: 1, cashSales: 13, qrSales: 0, cardSales: 0, status: 'OPEN', openedAt: new Date().toISOString(), closedAt: null };
const items = [35, 70, 70, 13].map((basePrice, index) => ({ id: String(index), menuItemId: index + 1, name: ['ขนม', 'ลาเต้เย็น', 'ชาเขียวเย็น', 'เปปซี่'][index], category: 'เครื่องดื่ม', basePrice, qty: 1, modifiers: [] }));
const bill = { branchId: 1, userId: 6, shiftId: 7, customerId: null, items, paymentMethod: 'QR', paymentDetails: { paymentConfirmed: true }, discountType: null, discountValue: 0, loyaltyPointsToUse: 0, offlineQueueId: 'fixture-queued-188', idempotencyKey: 'fixture-pending-188' };
const makeOrder = (id, orderItems = items, status = 'PAID') => ({ id, branchId: 1, shiftId: 7, userId: 6, customerId: null, createdAt: new Date().toISOString(), status, subtotal: orderItems.reduce((sum, item) => sum + item.basePrice * item.qty, 0), total: orderItems.reduce((sum, item) => sum + item.basePrice * item.qty, 0), tax: 0, discountType: null, discountValue: 0, discountAmount: 0, loyaltyPointsUsed: 0, loyaltyPointsEarned: 0, paymentMethod: 'QR', items: orderItems.map((item, index) => ({ ...item, id: index + 1, lineTotal: item.basePrice * item.qty })) });
const pepsi = makeOrder(13, [items[3]]);
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import '/src/styles.css';
  import '/src/studio.css';
  import { BrowserRouter, Routes, Route } from 'react-router-dom';
  import { AuthProvider, useAuth } from '/src/contexts/AuthContext.tsx';
  import { BranchProvider, useBranch } from '/src/contexts/BranchContext.tsx';
  import { ShiftProvider, useShift } from '/src/contexts/ShiftContext.tsx';
  import { ToastProvider } from '/src/contexts/ToastContext.tsx';
  import { CartProvider, useCart } from '/src/contexts/CartContext.tsx';
  import OfflineStatus from '/src/components/OfflineStatus.tsx';
  import OrdersPage from '/src/pages/OrdersPage.tsx';
  import OrderQueuePage from '/src/pages/OrderQueuePage.tsx';
  function Probe() {
    const cart = useCart();
    window.__cart = { checkout: () => cart.checkout('QR', null, 0, { paymentConfirmed: true }), addItem: cart.addItem };
    return React.createElement('output', { id: 'cart-state', hidden: true, 'data-count': cart.cart.length }, JSON.stringify(cart.cart));
  }
  function Harness() {
    const auth = useAuth(); const branch = useBranch(); const shift = useShift();
    if (!auth.user || !branch.activeBranch || !shift.activeShift) return 'loading';
    return React.createElement(CartProvider, null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, React.createElement(OfflineStatus)), React.createElement(Probe),
      React.createElement(Routes, null,
        React.createElement(Route, { path: '/orders', element: React.createElement(OrdersPage) }),
        React.createElement(Route, { path: '/queue', element: React.createElement(OrderQueuePage) }),
        React.createElement(Route, { path: '/offline-checkout', element: null })));
  }
  createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(AuthProvider, null,
    React.createElement(BranchProvider, null, React.createElement(ShiftProvider, null,
      React.createElement(ToastProvider, null, React.createElement(Harness)))))));
`;
let server;
let browser;
let context;
let mode = 'invalid-sync';
let savedCheckout = null;
const checkoutKeys = [];
const pageErrors = [];
let cancelWrites = 0;

try {
  server = await createServer({
    root: webDir,
    define: { 'import.meta.env.VITE_API_URL': '"/api"' },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'offline-checkout-fixture',
      resolveId(id) { if (id === '/offline-checkout-entry.tsx') return '\0offline-checkout-entry.tsx'; },
      load(id) { if (id === '\0offline-checkout-entry.tsx') return entry; },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!['/offline-checkout', '/orders', '/queue'].includes(req.url)) return next();
          const html = await vite.transformIndexHtml(req.url, '<html><body><div id="root" style="margin-left:400px;width:700px"></div><script type="module" src="/offline-checkout-entry.tsx"></script></body></html>');
          res.setHeader('Content-Type', 'text/html'); res.end(html);
        });
      }
    }]
  });
  await server.listen();
  const webUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: 'Asia/Bangkok' });
  await context.addInitScript(({ user, branch, bill }) => {
    if (!localStorage.getItem('bb_pos_token')) {
      localStorage.setItem('bb_pos_token', 'fixture-only');
      localStorage.setItem('bb_pos_user', JSON.stringify(user));
      localStorage.setItem(`bb_pos_branch_id:${user.id}`, '1');
      localStorage.setItem(`bb_pos_branches_cache:${user.id}`, JSON.stringify([branch]));
      localStorage.setItem('bb_pos_offline_orders', JSON.stringify([bill]));
      sessionStorage.setItem('bbpos.cart:6:1', JSON.stringify({ cart: bill.items }));
    }
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => realSetTimeout(callback, ms >= 5000 ? 50 : ms, ...args);
  }, { user, branch, bill });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== webUrl) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let payload = { items: [] };
    if (url.pathname === '/api/auth/me') payload = { user };
    else if (url.pathname === '/api/branches') payload = { items: [branch] };
    else if (url.pathname === '/api/shifts/current') payload = { shift };
    else if (url.pathname === '/api/orders' && request.method() === 'GET') payload = { items: [pepsi] };
    else if (url.pathname === '/api/orders' && request.method() === 'POST') {
      const input = request.postDataJSON(); checkoutKeys.push(input.idempotencyKey);
      if (mode === 'invalid-sync') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>unexpected response</html>' });
      if (mode === 'unresolved-checkout') return;
      savedCheckout = makeOrder(188);
      if (mode === 'accepted-lost-reply') return;
      payload = { order: savedCheckout };
    } else if (url.pathname.startsWith('/api/orders/idempotency/')) {
      if (!savedCheckout || mode === 'unresolved-checkout') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"ยังไม่พบบิล"}' });
      payload = { order: savedCheckout };
    } else if (url.pathname === '/api/orders/13' && request.method() === 'PATCH') {
      cancelWrites++;
      if (mode === 'cancel-confirmed' || mode === 'ready-confirmed') pepsi.status = request.postDataJSON().status;
      return;
    } else if (url.pathname === '/api/orders/13') payload = { order: pepsi };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${webUrl}/offline-checkout`);
  await page.waitForFunction(() => document.getElementById('cart-state')?.dataset.count === '4');
  await page.getByRole('button', { name: /รอ sync 1/ }).click();
  assert.match(await page.locator('body').innerText(), /รวมราคาสินค้า ฿188\.00/);
  assert.match(await page.locator('body').innerText(), /เปปซี่ × 1/);
  assert.equal(await page.getByRole('button', { name: 'ล้างทิ้ง', exact: true }).count(), 0);
  await page.evaluate(bill => {
    localStorage.setItem('bb_pos_offline_orders', JSON.stringify([bill, { ...bill, offlineQueueId: 'fixture-queued-repeat', idempotencyKey: 'fixture-distinct-repeat' }]));
    window.dispatchEvent(new Event('online'));
  }, bill);
  await page.getByText('มีบิลที่มีสินค้าและวิธีชำระเหมือนกัน 2 บิล กรุณาตรวจสอบจำนวนครั้งที่ขายจริงก่อนส่ง', { exact: true }).waitFor();
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, 'pending-bill-details.png') });
  await page.getByRole('button', { name: 'ส่งบิลที่ค้าง', exact: true }).click();
  await page.getByText(/ยังส่งบิลไม่ได้ 2 บิล/).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bb_pos_offline_orders'))[0].offlineQueueId), bill.offlineQueueId);
  await page.getByText('ยังยืนยันการบันทึกบิลไม่ได้ ข้อมูลบิลยังเก็บไว้ กรุณาลองตรวจสอบอีกครั้ง', { exact: true }).first().waitFor();
  mode = 'responsive';
  await page.getByRole('button', { name: 'ส่งบิลที่ค้าง', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('bb_pos_offline_orders')).length === 0);
  assert.deepEqual(checkoutKeys.slice(-2), [bill.idempotencyKey, 'fixture-distinct-repeat']);
  console.log('PASS pending bill details, similar-bill warning, explicit failed-sync feedback and distinct original identities preserved on retry');

  mode = 'accepted-lost-reply';
  const recovered = await page.evaluate(() => window.__cart.checkout());
  assert.equal(recovered.id, 188);
  await page.waitForFunction(() => document.getElementById('cart-state').dataset.count === '0');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bb_pos_offline_orders')).length), 0);
  console.log('PASS real CartContext recovers a committed checkout after its response times out');

  await page.evaluate(items => items.forEach(item => window.__cart.addItem(item)), items);
  await page.waitForFunction(() => document.getElementById('cart-state').dataset.count === '4');
  mode = 'unresolved-checkout'; savedCheckout = null;
  const error = await page.evaluate(() => window.__cart.checkout().then(() => null, error => error.message));
  assert.match(error, /ยังไม่พบบิล/);
  assert.equal(await page.locator('#cart-state').getAttribute('data-count'), '4');
  const unresolvedKey = checkoutKeys.at(-1);
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bbpos.cart:6:1')).checkoutKey), unresolvedKey);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('cart-state')?.dataset.count === '4');
  mode = 'responsive';
  await page.evaluate(() => window.__cart.checkout());
  assert.equal(checkoutKeys.at(-1), unresolvedKey);
  await page.waitForFunction(() => document.getElementById('cart-state').dataset.count === '0');
  console.log('PASS unresolved checkout preserves its cart and identity through reload and retry');

  assert.deepEqual(pageErrors, []);
  console.log('PASS QR ฿188 browser recovery flows without touching actual orders');
} finally {
  await context?.close(); await browser?.close(); await server?.close();
}
