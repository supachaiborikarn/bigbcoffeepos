/** Actual HTTP/API/DB regression; accepts only an explicitly marked disposable local QA database. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import jwt from "jsonwebtoken";

const databaseUrl = process.env.DATABASE_URL;
let target: URL;
try { target = new URL(databaseUrl ?? ""); }
catch { throw new Error("Supply an explicit disposable local QA DATABASE_URL; no .env database is used"); }
if (process.env.QA_DISPOSABLE_DB !== "true" || !["postgres:", "postgresql:"].includes(target.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.port !== "55432" || !/^\/benzpos_qa(?:_|$)/.test(target.pathname)) {
  throw new Error("Use QA_DISPOSABLE_DB=true and explicit loopback:55432/benzpos_qa* PostgreSQL only; real stock data must never be used");
}
process.env.NODE_ENV = "test";
const { default: prisma } = await import("../prisma.js");
const { Prisma } = await import("@prisma/client");
const secret = "qa_stock_fixture_only";
const apiRoot = resolve(import.meta.dirname, "../..");
const tag = `QA_HTTP_STOCK_${Date.now()}_${randomUUID().slice(0, 6)}`;
const branchIds: number[] = [];
const userIds: number[] = [];
const ingredientIds: number[] = [];
let server: ChildProcess | undefined;
let serverLog = "";
let workspace: string | undefined;
let baseUrl = "";
const pass = (label: string) => console.log(`PASS ${label}`);
const key = () => `${tag}_${randomUUID()}`;

async function freePort() {
  const listener = net.createServer();
  await new Promise<void>((yes, no) => { listener.once("error", no); listener.listen(0, "127.0.0.1", yes); });
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((yes, no) => listener.close((error) => error ? no(error) : yes()));
  return port;
}
async function startApi() {
  const port = await freePort();
  workspace = await mkdtemp(resolve(tmpdir(), "benzpos-qa-http-"));
  baseUrl = `http://127.0.0.1:${port}/api`;
  server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl!, NODE_ENV: "test", JWT_SECRET: secret, PORT: String(port), AUDIT_LOG_FILE: resolve(workspace, "audit.log"), INTEGRATION_OUTBOX_INTERVAL_MS: "0", ALERT_CHANNEL_URL: "", POSPOS_EMAIL: "", POSPOS_PASSWORD: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const collect = (value: Buffer) => { serverLog = (serverLog + value.toString()).slice(-12000); };
  server.stdout!.on("data", collect); server.stderr!.on("data", collect);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`QA API stopped before startup: ${serverLog.slice(-2000)}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* only waiting for this local child */ }
    await new Promise((yes) => setTimeout(yes, 100));
  }
  throw new Error(`QA API startup timed out: ${serverLog.slice(-2000)}`);
}
async function stopApi() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>((yes) => server!.once("exit", () => yes()));
  server.kill("SIGTERM");
  await Promise.race([exited, new Promise<void>((yes) => setTimeout(yes, 1500))]);
  if (server.exitCode === null && server.signalCode === null) { server.kill("SIGKILL"); await exited; }
}
async function request(path: string, token: string | null, method = "GET", input?: unknown) {
  const response = await fetch(baseUrl + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(input !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); }
  catch { throw new Error(`Non-JSON API response for ${method} ${path}: status ${response.status}`); }
  return { status: response.status, body, headers: response.headers };
}
async function expected(path: string, token: string | null, status: number, method = "GET", input?: unknown) {
  const response = await request(path, token, method, input);
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(response.body).slice(0, 400)}`);
  return response.body;
}
async function balance(branchId: number, ingredientId: number) {
  return (await prisma.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId } } }))?.stockQty;
}
function token(user: { id: number; name: string; role: string; branchId: number | null }) {
  return jwt.sign({ id: user.id, name: user.name, role: user.role, branchId: user.branchId }, secret, { expiresIn: "5m" });
}
async function main() {
  for (const suffix of ["shop", "other"]) { const branch = await prisma.branch.create({ data: { name: `${tag}_${suffix}` } }); branchIds.push(branch.id); }
  const [shopId, otherId] = branchIds;
  const admin = await prisma.user.create({ data: { name: `${tag}_admin`, pin: key(), role: "admin" } }); userIds.push(admin.id);
  const manager = await prisma.user.create({ data: { name: `${tag}_manager`, pin: key(), role: "manager", branchId: shopId } }); userIds.push(manager.id);
  const cashier = await prisma.user.create({ data: { name: `${tag}_cashier`, pin: key(), role: "cashier", branchId: shopId } }); userIds.push(cashier.id);
  const milk = await prisma.ingredient.create({ data: { name: `${tag}_milk`, unit: "กล่อง", costPerUnit: 50 } }); ingredientIds.push(milk.id);
  const beans = await prisma.ingredient.create({ data: { name: `${tag}_beans`, unit: "กก.", costPerUnit: 500 } }); ingredientIds.push(beans.id);
  await prisma.ingredientStock.createMany({ data: branchIds.flatMap(branchId => [{ branchId, ingredientId: milk.id, stockQty: 10 }, { branchId, ingredientId: beans.id, stockQty: 5 }]) });
  const adminToken = token(admin), managerToken = token(manager), cashierToken = token(cashier);
  await startApi();
  const draft = { branchId: shopId, kind: "MOVE", reason: "เติมของเคาน์เตอร์", fromLocation: "คลัง", toLocation: "เคาน์เตอร์", items: [{ ingredientId: milk.id, qty: 3 }], requestKey: key(), postImmediately: false, requestedByUserId: admin.id, approvedByUserId: admin.id, status: "POSTED" };
  await expected(`/inventory-documents?branchId=${shopId}`, null, 401);
  const created = await expected("/inventory-documents", managerToken, 201, "POST", draft);
  const move = created.document;
  assert.equal(move.requestedByUserId, manager.id); assert.equal(move.requestedByName, manager.name); assert.equal(move.status, "PENDING"); assert.equal(move.approvedByUserId, null);
  assert.equal(await balance(shopId, milk.id), 10);
  const retries = await Promise.all(Array.from({ length: 5 }, () => expected("/inventory-documents", managerToken, 201, "POST", draft)));
  assert(retries.every(row => row.document.id === move.id));
  assert.equal(await prisma.inventoryDocument.count({ where: { branchId: shopId } }), 1);
  await expected("/inventory-documents", managerToken, 400, "POST", { ...draft, items: [{ ingredientId: milk.id, qty: 4 }] });
  await expected("/inventory-documents", managerToken, 400, "POST", { ...draft, requestKey: key(), postImmediately: "false" });
  for (const items of [[], [null], [{ ingredientId: milk.id, qty: -1 }], [{ ingredientId: milk.id, qty: 0.5 }], [{ ingredientId: beans.id, qty: 1.00001 }]]) await expected("/inventory-documents", managerToken, 400, "POST", { ...draft, requestKey: key(), items });
  assert.equal(await prisma.inventoryDocument.count({ where: { branchId: shopId } }), 1);
  pass("HTTP document creation uses authenticated requester, ignores spoofed approval/status, serializes retries and rejects invalid typed fields/items without writes");

  const foreign = (await expected("/inventory-documents", adminToken, 201, "POST", { ...draft, branchId: otherId, requestKey: key() })).document;
  await expected(`/inventory-documents?branchId=${otherId}`, managerToken, 403);
  await expected(`/stock-ledger?branchId=${otherId}`, managerToken, 403);
  await expected("/inventory-documents", managerToken, 403, "POST", { ...draft, branchId: otherId, requestKey: key() });
  await expected(`/inventory-documents/${foreign.id}/post`, managerToken, 403, "POST", {});
  await expected(`/inventory-documents/${foreign.id}/void`, managerToken, 403, "POST", { reason: "fixture" });
  await expected(`/inventory-documents/${move.id}/post`, cashierToken, 403, "POST", {});
  await expected("/inventory-documents", cashierToken, 403, "POST", { ...draft, requestKey: key() });
  const spoofedRoleToken = token({ ...manager, role: "admin" });
  await expected(`/inventory-documents?branchId=${otherId}`, spoofedRoleToken, 403);
  assert.equal((await prisma.inventoryDocument.findUnique({ where: { id: foreign.id } }))?.status, "PENDING");
  pass("HTTP permissions deny foreign branch reads/mutations and cashier approvals; stored user role overrides a forged token role");

  await Promise.all(Array.from({ length: 5 }, () => expected(`/inventory-documents/${move.id}/post`, managerToken, 200, "POST", {})));
  assert.equal(await balance(shopId, milk.id), 10);
  const moved = await prisma.stockMovement.findMany({ where: { documentId: move.id } });
  assert.equal(moved.length, 1); assert.equal(moved[0].qty, 0); assert.equal(moved[0].beforeQty, 10); assert.equal(moved[0].afterQty, 10); assert.equal(moved[0].actorUserId, manager.id);
  const issuePayload = { ...draft, kind: "USE", reason: "ชงให้พนักงาน", requestKey: key(), postImmediately: true, items: [{ ingredientId: milk.id, qty: 2 }, { ingredientId: beans.id, qty: 0.1 }] };
  const issues = await Promise.all(Array.from({ length: 5 }, () => expected("/inventory-documents", managerToken, 201, "POST", issuePayload)));
  const issue = issues[0].document;
  assert(issues.every(row => row.document.id === issue.id)); assert.equal(issue.status, "POSTED"); assert.equal(issue.approvedByName, manager.name);
  assert.equal(await balance(shopId, milk.id), 8); assert.equal(await balance(shopId, beans.id), 4.9);
  await expected(`/inventory-documents/${issue.id}/post`, managerToken, 200, "POST", {});
  assert.equal(await balance(shopId, milk.id), 8);
  const countBefore = await prisma.inventoryDocument.count({ where: { branchId: shopId } });
  const insufficient = await request("/inventory-documents", managerToken, "POST", { ...issuePayload, requestKey: key(), items: [{ ingredientId: milk.id, qty: 1 }, { ingredientId: beans.id, qty: 999 }] });
  assert.equal(insufficient.status, 400); assert.match(insufficient.body.error, /สต็อกไม่พอ/);
  assert.equal(await prisma.inventoryDocument.count({ where: { branchId: shopId } }), countBefore);
  assert.equal(await balance(shopId, milk.id), 8);
  await Promise.all(Array.from({ length: 5 }, () => expected(`/inventory-documents/${issue.id}/void`, managerToken, 200, "POST", { reason: "fixture cancellation" })));
  assert.equal(await balance(shopId, milk.id), 10); assert.equal(await balance(shopId, beans.id), 5);
  assert.equal(await prisma.stockMovement.count({ where: { documentId: issue.id } }), 4);
  await expected(`/inventory-documents/${move.id}/void`, managerToken, 200, "POST", { reason: "fixture location reversal" });
  assert.equal(await balance(shopId, milk.id), 10);
  pass("HTTP MOVE keeps totals; concurrent USE requests/posts deduct once, insufficient multi-item post rolls back, and concurrent void restores once");

  const photo = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`;
  const orderPayload = { branchId: shopId, mode: "ORDER", supplier: `${tag}_supplier`, invoiceNumber: "DELIVERY-001", documentDate: "2026-10-12", requestKey: key(), attachmentName: "delivery.png", attachmentDataUrl: photo, items: [{ ingredientId: milk.id, qty: 4, unitCost: 40 }] };
  const po = (await expected("/purchases", managerToken, 201, "POST", orderPayload)).purchase;
  assert.equal(po.kind, "ORDER"); assert.equal(po.status, "PENDING"); assert.equal(po.createdByUserId, manager.id); assert.equal(await balance(shopId, milk.id), 10);
  assert.equal((await expected("/purchases", managerToken, 201, "POST", orderPayload)).purchase.id, po.id);
  const receivePayload = { requestKey: key(), receivedAt: "2026-10-12", items: [{ purchaseItemId: po.items[0].id, qty: 2, lotNo: "HTTP-PARTIAL", expiryDate: "2027-01-01" }], updateCost: true };
  await expected(`/purchases/${po.id}/receive`, managerToken, 400, "POST", receivePayload);
  await expected(`/purchases/${po.id}/approve`, cashierToken, 403, "POST", {});
  const approved = (await expected(`/purchases/${po.id}/approve`, managerToken, 200, "POST", {})).purchase;
  assert.equal(approved.status, "APPROVED"); assert.equal(approved.approvedByName, manager.name); assert.equal(await balance(shopId, milk.id), 10);
  const receipts = await Promise.all(Array.from({ length: 5 }, () => expected(`/purchases/${po.id}/receive`, managerToken, 200, "POST", receivePayload)));
  assert(receipts.every(row => row.purchase.status === "PARTIAL"));
  const partial = receipts[0].purchase;
  assert.equal(partial.items[0].receivedQty, 2); assert.equal(partial.items[0].remainingQty, 2); assert.equal(partial.receipts.length, 1); assert.equal(partial.receipts[0].actorName, manager.name);
  assert.equal(await balance(shopId, milk.id), 12); assert.equal((await prisma.ingredient.findUnique({ where: { id: milk.id } }))?.costPerUnit, 50);
  await expected(`/purchases/${po.id}/receive`, managerToken, 400, "POST", { ...receivePayload, requestKey: key(), items: [{ purchaseItemId: po.items[0].id, qty: 3 }] });
  const complete = (await expected(`/purchases/${po.id}/receive`, managerToken, 200, "POST", { ...receivePayload, requestKey: key() })).purchase;
  assert.equal(complete.status, "RECEIVED"); assert.equal(complete.items[0].remainingQty, 0); assert.equal(complete.receipts.length, 2); assert.equal(await balance(shopId, milk.id), 14);
  const ownList = await expected(`/purchases?branchId=${shopId}`, managerToken, 200);
  assert(!Object.hasOwn(ownList.items.find((row: any) => row.id === po.id), "attachmentDataUrl"));
  const attachment = await request(`/purchases/${po.id}/attachment`, managerToken);
  assert.equal(attachment.status, 200); assert.equal(attachment.body.attachmentDataUrl, photo); assert.equal(attachment.headers.get("cache-control"), "no-store");
  pass("HTTP supplier ORDER authorizes without receiving, partial receipts retry once and finish correctly, and manager receipt preserves shared cost with client-compatible history");

  const otherPo = (await expected("/purchases", adminToken, 201, "POST", { ...orderPayload, branchId: otherId, requestKey: key(), invoiceNumber: "DELIVERY-OTHER" })).purchase;
  await expected(`/purchases?branchId=${otherId}`, managerToken, 403);
  await expected(`/purchases/${otherPo.id}/attachment`, managerToken, 403);
  await expected(`/purchases/${otherPo.id}/approve`, managerToken, 403, "POST", {});
  await expected(`/purchases/${otherPo.id}/receive`, managerToken, 403, "POST", { ...receivePayload, requestKey: key(), items: [{ purchaseItemId: otherPo.items[0].id, qty: 1 }] });
  await expected(`/purchases/${otherPo.id}/void`, managerToken, 403, "POST", { reason: "fixture" });
  await expected(`/purchases/${po.id}/attachment`, cashierToken, 403);
  await expected(`/purchases/${po.id}/attachment`, null, 401);
  assert.equal(await balance(otherId, milk.id), 10);
  const jpeg = Buffer.alloc(2 * 1024 * 1024); jpeg.set([0xff, 0xd8, 0xff]); jpeg.set([0xff, 0xd9], jpeg.length - 2);
  const largePhoto = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const large = (await expected("/purchases", adminToken, 201, "POST", { ...orderPayload, mode: "RECEIPT", requestKey: key(), invoiceNumber: "LARGE-PHOTO", attachmentName: "large.jpg", attachmentDataUrl: largePhoto, items: [{ ingredientId: milk.id, qty: 1, unitCost: 50 }] })).purchase;
  assert.equal(large.status, "RECEIVED"); assert.equal(await balance(shopId, milk.id), 15);
  assert.equal((await expected(`/purchases/${large.id}/attachment`, adminToken, 200)).attachmentDataUrl, largePhoto);
  const listed = (await expected(`/purchases?branchId=${shopId}`, managerToken, 200)).items.find((row: any) => row.id === large.id);
  assert.equal(listed.hasAttachment, true); assert(!Object.hasOwn(listed, "attachmentDataUrl"));
  const oversized = `data:image/jpeg;base64,${Buffer.concat([jpeg, Buffer.from([0])]).toString("base64")}`;
  await expected("/purchases", adminToken, 400, "POST", { ...orderPayload, requestKey: key(), invoiceNumber: "OVERSIZED-PHOTO", attachmentDataUrl: oversized });
  await expected("/purchases", adminToken, 400, "POST", { ...orderPayload, requestKey: key(), invoiceNumber: "INVALID-PHOTO", attachmentDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" });
  for (const items of [[null], [{ ingredientId: milk.id, qty: 0, unitCost: 1 }], [{ ingredientId: milk.id, qty: 0.5, unitCost: 1 }]]) await expected("/purchases", managerToken, 400, "POST", { ...orderPayload, requestKey: key(), invoiceNumber: key(), items });
  assert.equal(await balance(shopId, milk.id), 15);
  pass("HTTP attachment access is authenticated and branch-scoped; full 2 MiB JSON image passes, oversized/invalid images and malformed receipt items fail without changing stock");

  await prisma.stockMovement.createMany({ data: [
    { branchId: shopId, ingredientId: milk.id, qty: -1, beforeQty: 10, afterQty: 9, actorUserId: manager.id, reason: "SALE-901", createdAt: new Date("2026-10-12T16:59:59.999Z") },
    { branchId: shopId, ingredientId: milk.id, qty: -1, beforeQty: 9, afterQty: 8, actorUserId: manager.id, reason: "SALE-902", createdAt: new Date("2026-10-12T17:00:00.000Z") }
  ] });
  const ledger = await expected(`/stock-ledger?branchId=${shopId}&kind=SALE&from=2026-10-12&to=2026-10-12&limit=1&page=1`, managerToken, 200);
  assert.equal(ledger.total, 1); assert.equal(ledger.page, 1); assert.equal(ledger.limit, 1); assert.equal(ledger.items[0].reason, "SALE-901");
  assert.equal(ledger.items[0].ingredientName, milk.name); assert.equal(ledger.items[0].unit, milk.unit); assert.equal(ledger.items[0].actorName, manager.name); assert.equal(ledger.items[0].beforeQty, 10); assert.equal(ledger.items[0].afterQty, 9); assert.equal(ledger.items[0].kind, "SALE"); assert.equal(typeof ledger.items[0].reference, "string");
  assert.equal(ledger.snapshotId, ledger.items[0].id);
  await prisma.stockMovement.create({ data: { branchId: shopId, ingredientId: milk.id, qty: -1, reason: "SALE-903", createdAt: new Date("2026-10-12T10:00:00Z") } });
  const bounded = await expected(`/stock-ledger?branchId=${shopId}&kind=SALE&from=2026-10-12&to=2026-10-12&snapshotId=${ledger.snapshotId}`, managerToken, 200);
  assert.equal(bounded.total, 1); assert.equal(bounded.snapshotId, ledger.snapshotId); assert.deepEqual(bounded.items.map((row: any) => row.id), [ledger.items[0].id]);
  const emptySnapshot = await expected(`/stock-ledger?branchId=${shopId}&snapshotId=0`, managerToken, 200);
  assert.equal(emptySnapshot.total, 0); assert.equal(emptySnapshot.items.length, 0);
  const returns = await expected(`/stock-ledger?branchId=${shopId}&kind=RETURN&ingredientId=${milk.id}`, managerToken, 200);
  assert.equal(returns.total, 1); assert.equal(returns.items[0].qty, 2);
  const movedLedger = await expected(`/stock-ledger?branchId=${shopId}&kind=MOVE&limit=1&page=2`, managerToken, 200);
  assert.equal(movedLedger.total, 2); assert.equal(movedLedger.items.length, 1); assert.equal(movedLedger.items[0].document.id, move.id);
  await expected(`/stock-ledger?branchId=${shopId}&from=2026-10-13&to=2026-10-12`, managerToken, 400);
  await expected(`/stock-ledger?branchId=${shopId}&kind=UNKNOWN`, managerToken, 400);
  for (const invalid of ["-1", "0.5", "NaN", "2147483648"]) await expected(`/stock-ledger?branchId=${shopId}&snapshotId=${invalid}`, managerToken, 400);
  await expected(`/stock-ledger?branchId=${shopId}`, cashierToken, 403);
  pass("HTTP ledger returns the client contract, bounds export snapshots, rejects invalid snapshots, filters/paginates, and honors Bangkok midnight");
}

async function cleanup() {
  await stopApi();
  if (branchIds.length) {
    const branches = { in: branchIds };
    await prisma.inventoryLot.deleteMany({ where: { branchId: branches } });
    await prisma.stockMovement.deleteMany({ where: { branchId: branches } });
    await prisma.inventoryDocument.deleteMany({ where: { branchId: branches } });
    const purchases = await prisma.purchase.findMany({ where: { branchId: branches }, select: { id: true } });
    await prisma.purchaseItem.deleteMany({ where: { purchaseId: { in: purchases.map(row => row.id) } } });
    await prisma.purchase.deleteMany({ where: { branchId: branches } });
    await prisma.ingredientStock.deleteMany({ where: { branchId: branches } });
    const auditTable = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.audit_events')::text AS name`;
    if (auditTable[0]?.name && userIds.length) await prisma.$executeRaw(Prisma.sql`DELETE FROM audit_events WHERE actor_id IN (${Prisma.join(userIds)})`);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
    await prisma.branch.deleteMany({ where: { id: branches } });
    assert.equal(await prisma.branch.count({ where: { id: branches } }), 0);
    assert.equal(await prisma.user.count({ where: { id: { in: userIds } } }), 0);
    assert.equal(await prisma.ingredient.count({ where: { id: { in: ingredientIds } } }), 0);
    assert.equal(await prisma.purchase.count({ where: { branchId: branches } }), 0);
    assert.equal(await prisma.inventoryDocument.count({ where: { branchId: branches } }), 0);
    assert.equal(await prisma.stockMovement.count({ where: { branchId: branches } }), 0);
    pass("QA child API stopped and only this run's fixture branches/users/ingredients/documents/movements were removed");
  }
  if (workspace) await rm(workspace, { recursive: true, force: true });
}
try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally { try { await cleanup(); } finally { await prisma.$disconnect(); } }
