/** Run only against an explicitly marked, disposable local PostgreSQL database. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import prisma from "../prisma.js";
import { createBusinessDocument, createTaxInvoice, listBusinessDocuments } from "../store/parity.js";
import { createPurchase, voidPurchase } from "../store/purchases.js";
import { applyQaCleanup, buildQaCleanupPlan, type QaCleanupManifest } from "./qaCleanupPlan.js";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(import.meta.dirname, "../../../..");
const pass = (message: string) => console.log(`PASS ${message}`);
const sampleDate = new Date("2026-10-11T02:00:00Z");

function mockCleanup() {
  const data: Record<string, any[]> = {
    order: [
      { id: 2733, branchId: 2, createdAt: sampleDate, shiftId: 142, status: "CANCELLED", total: 65, paymentMethod: "CASH", items: [], payments: [], events: [] },
      { id: 2755, branchId: 2, createdAt: sampleDate, shiftId: 142, status: "REFUNDED", total: 65, paymentMethod: "CASH", items: [], payments: [], events: [] },
      { id: 2700, branchId: 2, createdAt: sampleDate, shiftId: 142, status: "PAID", total: 107, paymentMethod: "CASH", payments: [{ method: "CASH", status: "CONFIRMED", amountDue: 107 }] }
    ],
    businessDocument: [
      { id: 1, branchId: 2, customerName: "Real customer", payload: "{}", createdAt: sampleDate },
      { id: 2, branchId: 2, customerName: "QA customer", payload: "{}", createdAt: sampleDate }
    ],
    purchase: [{ id: 14, branchId: 2, createdAt: sampleDate, status: "VOID", items: [] }],
    stockCount: [{ id: 3, branchId: 2, createdAt: sampleDate, items: [] }],
    stockMovement: [
      { id: 1, branchId: 2, createdAt: sampleDate, reason: "PO_VOID#14", qty: -1 },
      { id: 2, branchId: 2, createdAt: sampleDate, reason: "STOCKTAKE#3: QA", qty: 1 },
      { id: 3, branchId: 2, createdAt: sampleDate, reason: "COUNT: actual Crystal count", qty: -2 },
      { id: 4, branchId: 2, createdAt: sampleDate, reason: "SALE-2755", qty: -1 }
    ],
    ingredientStock: [{ id: 1, branchId: 2, stockQty: 3 }],
    shift: [{ id: 142, status: "CLOSED", openingCash: 100, closingCash: 207, closedAt: sampleDate, expectedCash: 207, difference: 0 }],
    shiftCloseDetails: [{ id: 1, shiftId: 142, note: "closed correctly" }]
  };
  const writes: Array<{ model: string; method: string; query: any }> = [];
  const match = (row: any, where: any): boolean => !where || Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === "OR") return condition.some((x: any) => match(row, x));
    const actual = row[key];
    if (!condition || typeof condition !== "object" || condition instanceof Date) return actual === condition;
    if (condition.in && !condition.in.includes(actual)) return false;
    if (condition.notIn && condition.notIn.includes(actual)) return false;
    if (condition.gte && new Date(actual) < condition.gte) return false;
    if (condition.lt && new Date(actual) >= condition.lt) return false;
    const value = condition.mode === "insensitive" ? String(actual).toLowerCase() : String(actual);
    if (condition.contains && !value.includes(condition.mode === "insensitive" ? condition.contains.toLowerCase() : condition.contains)) return false;
    if (condition.startsWith && !value.startsWith(condition.mode === "insensitive" ? condition.startsWith.toLowerCase() : condition.startsWith)) return false;
    return true;
  });
  const db: any = new Proxy({}, { get(_, model: string) {
    if (model === "$transaction") return async (fn: any, options: any) => { assert.equal(options.isolationLevel, "Serializable"); return fn(db); };
    return {
      findMany: async (q: any) => (data[model] ?? []).filter((row) => match(row, q.where)).map((row) => structuredClone(row)),
      count: async (q: any) => (data[model] ?? []).filter((row) => match(row, q.where)).length,
      deleteMany: async (q: any) => { writes.push({ model, method: "deleteMany", query: q }); const kept = (data[model] ?? []).filter((row) => !match(row, q.where)); data[model] = kept; return { count: 0 }; },
      update: async (q: any) => { writes.push({ model, method: "update", query: q }); Object.assign(data[model].find((row) => row.id === q.where.id), q.data); }
    };
  } });
  return { db, data, writes };
}

async function cleanupChecks() {
  const fixture = mockCleanup();
  const plan = await buildQaCleanupPlan(fixture.db);
  assert.deepEqual(plan.rows.orders.map((row) => row.id), [2733, 2755]);
  assert.deepEqual(plan.rows.documents.map((row) => row.id), [2]);
  assert.deepEqual(plan.rows.movements.map((row) => row.id), [1, 2, 4]);
  const manifest: QaCleanupManifest = { version: 1, reviewed: false, generatedAt: sampleDate.toISOString(), plan };
  await assert.rejects(() => applyQaCleanup(fixture.db, manifest), /reviewed=true/);
  assert.equal(fixture.writes.length, 0);
  manifest.reviewed = true;
  fixture.data.businessDocument[1].customerName = "QA changed after review";
  await assert.rejects(() => applyQaCleanup(fixture.db, manifest), /ข้อมูลเปลี่ยน/);
  assert.equal(fixture.writes.length, 0);
  fixture.data.businessDocument[1].customerName = "QA customer";
  const stock = structuredClone(fixture.data.ingredientStock);
  const closing = structuredClone(fixture.data.shiftCloseDetails);
  await applyQaCleanup(fixture.db, manifest);
  assert.deepEqual(fixture.data.businessDocument.map((row) => row.id), [1]);
  assert.deepEqual(fixture.data.stockMovement.map((row) => row.id), [3]);
  assert.deepEqual(fixture.data.ingredientStock, stock);
  assert.deepEqual(fixture.data.shiftCloseDetails, closing);
  assert.equal(fixture.data.shift[0].status, "CLOSED");
  assert.equal(fixture.data.shift[0].closingCash, 207);
  assert.equal(fixture.data.shift[0].cashSales, 107);
  assert(!fixture.writes.some((write) => ["ingredientStock", "storeSetting", "user", "shiftCloseDetails"].includes(write.model)));
  const usedUnit = mockCleanup();
  usedUnit.data.productUnit = [{ id: 1, menuItemId: 90, unitName: "QA pack" }];
  usedUnit.data.orderItem = [{ id: 1, orderId: 2700, menuItemId: 90 }];
  await assert.rejects(() => buildQaCleanupPlan(usedUnit.db), /หน่วย QA มีประวัติ/);
  assert.equal(usedUnit.writes.length, 0);
  pass("QA manifest includes #2755 and void/count references, excludes real documents and manual counts, revalidates before writes, preserves actual stock and closing records");
}

async function refreshChecks() {
  const file = resolve(projectRoot, "apps/web/src/pages/InventoryPage.tsx");
  const source = await readFile(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: any;
  function visit(node: any) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "refreshInventory") initializer = node.initializer; ts.forEachChild(node, visit); }
  visit(ast);
  assert(initializer);
  let releaseCoverage!: (value: any) => void;
  const coverage = new Promise((resolve) => { releaseCoverage = resolve; });
  const updates: string[] = [];
  const context: any = { refreshVersion: { current: 0 }, activeBranch: { id: 2, branchType: "coffee" }, getMenu: async () => [], getIngredients: async () => [], getInventory: async () => [{ stockQty: 3 }], getStockMovements: async () => [], getPurchases: async () => [{ id: 14 }], getRecipeCoverage: () => coverage, getCupStockSettings: async () => [], toast: { error: () => {} } };
  for (const key of ["setMenu", "setIngredients", "setSelectedProduct", "setSelectedRecipeProduct", "setInventory", "setMovements", "setPurchases", "setRecipeCoverage", "setCupStockDrafts"]) context[key] = () => updates.push(key);
  vm.runInNewContext(ts.transpileModule(`globalThis.run = ${initializer.getText(ast)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const pending = context.run();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert(updates.includes("setInventory") && updates.includes("setPurchases"));
  assert(!updates.includes("setRecipeCoverage"));
  context.refreshVersion.current += 1;
  releaseCoverage({ items: [] });
  await pending;
  assert(!updates.includes("setRecipeCoverage"));
  pass("actual inventory refresh renders stock/receipt history before slow coverage and ignores results from an older refresh");
}

function taxId() {
  const digits = "123456789012";
  const sum = [...digits].reduce((value, digit, index) => value + Number(digit) * (13 - index), 0);
  return digits + String((11 - sum % 11) % 10);
}

async function databaseChecks() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.QA_DISPOSABLE_DB !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.includes("benzpos_qa")) throw new Error("Set QA_DISPOSABLE_DB=true and an explicit local benzpos_qa DATABASE_URL; production data must never be used");
  const db = prisma as any;
  const branch = await db.branch.create({ data: { name: `QA documents ${Date.now()}` } });
  const orderIds: number[] = [];
  const ingredientIds: number[] = [];
  try {
    await db.storeSetting.create({ data: { branchId: branch.id, shopName: "Fixture merchant", taxId: taxId(), addressLine: "Fixture address", branchLabel: "Fixture branch", vatMode: "INCLUSIVE", vatRate: 7, updatedAt: new Date("2026-01-01T00:00:00Z") } });
    const makeOrder = async () => { const order = await db.order.create({ data: { branchId: branch.id, status: "PAID", subtotal: 107, total: 107, tax: 7 } }); orderIds.push(order.id); return order; };
    const order = await makeOrder();
    const input = { orderId: order.id, buyerName: "Fixture buyer", buyerTaxId: taxId(), buyerAddress: "Fixture buyer address" };
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => createTaxInvoice(input)));
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    const live = await db.taxInvoice.findMany({ where: { orderId: order.id, status: "ISSUED" } });
    assert.equal(live.length, 1);
    assert.equal(await db.integrationOutbox.count({ where: { entityType: "tax_invoice", entityId: live[0].id, eventType: "TAX_INVOICE_ISSUED" } }), 1);
    pass("8 simultaneous actual PostgreSQL invoice requests produce one live invoice and one outbox event");
    const other = await makeOrder();
    await db.taxInvoice.createMany({ data: ["A", "B"].map((suffix) => ({ branchId: branch.id, orderId: other.id, invoiceNo: `LEGACY-DUP-${branch.id}-${suffix}`, buyerName: "Fixture buyer", total: 107, tax: 7 })) });
    await assert.rejects(() => createTaxInvoice({ ...input, orderId: other.id }), /ออกใบกำกับภาษีแล้ว/);
    assert.equal(await db.taxInvoice.count({ where: { orderId: other.id } }), 2);
    pass("historical duplicate invoices are preserved while another issue is blocked");
    const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", year: "numeric" }).format(new Date());
    await db.businessDocument.createMany({ data: [
      { branchId: branch.id, type: "INVOICE", documentNo: `INVO-${branch.id}-${year}-000007`, customerName: "Fixture buyer", total: 107 },
      { branchId: branch.id, type: "INVOICE", documentNo: `INV-${branch.id}-${year}-000011`, customerName: "Fixture buyer", total: 107 }
    ] });
    const made = await Promise.all(Array.from({ length: 4 }, () => createBusinessDocument({ branchId: branch.id, type: "INVOICE", customerName: "Fixture buyer", total: 107 })));
    assert.deepEqual(made.map((row) => row.documentNo).sort(), [12, 13, 14, 15].map((number) => `INVO-${branch.id}-${year}-${String(number).padStart(6, "0")}`));
    const documents = await listBusinessDocuments(branch.id);
    assert(documents.some((row: any) => row.documentNo === `INV-${branch.id}-${year}-000011`));
    pass("legacy document prefix continues after the highest number in either series; concurrent numbers stay unique and old documents stay unchanged");
    const legacy = await db.taxInvoice.create({ data: { branchId: branch.id, orderId: order.id, invoiceNo: `LEGACY-META-${branch.id}`, buyerName: "Fixture buyer", total: 107, tax: 7, status: "VOID", createdAt: sampleDate } });
    const unknownOrder = await makeOrder();
    const unknown = await db.taxInvoice.create({ data: { branchId: branch.id, orderId: unknownOrder.id, invoiceNo: `LEGACY-UNKNOWN-${branch.id}`, buyerName: "Fixture buyer", total: 107, tax: 7, status: "VOID", createdAt: new Date("2025-01-01T00:00:00Z") } });
    const sql = await readFile(resolve(projectRoot, "apps/api/prisma/migrations/202610110002_legacy_invoice_metadata/migration.sql"), "utf8");
    await db.$transaction(async (tx: any) => {
      // Apply the real migration statements only to this uniquely owned fixture branch.
      for (const statement of sql.replace(/--[^\n]*/g, "").split(";").map((text) => text.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement.replace('WHERE invoice."branch_id" = setting."branch_id"', `WHERE invoice."branch_id" = ${branch.id} AND invoice."branch_id" = setting."branch_id"`));
      const repaired = await tx.taxInvoice.findUnique({ where: { id: legacy.id } });
      assert.equal(repaired.sellerName, "Fixture merchant"); assert.equal(repaired.sellerTaxId, taxId()); assert.equal(repaired.sellerAddress, "Fixture address"); assert.equal(repaired.vatRate, 7); assert.equal(repaired.tax, 7); assert.equal(repaired.invoiceNo, legacy.invoiceNo);
      const untouched = await tx.taxInvoice.findUnique({ where: { id: unknown.id } });
      assert.equal(untouched.sellerTaxId, ""); assert.equal(untouched.sellerAddress, ""); assert.equal(untouched.vatRate, 0);
    });
    pass("real metadata migration repairs known historical settings/VAT and leaves unproven old tax/address/rate empty, preserving issued amounts and numbers");
    const bottle = await db.ingredient.create({ data: { name: `Fixture bottle ${branch.id}`, unit: "ขวด", costPerUnit: 10 } });
    const weight = await db.ingredient.create({ data: { name: `Fixture weight ${branch.id}`, unit: "กรัม", costPerUnit: 6 } });
    ingredientIds.push(bottle.id, weight.id);
    await db.ingredientStock.create({ data: { branchId: branch.id, ingredientId: bottle.id, stockQty: 3, reorderLevel: 10 } });
    const receipt = await createPurchase(branch.id, "Fixture supplier", "Fixture duplicate/free goods", [
      { ingredientId: bottle.id, qty: 2, unitCost: 20, expiryDate: "2027-01-01", lotNo: "Fixture lot A" },
      { ingredientId: bottle.id, qty: 3, unitCost: 0, expiryDate: "2027-01-02", lotNo: "Fixture lot B" },
      { ingredientId: weight.id, qty: 1.5, unitCost: 8 }
    ], { updateCost: true });
    assert(receipt); assert.equal(receipt.totalCost, 52); assert.equal(receipt.items.length, 3);
    let stock = await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: bottle.id } } });
    assert.equal(stock.stockQty, 8); assert.equal(stock.reorderLevel, 10);
    assert.equal((await db.ingredient.findUnique({ where: { id: bottle.id } })).costPerUnit, 14);
    assert.equal((await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: weight.id } } })).stockQty, 1.5);
    assert.equal((await db.ingredient.findUnique({ where: { id: weight.id } })).costPerUnit, 8);
    assert.equal(await db.stockMovement.count({ where: { branchId: branch.id, reason: `PO#${receipt.id}` } }), 3);
    assert.equal(await db.inventoryLot.count({ where: { purchaseId: receipt.id } }), 2);
    await voidPurchase(receipt.id, "Fixture cancellation");
    stock = await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: bottle.id } } });
    assert.equal(stock.stockQty, 3); assert.equal(await db.inventoryLot.count({ where: { purchaseId: receipt.id } }), 0);
    const free = await createPurchase(branch.id, "Fixture supplier", "Fixture free goods", [{ ingredientId: bottle.id, qty: 1, unitCost: 0 }], { updateCost: true });
    assert(free); assert.equal((await db.ingredient.findUnique({ where: { id: bottle.id } })).costPerUnit, 14);
    await voidPurchase(free.id, "Fixture cancellation");
    const purchaseCount = await db.purchase.count({ where: { branchId: branch.id } });
    const transaction = db.$transaction.bind(db);
    db.$transaction = (fn: any, options: any) => transaction((tx: any) => fn(new Proxy(tx, { get(target, key) { return key === "stockMovement" ? { createMany: async () => { throw new Error("Fixture movement batch failure"); } } : target[key]; } })), options);
    try { await assert.rejects(() => createPurchase(branch.id, "Fixture supplier", "Fixture rollback", [{ ingredientId: bottle.id, qty: 2, unitCost: 14 }]), /Fixture movement batch failure/); }
    finally { db.$transaction = transaction; }
    assert.equal(await db.purchase.count({ where: { branchId: branch.id } }), purchaseCount);
    assert.equal((await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: branch.id, ingredientId: bottle.id } } })).stockQty, 3);
    pass("batched receipt handles duplicate/free lines, missing stock rows, separate lots, weighted cost, void reversal and rollback after the stock write");
  } finally {
    const invoices = await db.taxInvoice.findMany({ where: { branchId: branch.id }, select: { id: true } });
    await db.integrationOutbox.deleteMany({ where: { entityType: "tax_invoice", entityId: { in: invoices.map((row: any) => row.id) } } });
    await db.taxInvoice.deleteMany({ where: { branchId: branch.id } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.inventoryLot.deleteMany({ where: { branchId: branch.id } });
    await db.stockMovement.deleteMany({ where: { branchId: branch.id } });
    const purchases = await db.purchase.findMany({ where: { branchId: branch.id }, select: { id: true } });
    await db.purchaseItem.deleteMany({ where: { purchaseId: { in: purchases.map((row: any) => row.id) } } });
    await db.purchase.deleteMany({ where: { branchId: branch.id } });
    await db.ingredientStock.deleteMany({ where: { branchId: branch.id } });
    await db.ingredient.deleteMany({ where: { id: { in: ingredientIds } } });
    await db.businessDocument.deleteMany({ where: { branchId: branch.id } });
    await db.storeSetting.deleteMany({ where: { branchId: branch.id } });
    await db.branch.delete({ where: { id: branch.id } });
  }
}

try { await cleanupChecks(); await refreshChecks(); await databaseChecks(); }
catch (error) { console.error(error); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
