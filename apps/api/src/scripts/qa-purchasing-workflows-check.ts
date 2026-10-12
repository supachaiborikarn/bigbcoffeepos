import assert from "node:assert/strict";
import prisma from "../prisma.js";
import { createPurchase, approvePurchase, receivePurchase, voidPurchase, getPurchase, getPurchases, validatePurchaseAttachment } from "../store/purchases.js";

const target = new URL(process.env.DATABASE_URL ?? "invalid:");
if (process.env.QA_DISPOSABLE_DB !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !/^\/benzpos_qa(?:_|$)/.test(target.pathname)) {
  throw new Error("Set QA_DISPOSABLE_DB=true and an explicit local benzpos_qa DATABASE_URL; do not use production data");
}
const db = prisma as any;
const pass = (message: string) => console.log(`PASS ${message}`);
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=";
let branchIds: number[] = [];
let ingredientIds: number[] = [];
let userId: number | undefined;
async function main() {
  const tag = `QA_PURCHASING_${Date.now()}`;
  const branch = await db.branch.create({ data: { name: tag } });
  const otherBranch = await db.branch.create({ data: { name: `${tag}_other` } });
  branchIds = [branch.id, otherBranch.id];
  const actor = await db.user.create({ data: { name: `${tag}_actor`, pin: "fixture-only", role: "manager", branchId: branch.id } });
  userId = actor.id;
  const bottle = await db.ingredient.create({ data: { name: `${tag}_bottle`, unit: "ขวด", costPerUnit: 10 } });
  const weight = await db.ingredient.create({ data: { name: `${tag}_weight`, unit: "กรัม", costPerUnit: 6 } });
  ingredientIds = [bottle.id, weight.id];
  await db.ingredientStock.create({ data: { branchId: branch.id, ingredientId: bottle.id, stockQty: 3, reorderLevel: 10 } });
  const stock = async () => (await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: bottle.id } } })).stockQty;

  assert.equal(validatePurchaseAttachment(image).attachmentName, "รูปบิล.png");
  assert.throws(() => validatePurchaseAttachment("data:image/jpeg;base64,YmFkZmlsZQ=="), /ชนิดไฟล์/);
  assert.throws(() => validatePurchaseAttachment(`data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64")}`), /2 MB/);
  assert.throws(() => validatePurchaseAttachment("https://example.test/bill.png"), /JPEG/);
  pass("bill attachments reject invalid signatures, external URLs and over 2 MB");

  const lines = [{ ingredientId: bottle.id, qty: 6, unitCost: 20, packSize: 3, description: "2 แพ็ค × 3", lotNo: "ORDER-LOT", expiryDate: "2027-01-01" }];
  const options = { mode: "ORDER" as const, invoiceNumber: "INV-001", documentDate: "2026-10-12", dueDate: "2026-11-12", requestKey: `${tag}_create`, createdByUserId: actor.id, attachmentDataUrl: image, attachmentName: "บิลต้นฉบับ.png" };
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => createPurchase(branch.id, "  Supplier  Name ", "original", lines, options)));
  const po = concurrent[0]!;
  assert(po); assert(concurrent.every((result) => result?.id === po.id));
  assert.equal(await db.purchase.count({ where: { branchId: branch.id } }), 1);
  assert.equal(po.status, "PENDING"); assert.equal(po.receivedAt, null); assert.equal(po.totalCost, 120); assert.equal(po.items[0].receivedQty, 0);
  assert.equal(await stock(), 3); assert.equal(await db.stockMovement.count({ where: { branchId: branch.id } }), 0);
  await assert.rejects(() => createPurchase(branch.id, "Supplier Name", "changed", lines, options), /รหัสคำขอ/);
  await assert.rejects(() => receivePurchase(po.id, [{ purchaseItemId: po.items[0].id, qty: 1 }]), /อนุมัติ/);
  await assert.rejects(() => createPurchase(branch.id, "supplier name", "duplicate", lines, { mode: "ORDER", invoiceNumber: "inv-001" }), /เลขบิลนี้/);
  const other = await createPurchase(otherBranch.id, "supplier name", "different branch", lines, { mode: "ORDER", invoiceNumber: "inv-001" });
  assert(other);
  const listed = (await getPurchases(branch.id, { query: "INV-001", status: "PENDING" }))[0];
  assert.equal(listed.id, po.id); assert.equal(listed.hasAttachment, true); assert(!Object.hasOwn(listed, "attachmentDataUrl"));
  assert.equal(listed.createdByName, actor.name); assert.equal((await getPurchase(po.id))?.attachmentDataUrl, image);
  pass("simultaneous retries create one pending PO with original bill; normalized duplicate bill is blocked per supplier/branch and list avoids image bytes");

  const invoiceRace = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => createPurchase(branch.id, index % 2 ? "supplier name" : "  Supplier   Name  ", "competing invoice", lines, { mode: "ORDER", invoiceNumber: index % 2 ? "race-002" : "RACE-002", requestKey: `${tag}_invoice_${index}` })));
  assert.equal(invoiceRace.filter((result) => result.status === "fulfilled").length, 1);
  pass("the database invoice index blocks simultaneous duplicates with different retry keys");

  await Promise.all([approvePurchase(po.id, actor.id), approvePurchase(po.id, actor.id)]);
  assert.equal(await stock(), 3); assert.equal((await getPurchase(po.id))?.approvedByName, actor.name);
  const firstItems = [{ purchaseItemId: po.items[0].id, qty: 2, lotNo: "DELIVERY-A", expiryDate: "2027-02-01", packSize: 2 }];
  const receiptOptions = { requestKey: `${tag}_receive_1`, receivedAt: "2026-10-12T00:00:00+07:00", actorUserId: actor.id, updateCost: true };
  const first = await Promise.all(Array.from({ length: 6 }, () => receivePurchase(po.id, firstItems, receiptOptions)));
  assert(first.every((result) => result?.receiptId === first[0]?.receiptId));
  assert.equal(await stock(), 5); assert.equal(first[0]?.status, "PARTIAL"); assert.equal(first[0]?.items[0].receivedQty, 2); assert.equal(first[0]?.items[0].remainingQty, 4);
  assert.equal(first[0]?.receipts.length, 1); assert.equal(first[0]?.receipts[0].items[0].lotNo, "DELIVERY-A"); assert.equal(first[0]?.receipts[0].items[0].packSize, 2);
  assert.equal((await db.ingredient.findUnique({ where: { id: bottle.id } })).costPerUnit, 14);
  const movement = await db.stockMovement.findFirst({ where: { reason: `PO#${po.id}` } });
  assert.equal(movement.beforeQty, 3); assert.equal(movement.afterQty, 5); assert.equal(movement.actorUserId, actor.id);
  await assert.rejects(() => receivePurchase(po.id, [{ purchaseItemId: po.items[0].id, qty: 5 }]), /เกินจำนวน/);
  await assert.rejects(() => receivePurchase(po.id, [{ purchaseItemId: po.items[0].id, qty: 0.5 }]), /จำนวนเต็ม/);
  await assert.rejects(() => receivePurchase(po.id, [{ purchaseItemId: po.items[0].id, qty: 1 }], receiptOptions), /รหัสคำขอ/);
  await assert.rejects(() => receivePurchase(po.id, [{ purchaseItemId: po.items[0].id, qty: 1 }, { purchaseItemId: po.items[0].id, qty: 1 }]), /ซ้ำ/);
  pass("approval keeps stock unchanged; repeated partial delivery posts once with lot/pack/date/actor snapshots, weighted costs and exact before/after balances");

  await db.ingredient.update({ where: { id: bottle.id }, data: { name: `${tag}_renamed`, unit: "ใบ" } });
  const finished = await receivePurchase(po.id, [{ purchaseItemId: po.items[0].id, qty: 4 }], { requestKey: `${tag}_receive_2`, actorUserId: actor.id });
  assert.equal(finished?.status, "RECEIVED"); assert.equal(finished?.items[0].ingredientName, bottle.name); assert.equal(finished?.items[0].unit, "ขวด");
  assert.equal(finished?.receipts.length, 2); assert.equal(finished?.items[0].receivedQty, 6); assert.equal(finished?.receivedCost, 120); assert.equal(await stock(), 9);
  await assert.rejects(() => receivePurchase(po.id, [{ purchaseItemId: po.items[0].id, qty: 1 }]), /ยังรับไม่ครบ/);
  await Promise.all(Array.from({ length: 6 }, () => voidPurchase(po.id, "fixture correction", actor.id)));
  assert.equal(await stock(), 3); assert.equal(await db.stockMovement.count({ where: { reason: `PO_VOID#${po.id}` } }), 1);
  assert.equal((await getPurchase(po.id))?.status, "VOID"); assert.equal((await getPurchase(po.id))?.receipts.length, 2);
  assert.equal(await db.inventoryLot.count({ where: { purchaseId: po.id } }), 0);
  const replacement = await createPurchase(branch.id, "supplier name", "replacement", [{ ingredientId: bottle.id, qty: 1, unitCost: 0 }], { invoiceNumber: "INV-001" });
  assert(replacement); await approvePurchase(replacement.id, actor.id); assert.equal((await getPurchase(replacement.id))?.status, "RECEIVED");
  await voidPurchase(replacement.id, "fixture correction");
  pass("final receive preserves original product snapshots; simultaneous voids reverse once, retain receipt history and release invoice number; legacy approval remains received");

  const pending = await createPurchase(branch.id, "Supplier", "cancel unreceived order", lines, { mode: "ORDER" });
  assert(pending); await voidPurchase(pending.id, "no longer needed"); assert.equal(await stock(), 3);
  const partial = await createPurchase(branch.id, "Supplier", "partial cancellation", lines, { mode: "ORDER" });
  assert(partial); await approvePurchase(partial.id, actor.id);
  await receivePurchase(partial.id, [{ purchaseItemId: partial.items[0].id, qty: 2 }]);
  await voidPurchase(partial.id, "remaining delivery cancelled"); assert.equal(await stock(), 3);
  const consumed = await createPurchase(branch.id, "Supplier", "tracked consumption", [{ ingredientId: bottle.id, qty: 2, unitCost: 10, lotNo: "USED", expiryDate: "2027-01-01" }]);
  assert(consumed);
  const lot = await db.inventoryLot.findFirst({ where: { purchaseId: consumed.id } });
  await db.inventoryLot.update({ where: { id: lot.id }, data: { qty: 1 } });
  await assert.rejects(() => voidPurchase(consumed.id, "must refuse consumed lot"), /ล็อต.*ถูกใช้/);
  assert.equal(await stock(), 5); assert.equal((await getPurchase(consumed.id))?.status, "RECEIVED");
  await db.inventoryLot.update({ where: { id: lot.id }, data: { qty: 2 } });
  await db.ingredientStock.update({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: bottle.id } }, data: { stockQty: 1 } });
  await assert.rejects(() => voidPurchase(consumed.id, "must refuse negative stock"), /คงเหลือน้อย/);
  assert.equal(await stock(), 1); assert.equal((await getPurchase(consumed.id))?.status, "RECEIVED");
  await db.ingredientStock.update({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: bottle.id } }, data: { stockQty: 5 } });
  await voidPurchase(consumed.id, "fixture cleanup");
  pass("unreceived/partial PO cancellation deducts only actual received units; consumed lots and insufficient stock are rejected atomically");

  const concurrentPO = await createPurchase(branch.id, "Supplier", "competing final receive", [{ ingredientId: weight.id, qty: 1.5, unitCost: 8 }], { mode: "ORDER" });
  assert(concurrentPO); await approvePurchase(concurrentPO.id, actor.id);
  const competing = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => receivePurchase(concurrentPO.id, [{ purchaseItemId: concurrentPO.items[0].id, qty: 1.5 }], { requestKey: `${tag}_final_${index}` })));
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: weight.id } } })).stockQty, 1.5);
  pass("different simultaneous receive requests cannot over-receive a PO; measured units allow fractions");

  const rollbackPO = await createPurchase(branch.id, "Supplier", "partial receipt rollback", [{ ingredientId: bottle.id, qty: 2, unitCost: 12 }], { mode: "ORDER" });
  assert(rollbackPO); await approvePurchase(rollbackPO.id, actor.id);
  const originalTransaction = db.$transaction.bind(db);
  db.$transaction = (fn: any, options: any) => originalTransaction((tx: any) => fn(new Proxy(tx, { get(target, key) { return key === "stockMovement" ? { createMany: async () => { throw new Error("Fixture partial receipt failure"); } } : target[key]; } })), options);
  try { await assert.rejects(() => receivePurchase(rollbackPO.id, [{ purchaseItemId: rollbackPO.items[0].id, qty: 1 }]), /Fixture partial receipt failure/); }
  finally { db.$transaction = originalTransaction; }
  const unchangedPO = await getPurchase(rollbackPO.id);
  assert.equal(unchangedPO?.status, "APPROVED"); assert.equal(unchangedPO?.receipts.length, 0); assert.equal(unchangedPO?.items[0].receivedQty, 0); assert.equal(await stock(), 3);
  pass("partial receive failure rolls back stock, received quantity and receipt history together");

  const guarded = await createPurchase(branch.id, "Supplier", "overlapping lot consumption", [{ ingredientId: bottle.id, qty: 2, unitCost: 10, lotNo: "CONCURRENT-LOT", expiryDate: "2027-01-01" }]);
  assert(guarded);
  const guardedLot = await db.inventoryLot.findFirst({ where: { purchaseId: guarded.id } });
  let releaseStock!: () => void, announceStock!: () => void;
  const stockGate = new Promise<void>((resolve) => { releaseStock = resolve; });
  const stockLocked = new Promise<void>((resolve) => { announceStock = resolve; });
  const consumer = db.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM ingredient_stocks WHERE branch_id = ${branch.id} AND ingredient_id = ${bottle.id} FOR UPDATE`;
    announceStock(); await stockGate;
    await tx.ingredientStock.update({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: bottle.id } }, data: { stockQty: { decrement: 1 } } });
    await tx.inventoryLot.update({ where: { id: guardedLot.id }, data: { qty: { decrement: 1 } } });
  }, { timeout: 10000 });
  await stockLocked;
  const overlappingVoid = voidPurchase(guarded.id, "overlapping cancellation").then((purchase) => ({ purchase, error: null as Error | null }), (error: Error) => ({ purchase: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
      const activity = await db.$queryRaw`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%ingredient_stocks%'`;
      waiting = Number(activity[0]?.count) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(waiting, "cancellation must overlap the stock-first lot consumer");
  } finally { releaseStock(); await consumer; }
  const blockedVoid = await overlappingVoid;
  assert.match(blockedVoid.error?.message ?? "", /ล็อต.*ถูกใช้/);
  assert.equal(await stock(), 4); assert.equal((await getPurchase(guarded.id))?.status, "RECEIVED");
  assert.equal((await db.inventoryLot.findUnique({ where: { id: guardedLot.id } })).qty, 1);
  assert.equal(await db.stockMovement.count({ where: { reason: `PO_VOID#${guarded.id}` } }), 0);
  await db.inventoryLot.update({ where: { id: guardedLot.id }, data: { qty: 2 } });
  await db.ingredientStock.update({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: bottle.id } }, data: { stockQty: 5 } });
  await voidPurchase(guarded.id, "fixture cleanup");
  pass("receipt cancellation waits for an overlapping stock/lot consumer and then refuses the consumed lot without changing stock/history/status");

  const costRaceIngredient = await db.ingredient.create({ data: { name: `${tag}_cost_race`, unit: "ขวด", costPerUnit: 10 } }); ingredientIds.push(costRaceIngredient.id);
  await db.ingredientStock.create({ data: { branchId: branch.id, ingredientId: costRaceIngredient.id, stockQty: 10 } });
  let releaseCostStock!: () => void, announceCostStock!: () => void;
  const costGate = new Promise<void>((resolve) => { releaseCostStock = resolve; });
  const costStockLocked = new Promise<void>((resolve) => { announceCostStock = resolve; });
  const overlappingSale = db.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM ingredient_stocks WHERE branch_id = ${branch.id} AND ingredient_id = ${costRaceIngredient.id} FOR UPDATE`;
    announceCostStock(); await costGate;
    await tx.ingredientStock.update({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: costRaceIngredient.id } }, data: { stockQty: 0 } });
    // This real movement insert takes the Ingredient FK's KEY SHARE lock, as
    // checkout and issue approval do after changing their locked stock row.
    await tx.stockMovement.create({ data: { branchId: branch.id, ingredientId: costRaceIngredient.id, qty: -10, reason: "QA overlapping consumption" } });
  }, { timeout: 10000 }).then(() => ({ error: null as Error | null }), (error: Error) => ({ error }));
  await costStockLocked;
  const overlappingReceipt = createPurchase(branch.id, "Supplier", "weighted cost during sale", [{ ingredientId: costRaceIngredient.id, qty: 10, unitCost: 30 }], { updateCost: true }).then((purchase) => ({ purchase, error: null as Error | null }), (error: Error) => ({ purchase: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
      const activity = await db.$queryRaw`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%ingredient_stocks%'`;
      waiting = Number(activity[0]?.count) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(waiting, "receipt must overlap the stock consumer before computing its weighted cost");
  } finally { releaseCostStock(); }
  const [consumedCostStock, receivedCostStock] = await Promise.all([overlappingSale, overlappingReceipt]);
  assert.equal(consumedCostStock.error, null, "sale movement FK must not deadlock with a receipt cost lock");
  assert.equal(receivedCostStock.error, null, "receipt must not deadlock with a stock-first sale");
  assert.equal((await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: costRaceIngredient.id } } })).stockQty, 10);
  assert.equal((await db.ingredient.findUnique({ where: { id: costRaceIngredient.id } })).costPerUnit, 30, "only the actual remaining delivery should determine cost after all previous stock was consumed");
  const managerReceipt = await createPurchase(branch.id, "Supplier", "manager does not change shared cost", [{ ingredientId: costRaceIngredient.id, qty: 1, unitCost: 100 }], { updateCost: false });
  assert(managerReceipt); assert.equal(managerReceipt.costChanges.length, 0); assert.equal((await db.ingredient.findUnique({ where: { id: costRaceIngredient.id } })).costPerUnit, 30);
  pass("a stock-first sale and receiving both finish without FK deadlock; weighted cost uses stock after consumption and updateCost=false leaves shared cost unchanged");

  const countsBefore = await db.purchase.count({ where: { branchId: branch.id } });
  const transaction = db.$transaction.bind(db);
  db.$transaction = (fn: any, options: any) => transaction((tx: any) => fn(new Proxy(tx, { get(target, key) { return key === "stockMovement" ? { createMany: async () => { throw new Error("Fixture movement failure"); } } : target[key]; } })), options);
  try { await assert.rejects(() => createPurchase(branch.id, "Supplier", "rollback", [{ ingredientId: bottle.id, qty: 1, unitCost: 12 }]), /Fixture movement failure/); }
  finally { db.$transaction = transaction; }
  assert.equal(await db.purchase.count({ where: { branchId: branch.id } }), countsBefore); assert.equal(await stock(), 3);
  await assert.rejects(() => createPurchase(branch.id, "Supplier", "bad expiry", [{ ingredientId: bottle.id, qty: 1, unitCost: 12, expiryDate: "2027-02-30" }]), /วันหมดอายุ/);
  await assert.rejects(() => createPurchase(branch.id, "Supplier", "negative cost", [{ ingredientId: bottle.id, qty: 1, unitCost: -1 }]), /ราคา/);
  pass("failure after stock update rolls back receipt/document/stock; invalid dates and negative costs are rejected");
}
try { await main(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (branchIds.length) {
    await db.inventoryLot.deleteMany({ where: { branchId: { in: branchIds } } });
    await db.stockMovement.deleteMany({ where: { branchId: { in: branchIds } } });
    const purchases = await db.purchase.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
    await db.purchaseItem.deleteMany({ where: { purchaseId: { in: purchases.map((po: any) => po.id) } } });
    await db.purchase.deleteMany({ where: { branchId: { in: branchIds } } });
    await db.ingredientStock.deleteMany({ where: { branchId: { in: branchIds } } });
    await db.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.branch.deleteMany({ where: { id: { in: branchIds } } });
  }
  await db.$disconnect();
}
