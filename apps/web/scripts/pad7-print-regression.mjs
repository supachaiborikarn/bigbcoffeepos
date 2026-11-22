import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Actual POS + print center in Chromium; API and external app hand-off are isolated.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const user = { id: 11, name: 'ผู้ทดสอบ', role: 'admin', active: true, branchId: 21 };
const branch = { id: 21, name: 'สาขาทดสอบ', active: true, branchType: 'coffee' };
const shift = { id: 41, branchId: 21, userId: 11, status: 'OPEN', openingCash: 0, totalOrders: 0, totalSales: 0, openedAt: '2026-11-22T01:00:00Z' };
const item = { id: 'test-item', menuItemId: 1, name: 'ขนม & ชา <ไทย>', category: 'ขนม', basePrice: 65, qty: 1, modifiers: [] };
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { BrowserRouter } from 'react-router-dom';
  import { AuthProvider } from '/src/contexts/AuthContext.tsx';
  import { BranchProvider } from '/src/contexts/BranchContext.tsx';
  import { ShiftProvider } from '/src/contexts/ShiftContext.tsx';
  import { ToastProvider } from '/src/contexts/ToastContext.tsx';
  import { CartProvider } from '/src/contexts/CartContext.tsx';
  import POSPage from '/src/pages/POSPage.tsx';
  import PrintCenter from '/src/components/PrintCenter.tsx';
  import * as settings from '/src/utils/printerSettings.ts';
  import { buildEpsonReceiptEscPos, createReceiptJob } from '/src/components/ReceiptPrinter.tsx';
  import { submitPrintJob } from '/src/utils/printJob.ts';
  import * as epson from '/src/utils/epsonPrinter.ts';
  import '/src/styles.css';
  import '/src/studio.css';
  window.__settings = settings;
  window.__createReceiptJob = createReceiptJob;
  window.__buildEpsonReceiptEscPos = buildEpsonReceiptEscPos;
  window.__submitPrintJob = submitPrintJob;
  window.__epson = epson;
  let tree = React.createElement(React.Fragment, null, React.createElement(PrintCenter), React.createElement(POSPage));
  for (const Provider of [CartProvider, ToastProvider, ShiftProvider, BranchProvider, AuthProvider, BrowserRouter]) tree = React.createElement(Provider, null, tree);
  createRoot(document.getElementById('root')).render(tree);
`;
const androidUA = 'Mozilla/5.0 (Linux; Android 15; Xiaomi Pad 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const desktopUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
let server;
let browser;
let writes = 0;
let failCheckout = false;
let releaseCheckout;
let gateCheckout = false;
const errors = [];

try {
  server = await createServer({
    root: webDir, logLevel: 'error',
    define: { 'import.meta.env.VITE_API_URL': '"/api"' },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'pad7-print-fixture',
      resolveId(id) { if (id === '/pad7-entry.tsx') return '\0pad7-entry.tsx'; },
      load(id) { if (id === '\0pad7-entry.tsx') return entry; },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/pos') return next();
          const html = await vite.transformIndexHtml('/pos', '<html><body><div id="root" class="studio-app" data-appearance="light"></div><script type="module" src="/pad7-entry.tsx"></script></body></html>');
          res.setHeader('Content-Type', 'text/html'); res.end(html);
        });
      }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  async function openDevice({ userAgent = androidUA, platform = 'Linux armv8l', touch = 5, saved = {} } = {}) {
    const context = await browser.newContext({ userAgent, viewport: { width: 1280, height: 900 }, hasTouch: touch > 0 });
    await context.addInitScript(({ user, branch, item, platform, touch, saved }) => {
      // The receipt preview is a sandboxed iframe; fixture auth belongs to the app only.
      if (window !== window.top) return;
      Object.defineProperty(navigator, 'platform', { value: platform });
      Object.defineProperty(navigator, 'maxTouchPoints', { value: touch });
      if (!localStorage.getItem('fixture-ready')) {
        localStorage.setItem('bb_pos_token', 'fixture-only');
        localStorage.setItem('bb_pos_user', JSON.stringify(user));
        localStorage.setItem(`bb_pos_branch_id:${user.id}`, String(branch.id));
        localStorage.setItem(`bb_pos_branches_cache:${user.id}`, JSON.stringify([branch]));
        Object.entries(saved).forEach(([key, value]) => localStorage.setItem(key, value));
        localStorage.setItem('fixture-ready', '1');
      }
      window.__dispatches = [];
      window.__popups = 0;
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (/^(tmprintassistant:|intent:)/.test(this.href)) {
          if (window.__failDispatch) throw new Error('fixture hand-off failure');
          window.__dispatches.push(this.href); return;
        }
        return click.call(this);
      };
      const open = window.open.bind(window);
      window.open = (...args) => { window.__popups++; return open(...args); };
    }, { user, branch, item, platform, touch, saved });
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let payload = { items: [] };
      if (url.pathname === '/api/auth/me') payload = { user };
      else if (url.pathname === '/api/branches') payload = { items: [branch] };
      else if (url.pathname === '/api/shifts/current') payload = { shift };
      else if (url.pathname === '/api/menu') payload = { items: [{ ...item, id: 1, active: true, branchType: 'coffee' }] };
      else if (url.pathname === '/api/orders' && request.method() === 'POST') {
        writes++;
        if (gateCheckout) await new Promise(resolve => { releaseCheckout = resolve; });
        if (failCheckout) return route.fulfill({ status: 400, json: { error: 'fixture sale rejected' } });
        payload = { order: { id: 100 + writes, branchId: 21, shiftId: 41, userId: 11, status: 'PAID', createdAt: '2026-11-22T02:00:00Z', subtotal: 65, total: 65, discountAmount: 0, loyaltyPointsUsed: 0, paymentMethod: 'CASH', cashReceived: 100, changeAmount: 35, items: [{ ...item, id: 1, lineTotal: 65 }] } };
      }
      await route.fulfill({ status: 200, json: payload });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/pos`);
    await page.getByRole('button', { name: /^ชำระเงิน/ }).waitFor();
    return { context, page };
  }
  async function pay(page) {
    await page.getByRole('button', { name: /ขนม & ชา <ไทย>/ }).click();
    await page.getByRole('button', { name: /^ชำระเงิน/ }).click();
    await page.getByRole('button', { name: '฿100', exact: true }).click();
    await page.getByRole('button', { name: 'ยืนยันรับเงิน', exact: true }).last().click();
  }

  const { context, page } = await openDevice();
  const defaults = await page.evaluate(() => ({ mode: window.__settings.getPrinterMode(), auto: window.__settings.getAutoPrint() }));
  console.log('Pad 7 defaults:', defaults);
  gateCheckout = true;
  await pay(page);
  await page.waitForFunction(() => document.body.innerText.includes('กำลังบันทึก'));
  assert.equal(await page.evaluate(() => window.__dispatches.length), 0, 'never print before checkout is accepted');
  for (let attempt = 0; !releaseCheckout && attempt < 300; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(releaseCheckout, 'checkout must reach the fixture API');
  releaseCheckout(); gateCheckout = false;
  await page.getByText('บันทึกบิล #101 แล้ว', { exact: false }).waitFor();
  const sent = await page.evaluate(() => window.__dispatches);
  assert.equal(sent.length, 1, 'paid Pad 7 sale must dispatch one print job automatically');
  assert.match(sent[0], /^tmprintassistant:\/\//, 'must use the same Epson app as credit billing');
  assert.equal(await page.evaluate(() => window.__popups), 0, 'Epson must not open a browser print popup');
  assert.equal(defaults.mode, 'epson'); assert.equal(defaults.auto, true);
  const xml = new URL(sent[0]).searchParams.get('data');
  assert.match(xml, /ขนม &amp; ชา &lt;ไทย&gt;/);
  assert.match(xml, /เงินทอน +35\.00/);
  assert.match(xml, /<image width="128" height="176" align="center" mode="mono">[A-Za-z0-9+/=]+<\/image>/);
  assert.match(xml, /<text em="true" \/><text width="1" height="2" \/><text> ยอดสุทธิ +฿65\.00&#10;<\/text>/);
  assert.equal((xml.match(/<cut /g) || []).length, 1);
  assert.match(await page.locator('.printer-status').innerText(), /Epson/);
  console.log('PASS sale saved before Epson hand-off; Thai, totals and one cut preserved; no popup');

  // Retry is a print action only; no second sale is created, including after reload.
  await page.reload();
  await page.getByRole('button', { name: 'ใบเสร็จ / พิมพ์ซ้ำ', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__dispatches.length), 0, 'reload must not print again');
  await page.getByRole('button', { name: 'พิมพ์อีกครั้ง', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__dispatches.length), 1);
  assert.equal(writes, 1, 'print retry must not create a sale');
  await page.getByRole('button', { name: 'ตั้งค่าเครื่องพิมพ์', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: /วิธีพิมพ์/ }).inputValue(), 'epson');
  assert.equal(await page.getByRole('checkbox', { name: 'พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน' }).isChecked(), true);
  await page.getByText(/รายชื่อเครื่องพิมพ์อยู่ในแอป Epson/).waitFor();
  await page.getByRole('button', { name: '80 มม.' }).click();
  await page.getByRole('button', { name: 'พิมพ์ทดสอบ · ไม่มีการขาย' }).click();
  const testUrl = await page.evaluate(() => window.__dispatches.at(-1));
  const testXml = new URL(testUrl).searchParams.get('data');
  assert.match(testXml, /ทดสอบเครื่องพิมพ์/); assert.match(testXml, /ไม่มีการขายหรือรับเงินจริง/);
  assert.match(testXml, /-{40}/, '80 mm uses the wider Epson slip');
  assert.match(testXml, /<image width="128"/);
  assert.equal(writes, 1);
  await page.getByRole('button', { name: 'ตั้งค่าเครื่องพิมพ์', exact: true }).click();
  await page.getByRole('combobox', { name: /วิธีพิมพ์/ }).selectOption('browser');
  assert.equal(await page.getByRole('checkbox', { name: 'พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน' }).isChecked(), false);
  await page.getByRole('combobox', { name: /วิธีพิมพ์/ }).selectOption('epson');
  assert.equal(await page.getByRole('checkbox', { name: 'พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน' }).isChecked(), true);
  await mkdir(path.resolve(webDir, '../../output/playwright/pad7-print'), { recursive: true });
  await page.screenshot({ path: path.resolve(webDir, '../../output/playwright/pad7-print/epson-settings.png') });
  await page.getByRole('checkbox', { name: 'พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน' }).uncheck();
  await page.reload();
  await pay(page);
  await page.getByText('บันทึกบิล #102 แล้ว', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__dispatches.length), 0, 'explicit auto-print off survives reload');
  console.log('PASS persisted job retry and test slip do not create sales; 80 mm and explicit auto-print off survive reload');

  // Check all three oil-service copies, including a long Thai item name and named promotion.
  const formatChecks = await page.evaluate(item => {
    const name = 'ลาเต้เย็นแก้วใหญ่เพิ่มช็อตกาแฟและนมโอ๊ตแบบหวานน้อย';
    const data = {
      order: { id: 301, branchId: 21, createdAt: '2026-11-22T02:00:00Z', appliedDiscounts: [{ label: 'โปรโมชันสำหรับรายการกาแฟและขนมของร้าน', amount: 15.25 }] },
      cart: [item, { ...item, name, basePrice: 1_234.75 }], discountRules: [], subtotal: 1_299.75, discountAmount: 15.25,
      total: 1_284.5, pointsUsed: 0, paymentMethod: 'CASH', cashReceived: 1_500, changeAmount: 215.5,
      copies: 3, copyLabels: ['สำหรับสำนักงาน', 'สำหรับร้าน', 'สำหรับลูกค้า']
    };
    const result = [];
    for (const width of [58, 80]) {
      window.__settings.setPaperWidth(width);
      const job = window.__createReceiptJob(data, 'ทดสอบ');
      const styled = window.__buildEpsonReceiptEscPos(data, 'ทดสอบ', width);
      const xml = window.__epson.buildEpsonPrintXml(styled, true);
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      const text = [...document.querySelectorAll('text')].map(node => node.textContent).join('');
      const prices = text.split('\n').filter(line => /(?:65\.00|1,234\.75|1,299\.75|-15\.25|1,284\.50|1,500\.00|215\.50)$/.test(line) && !line.includes('@'));
      const logo = document.querySelector('image');
      const logoBytes = atob(logo.textContent);
      result.push({
        width: job.widthMm, cuts: document.querySelectorAll('cut').length,
        logoCount: document.querySelectorAll('image').length, logoSize: logoBytes.length, logoHasInk: /[^\x00]/.test(logoBytes),
        logoFirst: logo.previousElementSibling.getAttribute('width') === '1' && !logo.previousElementSibling.textContent,
        invalid: !!document.querySelector('parsererror'), text, prices, name,
        rawControls: /[\x00-\x08\x0b-\x1f]/.test(xml), rawbtUnchanged: !job.escpos.includes('ราคา (บาท)')
      });
    }
    const rejects = input => { try { window.__epson.buildEpsonPrintUrl(input); return false; } catch { return true; } };
    const largeText = '\x1b@' + 'ก'.repeat(20_950);
    const fallback = new URL(window.__epson.buildEpsonPrintUrl(largeText, true)).searchParams.get('data');
    const remaining = window.__buildEpsonReceiptEscPos(data, 'ทดสอบ', 58, 1);
    return {
      result, remaining, longReceiptPreserved: fallback.includes('ก'.repeat(20_950)) && !fallback.includes('<image'),
      oversized: rejects('ก'.repeat(30_000)), unsupported: rejects('\x1bx'), empty: rejects('')
    };
  }, item);
  for (const result of formatChecks.result) {
    assert.equal(result.cuts, 3); assert.equal(result.invalid, false); assert.equal(result.rawControls, false);
    assert.equal(result.logoCount, 3); assert.equal(result.logoSize, 128 * 176 / 8);
    assert.equal(result.logoHasInk, true); assert.equal(result.logoFirst, true); assert.equal(result.rawbtUnchanged, true);
    for (const text of ['สำหรับสำนักงาน', 'สำหรับร้าน', 'สำหรับลูกค้า', item.name, 'เงินทอน']) assert.ok(result.text.includes(text));
    assert.ok(result.text.replace(/\s/g, '').includes(result.name), 'long item name must wrap without losing Thai text');
    assert.equal(result.prices.length, 21, 'seven monetary rows on each of three copies');
    for (const line of result.prices) assert.equal([...line.replace(/\p{M}/gu, '')].length, result.width === 80 ? 41 : 31, line);
  }
  assert.doesNotMatch(formatChecks.remaining, /สำหรับสำนักงาน/);
  assert.match(formatChecks.remaining, /สำหรับร้าน/);
  assert.equal(formatChecks.longReceiptPreserved, true, 'drop only the logo when the URL would be too long');
  assert.equal(formatChecks.oversized, true); assert.equal(formatChecks.unsupported, true); assert.equal(formatChecks.empty, true);
  console.log('PASS 58/80 mm Epson logo and right-aligned amounts, long Thai names, three cuts, remaining copies, RawBT and large-receipt fallback');
  await context.close();

  const desktop = await openDevice({ userAgent: desktopUA });
  assert.deepEqual(await desktop.page.evaluate(() => [window.__settings.getPrinterMode(), window.__settings.getAutoPrint()]), ['epson', true]);
  await pay(desktop.page);
  await desktop.page.getByText('บันทึกบิล #103 แล้ว', { exact: false }).waitFor();
  assert.equal(await desktop.page.evaluate(() => window.__dispatches.length), 1);
  console.log('PASS Pad 7 desktop-site user agent dispatches automatically through Epson');
  await desktop.context.close();

  const profiles = [
    { name: 'saved Browser', saved: { 'bbpos.print.mode': 'browser' }, expected: ['browser', false] },
    { name: 'saved RawBT on desktop-site tablet', userAgent: desktopUA, saved: { 'bbpos.print.mode': 'rawbt' }, expected: ['rawbt', false] },
    { name: 'legacy RawBT on', saved: { 'bbpos.print.rawbt': '1' }, expected: ['rawbt', false] },
    { name: 'legacy RawBT off', saved: { 'bbpos.print.rawbt': '0' }, expected: ['browser', false] },
    { name: 'saved auto off', saved: { 'bbpos.print.auto': '0' }, expected: ['epson', false] },
    { name: 'Linux PC', userAgent: desktopUA, touch: 0, expected: ['browser', false] },
    { name: 'Chromebook', userAgent: 'Mozilla/5.0 (X11; CrOS x86_64) Chrome/131', expected: ['browser', false] },
    { name: 'iPad', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605', platform: 'MacIntel', expected: ['browser', false] },
    { name: 'iPad PassPRNT', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605', platform: 'MacIntel', saved: { 'bbpos.print.mode': 'passprnt' }, expected: ['passprnt', false] },
  ];
  for (const profile of profiles) {
    const device = await openDevice(profile);
    assert.deepEqual(await device.page.evaluate(() => [window.__settings.getPrinterMode(), window.__settings.getAutoPrint()]), profile.expected, profile.name);
    await device.page.evaluate(() => { window.BBPOSNative = { printReceipt() {} }; });
    assert.equal(await device.page.evaluate(() => window.__settings.getPrinterMode()), 'native', 'native bridge retains priority');
    await device.context.close();
  }
  console.log('PASS nine saved/device profiles and native priority preserved');

  const failedSale = await openDevice();
  failCheckout = true;
  await pay(failedSale.page);
  await failedSale.page.getByRole('alert').filter({ hasText: 'fixture sale rejected' }).waitFor();
  assert.equal(await failedSale.page.evaluate(() => window.__dispatches.length), 0, 'failed sale must not print');
  failCheckout = false;
  await failedSale.context.close();

  const failedPrint = await openDevice();
  await failedPrint.page.evaluate(() => { window.__failDispatch = true; });
  await pay(failedPrint.page);
  await failedPrint.page.getByText(`บันทึกบิล #${100 + writes} แล้ว`, { exact: false }).waitFor();
  await failedPrint.page.getByRole('dialog').getByText(/พิมพ์ไม่สำเร็จ: fixture hand-off failure/).waitFor();
  assert.equal(await failedPrint.page.getByText(/ชำระเงินไม่สำเร็จ/).count(), 0);
  const beforeRetry = writes;
  await failedPrint.page.evaluate(() => { window.__failDispatch = false; });
  await failedPrint.page.getByRole('button', { name: 'พิมพ์อีกครั้ง', exact: true }).click();
  assert.equal(writes, beforeRetry); assert.equal(await failedPrint.page.evaluate(() => window.__dispatches.length), 1);
  console.log('PASS rejected checkout never prints; Epson hand-off failure keeps the saved sale and retries without another checkout');
  await failedPrint.context.close();
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server?.close();
}
