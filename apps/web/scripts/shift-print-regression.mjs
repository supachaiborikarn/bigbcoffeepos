import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real TopBar in Chromium with a mocked API: close a shift, pick 58/80 mm in the
// summary modal and check the print job PrintCenter receives uses that width.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const user = { id: 11, name: 'ผู้ตรวจทดสอบ', role: 'admin', active: true, branchId: null };
const branches = [{ id: 21, name: 'สาขาทดสอบ 21', active: true, branchType: 'coffee' }];
const shift = { id: 41, branchId: 21, userId: 11, openingCash: 0, closingCash: null, expectedCash: null, difference: null, totalSales: 65, totalOrders: 1, cashSales: 0, qrSales: 65, cardSales: 0, status: 'OPEN', openedAt: '2026-10-12T01:00:00.000Z', closedAt: null };
const summary = (closed) => ({
  shift: closed ? { ...shift, status: 'CLOSED', closedAt: '2026-10-12T10:00:00.000Z', closingCash: 0 } : shift,
  branch: { id: 21, name: 'สาขาทดสอบ 21' }, user: { id: 11, name: 'ผู้ตรวจทดสอบ', role: 'admin' },
  openedAt: shift.openedAt, closedAt: closed ? '2026-10-12T10:00:00.000Z' : null, durationMinutes: 540,
  totals: { totalSales: 65, subtotal: 65, discountAmount: 0, loyaltyPointsUsed: 0, tax: 0, totalOrders: 1, averageTicket: 65, paidOrders: 1, readyOrders: 0 },
  cash: { openingCash: 0, cashSales: 0, paidOut: 0, paidIn: 0, entries: [], expectedCash: 0, closingCash: closed ? 0 : null, difference: closed ? 0 : null },
  closeDetails: closed ? { cashCounts: {}, note: null, closedBy: { id: 11, name: 'ผู้ตรวจทดสอบ' } } : undefined,
  payments: [{ method: 'QR', total: 65, count: 1 }], topItems: [], orders: []
});
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { AuthProvider } from '/src/contexts/AuthContext.tsx';
  import { BranchProvider } from '/src/contexts/BranchContext.tsx';
  import { ShiftProvider } from '/src/contexts/ShiftContext.tsx';
  import { ToastProvider } from '/src/contexts/ToastContext.tsx';
  import TopBar from '/src/components/layout/TopBar.tsx';
  import { registerPrintReceiver } from '/src/utils/printJob.ts';
  import '/src/styles.css';
  import '/src/studio.css';
  window.__jobs = [];
  registerPrintReceiver((job, popup) => { popup?.close(); window.__jobs.push({ widthMm: job.widthMm, title: job.title, html: job.html, documents: job.documents, escpos: job.escpos }); });
  const tree = React.createElement(TopBar, { onOpenMenu() {}, mobileOpen: false, appearance: 'light', onToggleAppearance() {} });
  createRoot(document.getElementById('root')).render(React.createElement(AuthProvider, null, React.createElement(BranchProvider, null, React.createElement(ShiftProvider, null, React.createElement(ToastProvider, null, React.createElement('div', { className: 'app-layout studio-app', 'data-appearance': 'light' }, tree))))));
`;
let server;
let browser;
let context;
const pageErrors = [];
let closed = false;

try {
  server = await createServer({
    root: webDir,
    logLevel: 'error',
    define: { 'import.meta.env.VITE_API_URL': '"/api"' },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'shift-print-fixture',
      resolveId(id) { if (id === '/shift-print-entry.tsx') return '\0shift-print-entry.tsx'; },
      load(id) { if (id === '\0shift-print-entry.tsx') return entry; },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/shift-print') return next();
          const html = await vite.transformIndexHtml('/shift-print', '<html><body><div id="root"></div><script type="module" src="/shift-print-entry.tsx"></script></body></html>');
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        });
      }
    }]
  });
  await server.listen();
  const webUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ user, branches }) => {
    localStorage.setItem('bb_pos_token', 'fixture-token');
    localStorage.setItem('bb_pos_user', JSON.stringify(user));
    localStorage.setItem(`bb_pos_branch_id:${user.id}`, '21');
    localStorage.setItem(`bb_pos_branches_cache:${user.id}`, JSON.stringify(branches));
    localStorage.setItem('bbpos.print.mode', 'browser');
    // Init scripts also run in the print popup; don't reset the width chosen in the test.
    if (!localStorage.getItem('bbpos.print.width')) localStorage.setItem('bbpos.print.width', '80');
  }, { user, branches });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== webUrl) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let payload;
    if (url.pathname === '/api/auth/me') payload = { user };
    else if (url.pathname === '/api/branches') payload = { items: branches };
    else if (url.pathname === '/api/shifts/current') payload = { shift: closed ? null : shift };
    else if (url.pathname === '/api/shifts/41/summary') payload = { summary: summary(closed) };
    else if (url.pathname === '/api/shifts/41/close') { closed = true; payload = { shift: summary(true).shift, summary: summary(true) }; }
    else payload = {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${webUrl}/shift-print`);

  await page.getByRole('button', { name: 'ปิดกะ', exact: true }).click();
  await page.getByRole('button', { name: 'ยืนยันปิดกะ' }).click();
  const picker = page.getByRole('group', { name: 'ขนาดกระดาษ' });
  await picker.waitFor();
  assert.equal(await picker.getByRole('button', { name: '80 มม.' }).getAttribute('aria-pressed'), 'true', 'picker starts on the saved width');

  await picker.getByRole('button', { name: '58 มม.' }).click();
  assert.equal(await picker.getByRole('button', { name: '58 มม.' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('bbpos.print.width')), '58', 'choice is saved to printer settings');
  await page.getByRole('button', { name: 'พิมพ์สรุปกะ' }).click();
  await page.waitForFunction(() => window.__jobs.length === 1);

  await picker.getByRole('button', { name: '80 มม.' }).click();
  await page.getByRole('button', { name: 'พิมพ์สรุปกะ' }).click();
  await page.waitForFunction(() => window.__jobs.length === 2);

  const [job58, job80] = await page.evaluate(() => window.__jobs);
  assert.equal(job58.widthMm, 58);
  assert.match(job58.html, /size: 58mm auto/);
  assert.match(job58.html, /\.slip \{ width: 48mm/);
  assert.match(job58.title, /รายงานปิดกะ #41/);
  assert.ok(job58.escpos.includes('รายงานปิดกะ #41'));
  assert.equal(job80.widthMm, 80);
  assert.match(job80.html, /size: 80mm auto/);
  assert.match(job80.html, /\.slip \{ width: 72mm/);
  assert.equal(await page.locator('.shift-print').count(), 0, 'old in-page print block is gone');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  assert.deepEqual(pageErrors, []);
  console.log('PASS shift print: close-shift summary has a 58/80 mm picker saved to printer settings; print sends a PrintCenter job at the chosen width (48 / 72 mm printable); real TopBar, mocked API only');
} finally {
  await context?.close();
  await browser?.close();
  await server?.close();
}
