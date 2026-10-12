import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// All API traffic is mocked; this check cannot write to the real stock database.
const require = createRequire(import.meta.url);
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(webDir, '../../output/playwright/stock-documents');
const user = { id: 11, name: 'ผู้ตรวจสต็อก', role: 'admin', active: true, branchId: null };
const branch = { id: 21, name: 'สาขาทดสอบสต็อก', active: true, branchType: 'coffee' };
const inventory = [
  { ingredientId: 31, name: 'นมทดสอบ', unit: 'กล่อง', stockQty: 10, reorderLevel: 2, costPerUnit: 50, barcode: 'milk-test' },
  { ingredientId: 32, name: 'เมล็ดกาแฟทดสอบ', unit: 'กก.', stockQty: 5, reorderLevel: 1, costPerUnit: 500 }
];
const timestamp = '2026-10-12T03:00:00.000Z';
let server;
let browser;
let serverOutput = '';
let webUrl;

async function startWeb() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  webUrl = `http://127.0.0.1:${port}`;
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: webDir, env: { ...process.env, VITE_API_URL: `${webUrl}/api` }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (data) => { serverOutput += data.toString(); });
  server.stderr.on('data', (data) => { serverOutput += data.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite stopped: ${serverOutput}`);
    try { if ((await fetch(webUrl)).ok) return; } catch { /* local startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite startup failed: ${serverOutput}`);
}

async function fixture(viewport = { width: 1280, height: 900 }, { ledgerSize = 35, insertDuringExport = false } = {}) {
  const context = await browser.newContext({ viewport });
  const documents = [];
  const writes = [];
  const ledgerQueries = [];
  const pageErrors = [];
  let failNextCreate = false;
  let delayedLedger = null;
  await context.addInitScript(({ user, branch }) => {
    localStorage.setItem('bb_pos_token', 'mock-stock-token');
    localStorage.setItem('bb_pos_user', JSON.stringify(user));
    localStorage.setItem(`bb_pos_branch_id:${user.id}`, String(branch.id));
    localStorage.setItem(`bb_pos_branches_cache:${user.id}`, JSON.stringify([branch]));
    localStorage.setItem('bbpos.appearance', 'light');
  }, { user, branch });
  const ledgerRows = Array.from({ length: ledgerSize }, (_, index) => ({ id: 500 + index, branchId: branch.id, ingredientId: 31, ingredientName: inventory[0].name, unit: 'กล่อง', qty: -1, beforeQty: 10, afterQty: 9, actorName: user.name, kind: 'SALE', reason: `SALE-${700 + index}`, reference: `บิล #${700 + index}`, createdAt: timestamp })).reverse();
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== webUrl) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.slice(4);
    const method = request.method();
    const input = method === 'GET' ? null : request.postDataJSON();
    if (method !== 'GET') writes.push({ endpoint, input });
    let body = { items: [] };
    if (endpoint === '/auth/me') body = { user };
    else if (endpoint === '/branches') body = { items: [branch] };
    else if (endpoint === '/inventory') body = { items: inventory };
    else if (endpoint === '/ingredients') body = { items: inventory.map((item) => ({ ...item, id: item.ingredientId })) };
    else if (endpoint === '/shifts/current') body = { shift: null };
    else if (endpoint === '/settings/store') body = { settings: { branchId: branch.id, shopName: 'ทดสอบ', vatMode: 'INCLUSIVE', vatRate: 7, paymentMethods: ['CASH'] } };
    else if (endpoint === '/cup-stock-settings') body = { settings: [] };
    else if (endpoint === '/recipes/coverage') body = { report: { items: [], summary: { hasRecipe: 0, missingRecipe: 0, notStockTracked: 0, soldMissingRecipe: 0, soldMissingRecipeRevenue: 0 } } };
    else if (endpoint === '/inventory-documents' && method === 'GET') body = { items: documents };
    else if (endpoint === '/inventory-documents' && method === 'POST') {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (failNextCreate) { failNextCreate = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'การเชื่อมต่อขัดข้อง กรุณาลองอีกครั้ง' }) }); }
      const document = { ...input, id: 100 + documents.length, status: input.postImmediately ? 'POSTED' : 'PENDING', requestedByUserId: user.id, requestedByName: user.name, approvedByName: input.postImmediately ? user.name : null, createdAt: timestamp, postedAt: input.postImmediately ? timestamp : null, voidReason: '', items: input.items.map((line) => ({ ...line, ingredientName: inventory.find((item) => item.ingredientId === line.ingredientId)?.name, unit: inventory.find((item) => item.ingredientId === line.ingredientId)?.unit })) };
      documents.unshift(document); body = { document };
    } else if (/^\/inventory-documents\/\d+\/post$/.test(endpoint)) {
      const document = documents.find((candidate) => candidate.id === Number(endpoint.split('/')[2]));
      document.status = 'POSTED'; document.postedAt = timestamp; document.approvedByName = user.name;
      body = { document };
    } else if (/^\/inventory-documents\/\d+\/void$/.test(endpoint)) {
      const document = documents.find((candidate) => candidate.id === Number(endpoint.split('/')[2]));
      document.status = 'VOID'; document.voidReason = input.reason; body = { document };
    } else if (endpoint === '/stock-ledger') {
      const query = Object.fromEntries(url.searchParams);
      ledgerQueries.push(query);
      const snapshotId = query.snapshotId ? Number(query.snapshotId) : Math.max(0, ...ledgerRows.map(row => row.id));
      const selected = ledgerRows.filter(row => row.id <= snapshotId && (!query.kind || query.kind === row.kind));
      const page = Number(query.page || 1), limit = Number(query.limit || 30);
      body = { items: selected.slice((page - 1) * limit, page * limit), total: selected.length, page, limit, snapshotId };
      // Insert after the first export page was selected; subsequent pages must
      // retain its snapshot or the offset will repeat a row and include this row.
      if (insertDuringExport && page === 1 && limit === 100) {
        insertDuringExport = false;
        ledgerRows.unshift({ ...ledgerRows[0], id: snapshotId + 1, reason: 'SALE-NEW-DURING-EXPORT', reference: 'บิลใหม่ระหว่างส่งออก' });
      }
      if (query.kind === 'SALE' && delayedLedger) {
        const waiting = delayedLedger;
        delayedLedger = null;
        waiting.started();
        await waiting.promise;
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto(`${webUrl}/inventory?tab=ingredients`);
  try { await page.getByRole('tab', { name: 'เบิก / ย้ายที่เก็บ' }).click(); }
  catch (err) { console.error({ url: page.url(), errors: pageErrors, content: (await page.locator('body').innerText()).slice(0, 1600) }); throw err; }
  await page.getByText('สร้างใบเบิก / ย้ายที่เก็บ', { exact: true }).waitFor();
  return { context, page, documents, writes, ledgerQueries, ledgerRows, pageErrors, failCreate: () => { failNextCreate = true; }, delayLedger: () => {
    let release, started;
    const promise = new Promise((resolve) => { release = resolve; });
    const startedPromise = new Promise((resolve) => { started = resolve; });
    delayedLedger = { promise, started };
    return { release, startedPromise };
  } };
}

async function addLine(page, name, amount) {
  await page.getByRole('textbox', { name: 'ค้นหาสินค้าในใบเบิก' }).fill(name);
  await page.locator('.stock-docs__matches').getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('spinbutton', { name: `จำนวน ${name}` }).fill(String(amount));
}

async function screenshot(page, selector, filename) {
  while (await page.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).count()) await page.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).first().click();
  await page.locator(selector).evaluate((element) => {
    const container = element.closest('.inventory-workspace') ?? element.closest('.app-layout__content');
    if (container) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
  });
  await page.screenshot({ path: path.join(outputDir, filename) });
}

try {
  await fs.mkdir(outputDir, { recursive: true });
  await startWeb();
  browser = await chromium.launch({ headless: true });
  const f = await fixture();
  try {
    const { page } = f;
    await page.getByLabel('จากที่เก็บ *').fill('คลังหลังร้าน');
    await page.getByLabel('ไปที่เก็บ *').fill('คลังหลังร้าน');
    await addLine(page, 'นมทดสอบ', 2);
    assert.equal(await page.getByRole('button', { name: 'ส่งใบขออนุมัติ', exact: true }).isEnabled(), false);
    await page.getByLabel('ไปที่เก็บ *').fill('เคาน์เตอร์กาแฟ');
    f.failCreate();
    await page.getByRole('button', { name: 'ส่งใบขออนุมัติ', exact: true }).click();
    await page.getByText('การเชื่อมต่อขัดข้อง กรุณาลองอีกครั้ง').first().waitFor();
    assert.equal(f.documents.length, 0);
    await page.getByRole('button', { name: 'ส่งใบขออนุมัติ', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'อนุมัติการย้าย', exact: true }).waitFor();
    assert.equal(f.writes.filter((write) => write.endpoint === '/inventory-documents').length, 2);
    assert.equal(f.writes[0].input.requestKey, f.writes[1].input.requestKey);
    assert.equal(f.documents[0].kind, 'MOVE');
    assert.equal(f.documents[0].status, 'PENDING');
    assert.equal(f.writes[1].input.postImmediately, false);
    await page.getByRole('button', { name: 'อนุมัติการย้าย', exact: true }).click();
    await page.getByRole('article').getByText('บันทึกแล้ว', { exact: true }).waitFor();
    assert.equal(f.documents[0].status, 'POSTED');
    await page.getByRole('button', { name: 'ยกเลิกใบ', exact: true }).click();
    await page.getByLabel('เหตุผลที่ยกเลิก *').fill('ลงที่เก็บผิด');
    await page.getByRole('button', { name: 'ยืนยันยกเลิกใบ', exact: true }).click();
    await page.getByText('เหตุผลที่ยกเลิก: ลงที่เก็บผิด', { exact: true }).waitFor();
    assert.equal(f.documents[0].status, 'VOID');
    console.log('PASS MOVE validates locations, keeps stable retry key, blocks double submit, approves and voids');

    await page.getByRole('button', { name: 'เบิกใช้', exact: true }).click();
    await page.getByLabel('เหตุผล *', { exact: true }).fill('ชงให้พนักงาน');
    await addLine(page, 'นมทดสอบ', 11);
    await page.getByRole('checkbox', { name: 'อนุมัติและตัดสต็อกทันที' }).check();
    assert.equal(await page.getByRole('button', { name: 'บันทึกทันที', exact: true }).isEnabled(), false);
    await page.getByRole('spinbutton', { name: 'จำนวน นมทดสอบ' }).fill('1');
    await addLine(page, 'เมล็ดกาแฟทดสอบ', 0.1);
    await page.getByRole('button', { name: 'บันทึกทันที', exact: true }).click();
    await page.getByText('#101 · เบิกใช้', { exact: true }).waitFor();
    assert.equal(f.documents[0].items.length, 2);
    assert.equal(f.documents[0].status, 'POSTED');
    assert.notEqual(f.writes.findLast((write) => write.endpoint === '/inventory-documents').input.requestKey, f.writes[0].input.requestKey);
    await screenshot(page, '.stock-docs', 'stock-documents-desktop.png');
    console.log('PASS USE rejects excess immediately and submits multiple items');

    await page.getByRole('tab', { name: 'ประวัติสต็อก', exact: true }).click();
    await page.getByText('1–30 จาก 35 รายการ', { exact: true }).waitFor();
    assert.equal(await page.locator('.stock-ledger__table tbody tr').count(), 30);
    await page.getByRole('button', { name: 'ประวัติหน้าถัดไป' }).click();
    await page.getByText('31–35 จาก 35 รายการ', { exact: true }).waitFor();
    assert.equal(await page.locator('.stock-ledger__table tbody tr').count(), 5);
    await page.getByLabel('ตั้งแต่วันที่').fill('2026-10-12');
    await page.getByLabel('ถึงวันที่').fill('2026-10-11');
    await page.getByText('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด', { exact: true }).waitFor();
    await page.getByLabel('ถึงวันที่').fill('2026-10-12');
    await page.getByText('1–30 จาก 35 รายการ', { exact: true }).waitFor();
    const latestQuery = f.ledgerQueries.at(-1);
    assert.equal(latestQuery.from, '2026-10-12');
    assert.equal(latestQuery.to, '2026-10-12');
    const delayed = f.delayLedger();
    await page.getByLabel('ประเภท', { exact: true }).selectOption('SALE');
    await delayed.startedPromise;
    await page.getByLabel('ประเภท', { exact: true }).selectOption('LOSS');
    await page.getByText('ไม่มีประวัติที่ตรงกับตัวกรอง', { exact: true }).waitFor();
    delayed.release();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.stock-ledger__table tbody tr').count(), 1);
    assert.equal(await page.getByText('ไม่มีประวัติที่ตรงกับตัวกรอง', { exact: true }).isVisible(), true);
    await page.getByLabel('ประเภท', { exact: true }).selectOption('');
    await page.getByText('1–30 จาก 35 รายการ', { exact: true }).waitFor();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ส่งออก CSV', exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = path.join(outputDir, 'stock-ledger.csv');
    await download.saveAs(downloadPath);
    const csv = await fs.readFile(downloadPath, 'utf8');
    assert.equal(csv.trim().split('\n').length, 36);
    assert.ok(csv.includes('"ก่อน","หลัง"'));
    await screenshot(page, '.stock-ledger', 'stock-ledger-desktop.png');
    assert.deepEqual(f.pageErrors, []);
    console.log('PASS ledger includes sales, paginates, rejects reversed dates, ignores stale replies and exports all rows');
  } finally { await f.context.close(); }

  const concurrentExport = await fixture(undefined, { ledgerSize: 135, insertDuringExport: true });
  try {
    const { page, ledgerRows } = concurrentExport;
    await page.getByRole('tab', { name: 'ประวัติสต็อก', exact: true }).click();
    await page.getByText('1–30 จาก 135 รายการ', { exact: true }).waitFor();
    const originalReasons = ledgerRows.map(row => row.reason);
    const originalSnapshot = Math.max(...ledgerRows.map(row => row.id));
    const queryStart = concurrentExport.ledgerQueries.length;
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ส่งออก CSV', exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = path.join(outputDir, 'stock-ledger-snapshot.csv');
    await download.saveAs(downloadPath);
    const csv = await fs.readFile(downloadPath, 'utf8');
    const lines = csv.trim().split('\n');
    const exportedReasons = lines.slice(1).map(line => {
      const match = /"(SALE-[^"]+)"/.exec(line);
      assert.ok(match, 'every exported row must have its unique sale reference');
      return match[1];
    });
    assert.equal(ledgerRows.length, 136, 'the concurrent insert must actually occur');
    assert.equal(exportedReasons.length, 135);
    assert.equal(new Set(exportedReasons).size, 135, 'no original row may repeat across export pages');
    assert.deepEqual(exportedReasons, originalReasons, 'all original rows must remain in the export in order');
    assert.equal(csv.includes('SALE-NEW-DURING-EXPORT'), false);
    assert.equal(csv.includes('บิลใหม่ระหว่างส่งออก'), false);
    const exportQueries = concurrentExport.ledgerQueries.slice(queryStart).filter(query => query.limit === '100');
    assert.equal(exportQueries.length, 2);
    assert.equal(exportQueries[0].page, '1');
    assert.equal(exportQueries[1].page, '2');
    assert.equal(exportQueries[1].snapshotId, String(originalSnapshot), 'later pages must send the first page snapshotId');
    assert.deepEqual(concurrentExport.pageErrors, []);
    console.log('PASS CSV snapshot exports all 135 original rows once and excludes a new row inserted between pages 1 and 2');
  } finally { await concurrentExport.context.close(); }

  const mobile = await fixture({ width: 390, height: 844 });
  try {
    await addLine(mobile.page, 'นมทดสอบ', 1);
    await screenshot(mobile.page, '.stock-docs', 'stock-documents-mobile.png');
    const overflows = await mobile.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflows, false);
    assert.deepEqual(mobile.pageErrors, []);
    console.log('PASS mobile stock document form fits 390px screen');
  } finally { await mobile.context.close(); }
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
