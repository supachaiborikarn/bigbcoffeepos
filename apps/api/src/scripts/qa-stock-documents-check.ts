import assert from "node:assert/strict";
import prisma from "../prisma.js";
import { createInventoryDocument, getInventoryDocument, getInventoryDocuments, postInventoryDocument, voidInventoryDocument, getStockLedger } from "../store/stockDocuments.js";
import { adjustStock } from "../store/inventory.js";
import { createOrder } from "../store/orders.js";

const target = new URL(process.env.DATABASE_URL ?? "invalid:");
if (process.env.QA_DISPOSABLE_DB !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !/^\/benzpos_qa(?:_|$)/.test(target.pathname)) throw new Error("Use QA_DISPOSABLE_DB=true and an explicit local disposable benzpos_qa database only");
const db = prisma as any;
const tag = `QA_STOCK_DOC_${Date.now()}`;
const branchIds: number[] = [];
const ingredientIds: number[] = [];
const menuIds: number[] = [];
const userIds: number[] = [];
const pass = (label: string) => console.log(`PASS ${label}`);
let sequence = 0;
const uniqueKey = () => `${tag}_${++sequence}`;
async function branch(name: string) { const row = await db.branch.create({ data: { name: `${tag}_${name}` } }); branchIds.push(row.id); return row; }
async function ingredient(name: string, unit = "ขวด") { const row = await db.ingredient.create({ data: { name: `${tag}_${name}`, unit, costPerUnit: 10 } }); ingredientIds.push(row.id); return row; }
async function balance(branchId: number, ingredientId: number) { return (await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId } } }))?.stockQty ?? 0; }
async function seedStock(branchId: number, ingredientId: number, stockQty: number) { await db.ingredientStock.create({ data: { branchId, ingredientId, stockQty } }); }
async function main() {
  const shop = await branch("shop"), otherShop = await branch("other"), ledgerShop = await branch("ledger"), raceShop = await branch("race");
  const actor = await db.user.create({ data: { name: `${tag}_manager`, pin: "qa-only", role: "manager", branchId: shop.id } }); userIds.push(actor.id);
  const product = await ingredient("milk");
  await seedStock(shop.id, product.id, 20); await seedStock(otherShop.id, product.id, 50);
  const early = await db.inventoryLot.create({ data: { branchId: shop.id, ingredientId: product.id, lotNo: "EARLY", qty: 2, expiryDate: new Date("2027-01-01") } });
  const late = await db.inventoryLot.create({ data: { branchId: shop.id, ingredientId: product.id, lotNo: "LATE", qty: 5, expiryDate: new Date("2027-02-01") } });
  const undated = await db.inventoryLot.create({ data: { branchId: shop.id, ingredientId: product.id, lotNo: "UNDATED", qty: 13 } });
  const lotQty = async (id: number) => (await db.inventoryLot.findUnique({ where: { id } }))?.qty;
  const request = { branchId: shop.id, kind: "USE" as const, requestedByUserId: actor.id, requestKey: uniqueKey(), reason: "ใช้ทำความสะอาด", note: "fixture", items: [{ ingredientId: product.id, qty: 3 }] };
  const retries = await Promise.all(Array.from({ length: 7 }, () => createInventoryDocument(request)));
  const pending = retries[0]!;
  assert(pending); assert(retries.every((row) => row?.id === pending.id));
  assert.equal((await getInventoryDocuments(shop.id)).length, 1); assert.equal(pending.status, "PENDING"); assert.equal(pending.requestedByName, actor.name);
  assert.equal(await balance(shop.id, product.id), 20); assert.equal(await lotQty(early.id), 2); assert.equal(await db.stockMovement.count({ where: { branchId: shop.id } }), 0);
  await assert.rejects(() => createInventoryDocument({ ...request, items: [{ ingredientId: product.id, qty: 4 }] }), /ข้อมูลอื่น/);
  await assert.rejects(() => createInventoryDocument({ ...request, branchId: otherShop.id }), /ข้อมูลอื่น/);
  assert.equal(await balance(otherShop.id, product.id), 50); assert.equal((await getInventoryDocuments(otherShop.id)).length, 0);
  pass("pending issue keeps balances/lots unchanged; simultaneous retries return one document and changed/cross-branch payloads are refused");

  await Promise.all(Array.from({ length: 7 }, () => postInventoryDocument(pending.id, actor.id)));
  assert.equal(await balance(shop.id, product.id), 17); assert.equal(await lotQty(early.id), 0); assert.equal(await lotQty(late.id), 4); assert.equal(await lotQty(undated.id), 13);
  const posted = await getInventoryDocument(pending.id); assert.equal(posted?.status, "POSTED"); assert.equal(posted?.approvedByName, actor.name);
  const issued = await db.stockMovement.findMany({ where: { documentId: pending.id } });
  assert.equal(issued.length, 1); assert.equal(issued[0].qty, -3); assert.equal(issued[0].beforeQty, 20); assert.equal(issued[0].afterQty, 17); assert.equal(issued[0].actorUserId, actor.id);
  await Promise.all(Array.from({ length: 7 }, () => voidInventoryDocument(pending.id, "ยกเลิกการเบิก", actor.id)));
  assert.equal(await balance(shop.id, product.id), 20); assert.equal(await lotQty(early.id), 2); assert.equal(await lotQty(late.id), 5); assert.equal(await lotQty(undated.id), 13);
  assert.equal(await db.stockMovement.count({ where: { documentId: pending.id } }), 2); assert.equal((await getInventoryDocument(pending.id))?.voidReason, "ยกเลิกการเบิก");
  const replayedVoid = await createInventoryDocument(request); assert.equal(replayedVoid?.id, pending.id); assert.equal(replayedVoid?.status, "VOID");
  assert.equal(await balance(shop.id, product.id), 20); assert.equal(await db.stockMovement.count({ where: { documentId: pending.id } }), 2);
  await assert.rejects(() => postInventoryDocument(pending.id, actor.id), /ยกเลิก/);
  pass("concurrent approvals deduct once using earliest expiry first; concurrent cancellations restore the exact original lots once with before/after history");

  const move = await createInventoryDocument({ ...request, kind: "MOVE", requestKey: uniqueKey(), reason: "ย้ายมาหน้าร้าน", fromLocation: "คลัง", toLocation: "หน้าร้าน", items: [{ ingredientId: product.id, qty: 7 }], postImmediately: true });
  assert(move); assert.equal(move.status, "POSTED"); assert.equal(await balance(shop.id, product.id), 20); assert.deepEqual(await Promise.all([lotQty(early.id), lotQty(late.id), lotQty(undated.id)]), [2, 5, 13]);
  const moveMovement = await db.stockMovement.findFirst({ where: { documentId: move.id } }); assert.equal(moveMovement.qty, 0); assert.equal(moveMovement.beforeQty, 20); assert.equal(moveMovement.afterQty, 20);
  const menu = await db.menuItem.create({ data: { name: `${tag}_drink`, category: tag, basePrice: 30 } }); menuIds.push(menu.id);
  await db.recipe.create({ data: { menuItemId: menu.id, ingredientId: product.id, qty: 1 } });
  await db.storeSetting.create({ data: { branchId: shop.id, vatMode: "NONE", vatRate: 0, paymentMethods: '["CASH"]', allowNegativeStock: false } });
  const shift = await db.shift.create({ data: { branchId: shop.id, userId: actor.id, openingCash: 0 } });
  const sale = await createOrder({ branchId: shop.id, customerId: null, shiftId: shift.id, userId: actor.id, items: [{ menuItemId: menu.id, qty: 2, modifiers: [] }], paymentMethod: "CASH", paymentDetails: { cashReceived: 60 }, discountType: null, discountValue: 0, loyaltyPointsToUse: 0, skipPromotions: true, idempotencyKey: uniqueKey() });
  assert.equal(sale.total, 60); assert.equal(await balance(shop.id, product.id), 18); assert.deepEqual(await Promise.all([lotQty(early.id), lotQty(late.id), lotQty(undated.id)]), [0, 5, 13]);
  await voidInventoryDocument(move.id, "กลับจุดเก็บเดิม", actor.id); assert.equal(await balance(shop.id, product.id), 18); assert.equal(await lotQty(early.id), 0);
  const sales = await getStockLedger(shop.id, { kind: "SALE" }); assert.equal(sales.items.length, 1); assert.equal(sales.items[0].actorName, actor.name); assert.equal(sales.items[0].reference, `บิลขาย #${sale.id}`);
  pass("MOVE keeps stock and lots unchanged; an ordinary recipe sale afterwards deducts only sold units, and cancelling the move adds no stock");

  for (const kind of ["GIFT", "LOSS"] as const) {
    const document = await createInventoryDocument({ ...request, kind, requestKey: uniqueKey(), items: [{ ingredientId: product.id, qty: 1 }, { ingredientId: product.id, qty: 2 }], postImmediately: true });
    assert(document); assert.equal(document.items.length, 1); assert.equal(await balance(shop.id, product.id), 15); assert.equal(await lotQty(late.id), 2);
    assert.equal(await db.stockMovement.count({ where: { documentId: document.id } }), 1);
    await voidInventoryDocument(document.id, "fixture correction", actor.id); assert.equal(await balance(shop.id, product.id), 18); assert.equal(await lotQty(late.id), 5);
  }
  const unused = await createInventoryDocument({ ...request, requestKey: uniqueKey() }); assert(unused); await voidInventoryDocument(unused.id, "ไม่เบิกแล้ว", actor.id);
  assert.equal(await balance(shop.id, product.id), 18); assert.equal(await db.stockMovement.count({ where: { documentId: unused.id } }), 0);
  pass("GIFT and LOSS each group repeated product lines, deduct the requested total once, and pending cancellation changes no stock");

  const damaged = await createInventoryDocument({ ...request, kind: "LOSS", requestKey: uniqueKey(), items: [{ ingredientId: product.id, qty: 1 }], postImmediately: true }); assert(damaged);
  assert.equal(await balance(shop.id, product.id), 17); const deleted = await db.inventoryLot.delete({ where: { id: late.id } });
  await assert.rejects(() => voidInventoryDocument(damaged.id, "cannot restore missing lot", actor.id), /ล็อตสินค้า/);
  assert.equal(await balance(shop.id, product.id), 17); assert.equal((await getInventoryDocument(damaged.id))?.status, "POSTED"); assert.equal(await db.stockMovement.count({ where: { documentId: damaged.id } }), 1);
  await db.inventoryLot.create({ data: deleted }); await voidInventoryDocument(damaged.id, "fixture correction", actor.id); assert.equal(await balance(shop.id, product.id), 18); assert.equal(await lotQty(late.id), 5);
  pass("a missing original lot refuses cancellation and rolls back stock/history/status together");

  const scarce = await ingredient("scarce"), second = await ingredient("second");
  await seedStock(raceShop.id, scarce.id, 5); await seedStock(raceShop.id, second.id, 2);
  const raceBase = { ...request, branchId: raceShop.id, items: [{ ingredientId: scarce.id, qty: 4 }], postImmediately: true };
  const race = await Promise.allSettled(Array.from({ length: 5 }, () => createInventoryDocument({ ...raceBase, requestKey: uniqueKey() })));
  assert.equal(race.filter((row) => row.status === "fulfilled").length, 1); assert.equal(await balance(raceShop.id, scarce.id), 1); assert.equal((await getInventoryDocuments(raceShop.id)).length, 1);
  const insufficient = await createInventoryDocument({ ...raceBase, postImmediately: false, requestKey: uniqueKey(), items: [{ ingredientId: scarce.id, qty: 1 }, { ingredientId: second.id, qty: 3 }] }); assert(insufficient);
  await assert.rejects(() => postInventoryDocument(insufficient.id, actor.id), /สต็อกไม่พอ/);
  assert.equal(await balance(raceShop.id, scarce.id), 1); assert.equal(await balance(raceShop.id, second.id), 2); assert.equal((await getInventoryDocument(insufficient.id))?.status, "PENDING"); assert.equal(await db.stockMovement.count({ where: { documentId: insufficient.id } }), 0);
  pass("competing issues cannot overspend; shortage in a second product rolls back every product and leaves the pending document untouched");

  const legacyRows = [
    { createdAt: new Date("2026-10-11T16:59:59.999Z"), reason: "LEGACY_previous_day", qty: 1 },
    { createdAt: new Date("2026-10-11T17:00:00.000Z"), reason: "PO#999", qty: 2 },
    { createdAt: new Date("2026-10-12T16:59:59.999Z"), reason: "LEGACY_adjustment", qty: -1 },
    { createdAt: new Date("2026-10-12T17:00:00.000Z"), reason: "LEGACY_next_day", qty: 3 },
    { createdAt: new Date("2026-10-12T00:00:00.000Z"), reason: "DOC_VOID_MOVE#999", qty: 0 },
    { createdAt: new Date("2026-10-12T00:00:00.000Z"), reason: "PO_VOID#999", qty: -2 },
    { createdAt: new Date("2026-10-12T00:00:00.000Z"), reason: "STOCKTAKE#999: นับได้ 1 (ระบบ 0)", qty: 1 },
    { createdAt: new Date("2026-10-12T00:00:00.000Z"), reason: "TRANSFER_IN#999", qty: 1 },
    { createdAt: new Date("2026-10-12T00:00:00.000Z"), reason: "OUT: ใช้ในร้าน · เครื่องดื่มพนักงาน", qty: -1 },
    { createdAt: new Date("2026-10-12T00:00:00.000Z"), reason: "OUT: แจก/ชิม · ทดลองสินค้า", qty: -1 },
    { createdAt: new Date("2026-10-12T00:00:00.000Z"), reason: "OUT: ของเสีย/หมดอายุ · บิลเก่า", qty: -1 }
  ];
  await db.stockMovement.createMany({ data: legacyRows.map((row) => ({ ...row, branchId: ledgerShop.id, ingredientId: product.id })) });
  await db.stockMovement.create({ data: { branchId: otherShop.id, ingredientId: product.id, qty: 99, reason: "LEGACY_hidden", createdAt: new Date("2026-10-12T00:00:00.000Z") } });
  const localDay = await getStockLedger(ledgerShop.id, { from: "2026-10-12", to: "2026-10-12", limit: 100 });
  assert.equal(localDay.total, 9); assert(!localDay.items.some((row) => /previous_day|next_day|hidden/.test(row.reason))); assert(localDay.items.some((row) => row.reason === "PO#999")); assert(localDay.items.some((row) => row.reason === "LEGACY_adjustment"));
  assert(localDay.items.every((row) => row.beforeQty === null && row.afterQty === null && row.actorName === null));
  for (const kind of ["RECEIVE", "RETURN", "MOVE", "COUNT", "TRANSFER", "ADJUSTMENT", "USE", "GIFT", "LOSS"]) {
    const filtered = await getStockLedger(ledgerShop.id, { from: "2026-10-12", to: "2026-10-12", kind }); assert.equal(filtered.total, 1, `legacy movement filter ${kind} must match its real writer`); assert.equal(filtered.items[0].kind, kind);
  }
  const pages = await Promise.all([1, 2, 3].map((page) => getStockLedger(ledgerShop.id, { from: "2026-10-12", to: "2026-10-12", limit: 3, page })));
  const pageIds = pages.flatMap((page) => page.items.map((row) => row.id)); assert.equal(new Set(pageIds).size, 9); assert.deepEqual(pageIds, localDay.items.map((row) => row.id));
  assert.equal((await getStockLedger(ledgerShop.id, { ingredientId: scarce.id })).total, 0);
  await assert.rejects(() => getStockLedger(ledgerShop.id, { from: "2026-02-30" }), /วันที่/);
  await assert.rejects(() => getStockLedger(ledgerShop.id, { from: "2026-10-13", to: "2026-10-12" }), /วันที่เริ่มต้น/);
  await assert.rejects(() => getStockLedger(ledgerShop.id, { kind: "INVALID" }), /ประเภท/);
  pass("ledger preserves unknown legacy balances, isolates branches/products, filters each movement kind, paginates without overlaps and honors Bangkok midnight boundaries");

  const exportStart = await getStockLedger(ledgerShop.id, { from: "2026-10-12", to: "2026-10-12", limit: 3, page: 1 });
  assert(Number.isSafeInteger(exportStart.snapshotId) && exportStart.snapshotId > 0, "export must capture an integer movement boundary before later pages are requested");
  assert.equal(exportStart.total, 9);
  const newlyInserted = await db.stockMovement.create({ data: { branchId: ledgerShop.id, ingredientId: product.id, qty: 1, reason: "LEGACY_inserted_during_export", createdAt: new Date("2026-10-12T00:00:00.000Z") } });
  assert(newlyInserted.id > exportStart.snapshotId);
  const exportRest = await Promise.all([2, 3].map((page) => getStockLedger(ledgerShop.id, { from: "2026-10-12", to: "2026-10-12", limit: 3, page, snapshotId: exportStart.snapshotId })));
  assert(exportRest.every((page) => page.total === exportStart.total && page.snapshotId === exportStart.snapshotId), "later export pages must preserve the original count and snapshot boundary");
  const frozenExportIds = [exportStart, ...exportRest].flatMap((page) => page.items.map((row) => row.id));
  assert.equal(new Set(frozenExportIds).size, 9); assert.deepEqual(frozenExportIds, localDay.items.map((row) => row.id));
  assert(!frozenExportIds.includes(newlyInserted.id), "a movement written during CSV export belongs to a later export");
  const currentLedger = await getStockLedger(ledgerShop.id, { from: "2026-10-12", to: "2026-10-12", limit: 100 });
  assert.equal(currentLedger.total, 10); assert.equal(currentLedger.items[0].id, newlyInserted.id);
  const emptyExport = await getStockLedger(ledgerShop.id, { snapshotId: 0 });
  assert.equal(emptyExport.snapshotId, 0); assert.equal(emptyExport.total, 0); assert.deepEqual(emptyExport.items, []);
  for (const snapshotId of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(() => getStockLedger(ledgerShop.id, { snapshotId }), `invalid snapshot boundary ${snapshotId} must be rejected`);
  pass("ledger export retains every original movement exactly once across pages when a new movement is inserted; new exports include it and invalid snapshot boundaries are rejected");

  const manual = await ingredient("manual"), missing = await ingredient("missing"); await seedStock(shop.id, manual.id, 5);
  const manualEarly = await db.inventoryLot.create({ data: { branchId: shop.id, ingredientId: manual.id, lotNo: "MANUAL-EARLY", qty: 2, expiryDate: new Date("2027-01-01") } });
  const manualLate = await db.inventoryLot.create({ data: { branchId: shop.id, ingredientId: manual.id, lotNo: "MANUAL-LATE", qty: 3, expiryDate: new Date("2027-02-01") } });
  const manualRace = await Promise.allSettled(Array.from({ length: 5 }, () => adjustStock({ branchId: shop.id, ingredientId: manual.id, qty: -4, reason: "MANUAL_QA", actorUserId: actor.id })));
  assert.equal(manualRace.filter((row) => row.status === "fulfilled").length, 1); assert.equal(await balance(shop.id, manual.id), 1);
  assert.equal(await lotQty(manualEarly.id), 0); assert.equal(await lotQty(manualLate.id), 1);
  const manualMovement = await db.stockMovement.findFirst({ where: { branchId: shop.id, ingredientId: manual.id } }); assert.equal(manualMovement.beforeQty, 5); assert.equal(manualMovement.afterQty, 1); assert.equal(manualMovement.actorUserId, actor.id);
  await assert.rejects(() => adjustStock({ branchId: shop.id, ingredientId: missing.id, qty: -1, reason: "MANUAL_QA" }), /สต็อกไม่พอ/); assert.equal(await db.ingredientStock.count({ where: { branchId: shop.id, ingredientId: missing.id } }), 0);
  const transaction = db.$transaction.bind(db);
  db.$transaction = (fn: any, options: any) => transaction((tx: any) => fn(new Proxy(tx, { get(target, key) { return key === "stockMovement" ? { create: async () => { throw new Error("Fixture stock movement failure"); } } : target[key]; } })), options);
  try { await assert.rejects(() => adjustStock({ branchId: shop.id, ingredientId: manual.id, qty: 5, reason: "MANUAL_QA" }), /Fixture stock movement failure/); }
  finally { db.$transaction = transaction; }
  assert.equal(await balance(shop.id, manual.id), 1); assert.equal(await db.stockMovement.count({ where: { branchId: shop.id, ingredientId: manual.id } }), 1);
  assert.equal(await lotQty(manualEarly.id), 0); assert.equal(await lotQty(manualLate.id), 1);
  db.$transaction = (fn: any, options: any) => transaction((tx: any) => fn(new Proxy(tx, { get(target, key) { return key === "stockMovement" ? { create: async () => { throw new Error("Fixture manual lot failure"); } } : target[key]; } })), options);
  try { await assert.rejects(() => adjustStock({ branchId: shop.id, ingredientId: manual.id, qty: -1, reason: "MANUAL_QA" }), /Fixture manual lot failure/); }
  finally { db.$transaction = transaction; }
  assert.equal(await balance(shop.id, manual.id), 1); assert.equal(await lotQty(manualLate.id), 1);
  pass("manual stock changes cannot race below zero; failed history write rolls back the balance and rejected missing-stock subtraction creates no row");

  const measured = await ingredient("measured", "กรัม"); await seedStock(shop.id, measured.id, 0.3);
  for (let index = 0; index < 3; index++) await createInventoryDocument({ ...request, requestKey: uniqueKey(), items: [{ ingredientId: measured.id, qty: 0.1 }], postImmediately: true });
  assert.equal(await balance(shop.id, measured.id), 0);
  pass("measured quantities can consume 0.3 as three 0.1 issues without floating-point residue or a false shortage");
  const measuredManual = await ingredient("measured_manual", "กรัม"); await seedStock(shop.id, measuredManual.id, 0.3);
  for (let index = 0; index < 3; index++) await adjustStock({ branchId: shop.id, ingredientId: measuredManual.id, qty: -0.1, reason: "MANUAL_QA", actorUserId: actor.id });
  assert.equal(await balance(shop.id, measuredManual.id), 0);
  pass("manual measured subtraction also reaches zero without a false negative-stock rejection");
}
try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (branchIds.length) {
    const orders = await db.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } }); const orderIds = orders.map((order: any) => order.id);
    await db.integrationOutbox.deleteMany({ where: { entityType: "order", entityId: { in: orderIds } } });
    await db.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } }); await db.payment.deleteMany({ where: { orderId: { in: orderIds } } }); await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }); await db.order.deleteMany({ where: { branchId: { in: branchIds } } });
    await db.shift.deleteMany({ where: { branchId: { in: branchIds } } }); await db.storeSetting.deleteMany({ where: { branchId: { in: branchIds } } });
    await db.inventoryLot.deleteMany({ where: { branchId: { in: branchIds } } }); await db.stockMovement.deleteMany({ where: { branchId: { in: branchIds } } }); await db.inventoryDocument.deleteMany({ where: { branchId: { in: branchIds } } });
    await db.recipe.deleteMany({ where: { menuItemId: { in: menuIds } } }); await db.menuItem.deleteMany({ where: { id: { in: menuIds } } }); await db.ingredientStock.deleteMany({ where: { branchId: { in: branchIds } } }); await db.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } }); await db.branch.deleteMany({ where: { id: { in: branchIds } } });
  }
  await db.$disconnect();
}
