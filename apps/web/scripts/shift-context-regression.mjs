import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// The real React providers run in Chromium; every API request uses local fixtures.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const user = { id: 11, name: 'ผู้ตรวจทดสอบ', role: 'admin', active: true, branchId: null };
const branches = [21, 22].map(id => ({ id, name: `สาขาทดสอบ ${id}`, active: true, branchType: 'coffee' }));
const makeShift = (id, branchId = 21) => ({ id, branchId, userId: 11, openingCash: 0, closingCash: null, expectedCash: null, difference: null, totalSales: 65, totalOrders: 1, cashSales: 65, qrSales: 0, cardSales: 0, status: 'OPEN', openedAt: '2026-10-10T08:00:00.000Z', closedAt: null });
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { AuthProvider } from '/src/contexts/AuthContext.tsx';
  import { BranchProvider, useBranch } from '/src/contexts/BranchContext.tsx';
  import { ShiftProvider, useShift } from '/src/contexts/ShiftContext.tsx';
  function Probe() {
    const shift = useShift();
    const branch = useBranch();
    window.__shift = { refresh: shift.refreshShift, open: () => shift.openShift(0), close: () => shift.closeShift(0), select: branch.setBranchId };
    return React.createElement('output', { id: 'shift-state', 'data-shift': shift.activeShift?.id ?? '', 'data-branch': branch.activeBranch?.id ?? '', 'data-loaded': String(shift.loaded) }, JSON.stringify({ id: shift.activeShift?.id ?? null, loading: shift.loading, loaded: shift.loaded }));
  }
  createRoot(document.getElementById('root')).render(React.createElement(AuthProvider, null, React.createElement(BranchProvider, null, React.createElement(ShiftProvider, null, React.createElement(Probe)))));
`;
let server;
let browser;
let context;
const heldReads = [];
const pageErrors = [];
const currentShifts = new Map([[21, makeShift(41)], [22, makeShift(44, 22)]]);
let holdNextRead = false;
let nextOpenId = 43;
let malformedClose = false;
let readCount = 0;

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function waitState(page, id, branchId = 21) {
  await page.waitForFunction(({ id, branchId }) => {
    const state = document.getElementById('shift-state');
    return state?.dataset.shift === String(id ?? '') && state.dataset.branch === String(branchId) && state.dataset.loaded === 'true';
  }, { id, branchId }, { timeout: 5000 });
}
async function holdRefresh(page) {
  holdNextRead = true;
  await page.evaluate(() => { void window.__shift.refresh(); });
  await waitUntil(() => heldReads.length > 0, 'the fixture did not receive the refresh');
  return heldReads.shift();
}
async function releaseRead(page, held) {
  await held.route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(held.payload) });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

try {
  server = await createServer({
    root: webDir,
    define: { 'import.meta.env.VITE_API_URL': '"/api"' },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'shift-regression-fixture',
      resolveId(id) { if (id === '/shift-regression-entry.tsx') return '\0shift-regression-entry.tsx'; },
      load(id) { if (id === '\0shift-regression-entry.tsx') return entry; },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/shift-regression') return next();
          const html = await vite.transformIndexHtml('/shift-regression', '<html><body><div id="root"></div><script type="module" src="/shift-regression-entry.tsx"></script></body></html>');
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        });
      }
    }]
  });
  await server.listen();
  const webUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await context.addInitScript(({ user, branches }) => {
    localStorage.setItem('bb_pos_token', 'fixture-token');
    localStorage.setItem('bb_pos_user', JSON.stringify(user));
    localStorage.setItem(`bb_pos_branch_id:${user.id}`, '21');
    localStorage.setItem(`bb_pos_branches_cache:${user.id}`, JSON.stringify(branches));
  }, { user, branches });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== webUrl) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let payload;
    if (url.pathname === '/api/auth/me') payload = { user };
    else if (url.pathname === '/api/branches') payload = { items: branches };
    else if (url.pathname === '/api/shifts/current') {
      readCount++;
      payload = { shift: structuredClone(currentShifts.get(Number(url.searchParams.get('branchId'))) ?? null) };
      if (holdNextRead) { holdNextRead = false; heldReads.push({ route, payload }); return; }
    } else if (url.pathname === '/api/shifts/open') {
      const shift = makeShift(nextOpenId++, request.postDataJSON().branchId);
      currentShifts.set(shift.branchId, shift);
      payload = { shift };
    } else if (/^\/api\/shifts\/\d+\/close$/.test(url.pathname)) {
      if (malformedClose) { malformedClose = false; return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>wrong API routing</html>' }); }
      const id = Number(url.pathname.split('/')[3]);
      const shift = [...currentShifts.values()].find(shift => shift?.id === id);
      assert.ok(shift, 'the test must close an existing fixture shift');
      currentShifts.set(shift.branchId, null);
      payload = { shift: { ...shift, status: 'CLOSED', closedAt: '2026-10-11T08:00:00.000Z' } };
    } else throw new Error(`Unexpected API request: ${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${webUrl}/shift-regression`);
  await waitState(page, 41);

  malformedClose = true;
  const error = await page.evaluate(() => window.__shift.close().then(() => null, error => error.message));
  assert.match(error, /ยังยืนยันการปิดกะไม่ได้/);
  await waitState(page, 41);

  const beforeClose = await holdRefresh(page);
  await page.evaluate(() => window.__shift.close());
  await waitState(page, null);
  await releaseRead(page, beforeClose);
  await page.waitForFunction(() => !JSON.parse(document.getElementById('shift-state').textContent).loading);
  assert.equal(await page.locator('#shift-state').getAttribute('data-shift'), '', 'late refresh must not restore the closed shift');

  const beforeOpen = await holdRefresh(page);
  await page.evaluate(() => window.__shift.open());
  await waitState(page, 43);
  await releaseRead(page, beforeOpen);
  assert.equal(await page.locator('#shift-state').getAttribute('data-shift'), '43', 'late empty refresh must not erase the newly opened shift');

  const beforeSwitch = await holdRefresh(page);
  await page.evaluate(() => window.__shift.select(22));
  await waitState(page, 44, 22);
  await releaseRead(page, beforeSwitch);
  assert.equal(await page.locator('#shift-state').getAttribute('data-shift'), '44', 'the previous branch must not replace the new branch shift');

  currentShifts.set(22, null); // Another terminal closed this shift.
  const beforeFocus = readCount;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await waitState(page, null, 22);
  assert.ok(readCount > beforeFocus, 'returning to the screen must recheck the server');
  currentShifts.set(22, makeShift(45, 22));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitState(page, 45, 22);

  const firstRefresh = await holdRefresh(page);
  currentShifts.set(22, makeShift(46, 22));
  await page.evaluate(() => window.__shift.refresh());
  await waitState(page, 46, 22);
  await releaseRead(page, firstRefresh);
  assert.equal(await page.locator('#shift-state').getAttribute('data-shift'), '46', 'out of order reads must retain the latest server result');
  assert.deepEqual(pageErrors, []);
  console.log('PASS shift context: invalid close keeps the shift; stale reads cannot overwrite close, open, branch switch or later refresh; focus and visibility recheck; real React and Chromium, mocked API only');
} finally {
  await context?.close();
  await browser?.close();
  await server?.close();
}
