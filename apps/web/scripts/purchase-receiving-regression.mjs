import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// All API requests are intercepted; this regression never changes real stock.
const require = createRequire(import.meta.url);
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(webDir, '../../output/playwright/receiving');
const user = { id: 11, name: 'ผู้ทดสอบ', role: 'admin', active: true, branchId: null };
const branches = [21, 22].map((id) => ({ id, name: `สาขาทดสอบ ${id}`, active: true, branchType: 'coffee', location: 'ทดสอบ' }));
const ingredient = { id: 101, name: 'นมทดสอบ', unit: 'ขวด', costPerUnit: 10, barcode: '8850000000101', createdAt: '2026-10-12T00:00:00.000Z' };
const imageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6UaMAAAAASUVORK5CYII=', 'base64');
const writes = [];
const requests = [];
const pageErrors = [];
const purchases = [];
const attachments = new Map();
let nextPurchase = 1;
let failNextCreate = true;
let failNextReceive = true;
let server;
let browser;
let serverOutput = '';
let webUrl;

async function startServer() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  webUrl = `http://127.0.0.1:${port}`;
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: webDir, env: { ...process.env, VITE_API_URL: `${webUrl}/api` }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (value) => { serverOutput += value; });
  server.stderr.on('data', (value) => { serverOutput += value; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Vite exited: ${serverOutput}`);
    try { if ((await fetch(webUrl)).ok) return; } catch { /* Only this isolated local server. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite failed to start: ${serverOutput}`);
}

async function check(name, callback) { await callback(); console.log(`PASS ${name}`); }
async function addLine(page) {
  await page.getByLabel('ค้นหาหรือสแกนบาร์โค้ดสินค้าที่รับเข้า').fill('นม');
  await page.locator('#rcv-matches').getByRole('option', { name: /นมทดสอบ/ }).click();
  await page.getByLabel('จำนวนรับเข้า นมทดสอบ', { exact: true }).fill('2');
  await page.getByLabel('จำนวนขวดต่อหน่วยซื้อ (เช่น ลัง) นมทดสอบ', { exact: true }).fill('12');
  await page.getByLabel('ต้นทุนต่อหน่วย นมทดสอบ', { exact: true }).fill('144');
}

try {
  await startServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ user, branches }) => {
    if (!localStorage.getItem('bb_pos_token')) {
      localStorage.setItem('bb_pos_token', 'receiving-fixture');
      localStorage.setItem('bb_pos_user', JSON.stringify(user));
      localStorage.setItem(`bb_pos_branch_id:${user.id}`, String(branches[0].id));
      localStorage.setItem(`bb_pos_branches_cache:${user.id}`, JSON.stringify(branches));
      localStorage.setItem('bbpos.appearance', 'light');
    }
  }, { user, branches });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== webUrl) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.slice(4);
    const method = request.method();
    const input = method === 'GET' ? null : request.postDataJSON();
    requests.push({ endpoint, method, query: Object.fromEntries(url.searchParams) });
    if (input) writes.push({ endpoint, method, input });
    let body = { items: [] };
    let status = 200;
    if (endpoint === '/auth/me') body = { user };
    else if (endpoint === '/branches') body = { items: branches };
    else if (endpoint === '/ingredients') body = { items: [ingredient] };
    else if (endpoint === '/inventory') body = { items: [{ ...ingredient, ingredientId: ingredient.id, stockQty: 5, reorderLevel: 2 }] };
    else if (endpoint === '/cup-stock-settings') body = { settings: [] };
    else if (endpoint === '/settings/store') body = { settings: { branchId: 21, shopName: 'ทดสอบ', paymentMethods: ['CASH'], vatMode: 'NONE', vatRate: 0 } };
    else if (endpoint === '/shifts/current') body = { shift: null };
    else if (endpoint === '/recipes/coverage') body = { report: { summary: { totalMenuItems: 0, activeMenuItems: 0, hasRecipe: 0, missingRecipe: 0, notStockTracked: 0, soldMissingRecipe: 0, soldMissingRecipeQty: 0, soldMissingRecipeRevenue: 0 }, items: [] } };
    else if (endpoint === '/purchases' && method === 'GET') {
      let items = purchases.filter((po) => !url.searchParams.get('branchId') || po.branchId === Number(url.searchParams.get('branchId')));
      if (url.searchParams.get('status')) items = items.filter((po) => po.status === url.searchParams.get('status'));
      if (url.searchParams.get('query')) items = items.filter((po) => [po.invoiceNumber, po.supplier, po.note].some((text) => text?.toLowerCase().includes(url.searchParams.get('query').toLowerCase())));
      body = { items: [...items].reverse() };
    } else if (endpoint === '/purchases' && method === 'POST') {
      if (failNextCreate) { failNextCreate = false; status = 503; body = { error: 'ทดสอบการลองบันทึกใหม่' }; }
      else if (purchases.some((po) => po.status !== 'VOID' && po.branchId === input.branchId && po.supplier === input.supplier && po.invoiceNumber === input.invoiceNumber)) { status = 409; body = { error: 'เลขบิลนี้บันทึกไว้แล้ว กรุณาตรวจบิลเดิม' }; }
      else {
        const now = '2026-10-12T08:00:00.000Z';
        const po = { ...input, id: nextPurchase++, kind: input.mode, status: input.mode === 'ORDER' ? 'PENDING' : 'RECEIVED', createdAt: now, receivedAt: input.mode === 'ORDER' ? null : input.receivedAt || now, hasAttachment: !!input.attachmentDataUrl, totalCost: input.items.reduce((sum, item) => sum + item.qty * item.unitCost, 0), receipts: [], items: input.items.map((item, index) => ({ ...item, id: nextPurchase * 100 + index, ingredientName: ingredient.name, unit: ingredient.unit, receivedQty: input.mode === 'ORDER' ? 0 : item.qty })) };
        if (po.hasAttachment) attachments.set(po.id, { attachmentName: input.attachmentName, attachmentDataUrl: input.attachmentDataUrl });
        delete po.attachmentDataUrl;
        purchases.push(po);
        body = { purchase: po };
      }
    } else if (/^\/purchases\/\d+\/attachment$/.test(endpoint)) body = attachments.get(Number(endpoint.split('/')[2]));
    else if (/^\/purchases\/\d+\/approve$/.test(endpoint)) {
      const po = purchases.find((item) => item.id === Number(endpoint.split('/')[2]));
      po.status = 'APPROVED'; po.approvedAt = '2026-10-12T08:15:00.000Z'; body = { purchase: po };
    } else if (/^\/purchases\/\d+\/void$/.test(endpoint)) {
      const po = purchases.find((item) => item.id === Number(endpoint.split('/')[2]));
      po.status = 'VOID'; po.voidReason = input.reason; body = { purchase: po };
    } else if (/^\/purchases\/\d+\/receive$/.test(endpoint)) {
      if (failNextReceive) { failNextReceive = false; status = 503; body = { error: 'ทดสอบการรับของซ้ำเมื่อเครือข่ายขัดข้อง' }; }
      else {
        const po = purchases.find((item) => item.id === Number(endpoint.split('/')[2]));
        for (const item of input.items) po.items.find((line) => line.id === item.purchaseItemId).receivedQty += item.qty;
        po.receivedAt = input.receivedAt || '2026-10-12T08:30:00.000Z';
        po.status = po.items.every((item) => item.receivedQty === item.qty) ? 'RECEIVED' : 'PARTIAL';
        po.receipts.push({ id: po.receipts.length + 1, receivedAt: po.receivedAt, createdAt: po.receivedAt, items: input.items });
        body = { purchase: po };
      }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? dialog.defaultValue() || 'แก้ไขรายการทดสอบ' : undefined));
  await page.goto(`${webUrl}/inventory?tab=movements`);
  await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).waitFor();
  await check('packs, bill image and retry draft survive reload', async () => {
    await page.getByLabel('ผู้ขาย / ซัพพลายเออร์', { exact: true }).fill('ร้านทดสอบ');
    await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).fill('INV-001');
    await addLine(page);
    await page.getByLabel('ค้นหาหรือสแกนบาร์โค้ดสินค้าที่รับเข้า').fill(ingredient.barcode);
    await page.getByLabel('ค้นหาหรือสแกนบาร์โค้ดสินค้าที่รับเข้า').press('Enter');
    assert.equal(await page.locator('.rcv-row .stk-name small').first().textContent(), 'คงเหลือ 5 → 30 ขวด');
    await page.getByLabel('จำนวนรับเข้า นมทดสอบ', { exact: true }).fill('2');
    await page.getByRole('checkbox', { name: /อัปเดตทุนแบบถัวเฉลี่ย/ }).uncheck();
    await page.getByLabel('แนบภาพบิลส่งของ', { exact: true }).setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: imageBuffer });
    await page.locator('.rcv-attachment__preview img').waitFor();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('bbpos.purchase.draft:21')));
    await page.reload();
    assert.equal(await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).inputValue(), 'INV-001');
    assert.equal(await page.getByLabel('จำนวนรับเข้า นมทดสอบ', { exact: true }).inputValue(), '2');
    assert.equal(await page.getByRole('checkbox', { name: /อัปเดตทุนแบบถัวเฉลี่ย/ }).isChecked(), false);
    assert.equal(await page.locator('.rcv-attachment__preview img').getAttribute('src'), before.attachmentDataUrl);
    await page.getByRole('button', { name: 'รับเข้าสต็อก', exact: true }).click();
    await page.getByText('ทดสอบการลองบันทึกใหม่', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'รับเข้าสต็อก', exact: true }).click();
    await page.getByText('รับสินค้าเข้าสต็อกแล้ว 1 รายการ', { exact: false }).waitFor();
    const creates = writes.filter((item) => item.endpoint === '/purchases');
    assert.equal(creates[0].input.requestKey, before.requestKey);
    assert.equal(creates[0].input.requestKey, creates[1].input.requestKey);
    assert.equal(creates[1].input.items[0].qty, 24);
    assert.equal(creates[1].input.items[0].unitCost, 12);
    assert.equal(creates[1].input.items[0].packSize, 12);
    assert.equal(creates[1].input.invoiceNumber, 'INV-001');
    assert.equal(creates[1].input.attachmentName, 'bill.png');
    assert.equal(creates[1].input.updateCost, false);
    assert.equal(await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).inputValue(), '');
    assert.equal(await page.evaluate(() => localStorage.getItem('bbpos.purchase.draft:21')), null);
  });
  await check('attachment history loads only on demand', async () => {
    assert.equal(requests.filter((request) => request.endpoint.endsWith('/attachment')).length, 0);
    await page.locator('.rcv-po > button').first().click();
    await page.getByRole('button', { name: 'ดูภาพบิลส่งของ', exact: true }).click();
    await page.locator('.rcv-bill-image').waitFor();
    assert.equal(requests.filter((request) => request.endpoint.endsWith('/attachment')).length, 1);
  });
  await check('duplicate bill errors retain the draft for correction', async () => {
    await page.getByLabel('ผู้ขาย / ซัพพลายเออร์', { exact: true }).fill('ร้านทดสอบ');
    await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).fill('INV-001');
    await addLine(page);
    await page.getByRole('button', { name: 'รับเข้าสต็อก', exact: true }).click();
    await page.getByText('เลขบิลนี้บันทึกไว้แล้ว กรุณาตรวจบิลเดิม', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).inputValue(), 'INV-001');
    assert.equal(purchases.length, 1);
    await page.getByRole('button', { name: 'ล้าง', exact: true }).click();
  });
  await check('supplier orders require approval and support partial stock receipt retry', async () => {
    await page.getByRole('radio', { name: /สั่งซื้อ · รอรับของ/ }).check();
    await page.getByLabel('ผู้ขาย / ซัพพลายเออร์', { exact: true }).fill('ร้านสั่งซื้อ');
    await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).fill('PO-002');
    await addLine(page);
    await page.getByRole('button', { name: 'ส่งใบสั่งซื้อรออนุมัติ', exact: true }).click();
    await page.getByText('ส่งใบสั่งซื้อรออนุมัติแล้ว 1 รายการ', { exact: false }).waitFor();
    await page.locator('.rcv-po').filter({ hasText: 'PO-002' }).locator(':scope > button').click();
    assert.equal(await page.getByRole('button', { name: 'รับของครั้งนี้', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'อนุมัติใบสั่งซื้อ', exact: true }).click();
    await page.getByLabel('จำนวนรับครั้งนี้ นมทดสอบ', { exact: true }).fill('6');
    await page.getByRole('checkbox', { name: /อัปเดตทุนแบบถัวเฉลี่ยตามของที่รับครั้งนี้/ }).uncheck();
    await page.getByRole('button', { name: 'รับของครั้งนี้', exact: true }).click();
    await page.getByText('ทดสอบการรับของซ้ำเมื่อเครือข่ายขัดข้อง', { exact: true }).waitFor();
    await page.reload();
    await page.locator('.rcv-po').filter({ hasText: 'PO-002' }).locator(':scope > button').click();
    assert.equal(await page.getByLabel('จำนวนรับครั้งนี้ นมทดสอบ', { exact: true }).inputValue(), '6');
    assert.equal(await page.getByRole('checkbox', { name: /อัปเดตทุนแบบถัวเฉลี่ยตามของที่รับครั้งนี้/ }).isChecked(), false);
    await page.getByRole('button', { name: 'รับของครั้งนี้', exact: true }).click();
    await page.getByText(/รับของตามใบสั่งซื้อ #2 แล้ว · ยังมีของค้างรับ/, { exact: true }).waitFor();
    const receives = writes.filter((item) => item.endpoint.endsWith('/receive'));
    assert.equal(receives[0].input.requestKey, receives[1].input.requestKey);
    assert.equal(receives[1].input.items[0].qty, 6);
    assert.equal(receives[1].input.updateCost, false);
    await page.locator('.rcv-po').filter({ hasText: 'PO-002' }).locator(':scope > button').click();
    assert.equal(await page.getByLabel('จำนวนรับครั้งนี้ นมทดสอบ', { exact: true }).inputValue(), '18');
    await page.getByRole('button', { name: 'รับของครั้งนี้', exact: true }).click();
    await page.getByText(/รับของตามใบสั่งซื้อ #2 แล้ว · รับครบ/, { exact: true }).waitFor();
  });
  await check('editing a received bill restores packs and its original attachment', async () => {
    await page.locator('.rcv-po').filter({ hasText: 'INV-001' }).locator(':scope > button').click();
    await page.getByRole('button', { name: 'แก้ไขใบรับ', exact: true }).click();
    await page.getByText(/ยกเลิกใบรับ #1 แล้ว/, { exact: false }).waitFor();
    assert.equal(await page.getByLabel('จำนวนรับเข้า นมทดสอบ', { exact: true }).inputValue(), '2');
    assert.equal(await page.getByLabel('จำนวนขวดต่อหน่วยซื้อ (เช่น ลัง) นมทดสอบ', { exact: true }).inputValue(), '12');
    assert.equal(await page.getByLabel('ต้นทุนต่อหน่วย นมทดสอบ', { exact: true }).inputValue(), '144');
    assert.equal(await page.locator('.rcv-attachment__preview img').count(), 1);
    await page.getByRole('button', { name: 'รับเข้าสต็อก', exact: true }).click();
    await page.getByText('รับสินค้าเข้าสต็อกแล้ว 1 รายการ', { exact: false }).waitFor();
  });
  await check('invoice search reaches server and branch drafts remain isolated', async () => {
    await page.getByLabel('ค้นเลขบิลหรือผู้ขาย', { exact: true }).fill('INV-001');
    await page.waitForResponse((response) => response.url().includes('/purchases?') && response.url().includes('query=INV-001'));
    assert.equal(await page.locator('.rcv-po').count(), 2);
    await page.getByLabel('ค้นเลขบิลหรือผู้ขาย', { exact: true }).fill('');
    await page.getByLabel('ผู้ขาย / ซัพพลายเออร์', { exact: true }).fill('ร่างสาขาหนึ่ง');
    await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).fill('BRANCH-21');
    await page.getByLabel('เลือกสาขา', { exact: true }).selectOption('22');
    assert.equal(await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).inputValue(), '');
    await page.getByLabel('ผู้ขาย / ซัพพลายเออร์', { exact: true }).fill('ร่างสาขาสอง');
    await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).fill('BRANCH-22');
    await page.getByLabel('เลือกสาขา', { exact: true }).selectOption('21');
    assert.equal(await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).inputValue(), 'BRANCH-21');
    const drafts = await page.evaluate(() => [21, 22].map((id) => JSON.parse(localStorage.getItem(`bbpos.purchase.draft:${id}`)).invoiceNumber));
    assert.deepEqual(drafts, ['BRANCH-21', 'BRANCH-22']);
  });
  await check('unsupported and oversized attachments are rejected', async () => {
    await page.getByLabel('แนบภาพบิลส่งของ', { exact: true }).setInputFiles({ name: 'bill.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture') });
    await page.getByText('แนบได้เฉพาะภาพ JPEG, PNG หรือ WebP', { exact: true }).waitFor();
    await page.getByLabel('แนบภาพบิลส่งของ', { exact: true }).setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    await page.getByText('ภาพบิลต้องมีขนาดไม่เกิน 2 MB', { exact: true }).waitFor();
    assert.equal(await page.locator('.rcv-attachment__preview img').count(), 0);
  });
  await fs.mkdir(outputDir, { recursive: true });
  // A populated local draft gives the screenshots useful review context.
  // These inputs are never submitted and every API route remains mocked.
  await page.getByLabel('ผู้ขาย / ซัพพลายเออร์', { exact: true }).fill('ร้านวัตถุดิบตัวอย่าง');
  await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).fill('DEMO-2026-1012');
  await page.getByLabel('วันที่ในบิล', { exact: true }).fill('2026-10-12');
  await page.getByLabel('วันที่รับของ', { exact: true }).fill('2026-10-12');
  await page.getByLabel('หมายเหตุ', { exact: true }).fill('นม 2 ลัง ลังละ 12 ขวด · ตรวจจำนวนตรงกับบิลแล้ว');
  await addLine(page);
  const sampleBill = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 360; canvas.height = 480;
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = '#ffffff'; drawing.fillRect(0, 0, 360, 480);
    drawing.fillStyle = '#174534'; drawing.font = 'bold 23px Arial'; drawing.fillText('DELIVERY NOTE', 25, 45);
    drawing.fillStyle = '#222222'; drawing.font = '15px Arial';
    ['DEMO-2026-1012', 'Date: 12 Oct 2026', 'Supplier: Sample ingredient store', '', 'Milk                    2 boxes', '12 bottles per box', 'Price per box:         THB 144', '', 'Total:                 THB 288', '', 'Goods checked and received'].forEach((text, index) => drawing.fillText(text, 25, 83 + index * 29));
    drawing.strokeStyle = '#ccd5ce'; drawing.strokeRect(12, 12, 336, 456);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('แนบภาพบิลส่งของ', { exact: true }).setInputFiles({ name: 'delivery-note-demo.png', mimeType: 'image/png', buffer: Buffer.from(sampleBill, 'base64') });
  await page.locator('.rcv-attachment__preview img').waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.rcv-attachment__preview img'); return image?.complete && image.naturalWidth > 0; });
  while (await page.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).count()) await page.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0);
  const scrollToTop = async () => {
    await page.evaluate(() => {
      document.activeElement?.blur();
      for (const node of [document.scrollingElement, ...document.querySelectorAll('.app-layout__content, .inventory-workspace')]) node?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.app-layout__content, .inventory-workspace')].every((node) => node.scrollTop === 0 && node.scrollLeft === 0));
  };
  // Keep the requested widths and increase the capture height so nested app
  // scrolling cannot clip the lower part of the receiving form.
  const desktopHeight = Math.max(900, Math.ceil(await page.locator('.panel--receive').evaluate((node) => node.offsetHeight)) + 450);
  await page.setViewportSize({ width: 1280, height: desktopHeight });
  await scrollToTop();
  await page.locator('.rcv').screenshot({ path: path.join(outputDir, 'receiving-form-desktop.png') });
  await scrollToTop();
  await page.screenshot({ path: path.join(outputDir, 'receiving-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByLabel('เลขที่บิลส่งของ', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.rcv-form')?.disabled);
  const numericFields = await page.locator('.rcv-num input').evaluateAll((inputs) => {
    const measuring = document.createElement('canvas').getContext('2d');
    return inputs.map((input) => {
      const style = getComputedStyle(input);
      measuring.font = style.font;
      return { label: input.getAttribute('aria-label'), value: input.value, availableWidth: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), textWidth: measuring.measureText(input.value).width };
    });
  });
  assert.equal(numericFields.find((field) => field.label === 'จำนวนรับเข้า นมทดสอบ').value, '2');
  assert.equal(numericFields.find((field) => field.label.startsWith('จำนวนขวดต่อหน่วยซื้อ')).value, '12');
  for (const field of numericFields) assert.ok(field.availableWidth >= Math.max(30, field.textWidth + 8), `${field.label} must leave enough space to show ${field.value}`);
  const mobileHeight = Math.max(844, Math.ceil(await page.locator('.panel--receive').evaluate((node) => node.offsetHeight)) + 600);
  await page.setViewportSize({ width: 390, height: mobileHeight });
  await scrollToTop();
  await page.locator('.rcv').screenshot({ path: path.join(outputDir, 'receiving-form-mobile.png') });
  await scrollToTop();
  await page.screenshot({ path: path.join(outputDir, 'receiving-mobile.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('แนบภาพบิลส่งของ', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, 'receiving-mobile-bill-entry.png') });
  await page.getByLabel('จำนวนรับเข้า นมทดสอบ', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, 'receiving-mobile-stock-entry.png') });
  await scrollToTop();
  const formFits = await page.locator('.rcv').evaluate((node) => node.getBoundingClientRect().right <= window.innerWidth + 1);
  if (!formFits) console.log(await page.locator('.rcv').evaluate((node) => ({ width: window.innerWidth, form: node.getBoundingClientRect().toJSON(), body: document.body.getBoundingClientRect().toJSON(), panel: node.closest('.panel').getBoundingClientRect().toJSON(), sidebar: document.querySelector('.sidebar').getBoundingClientRect().toJSON() })));
  assert.equal(formFits, true, 'Receiving form must fit mobile width');
  assert.equal(await page.locator('.rcv').evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, 'Receiving controls must not overflow mobile width');
  assert.deepEqual(pageErrors, []);
  console.log(`PASS no browser exceptions; screenshots saved in ${outputDir}`);
  await context.close();
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
