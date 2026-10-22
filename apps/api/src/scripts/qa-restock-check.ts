import assert from "node:assert/strict";
import prisma from "../prisma.js";
import {
  adjustWarehouseStock, cancelRestockRequest, createRestockRequest, dispatchRestockShipment, getWarehouseInventory,
  receiveRestockShipment, reserveRestockRequest, startRestockPicking, submitRestockRequest
} from "../store/restock.js";

const target = new URL(process.env.DATABASE_URL ?? "invalid:");
if (process.env.QA_DISPOSABLE_DB !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !/^\/benzpos_qa(?:_|$)/.test(target.pathname)) {
  throw new Error("Set QA_DISPOSABLE_DB=true and an explicit local benzpos_qa DATABASE_URL; do not use production data");
}
const db = prisma as any;
const pass = (message: string) => console.log(`PASS ${message}`);

async function main() {
  const tag = `QA_RESTOCK_${Date.now()}`;
  const hub = await db.branch.create({ data: { name: `${tag}_hub`, branchType: "oil_service" } });
  const shop = await db.branch.create({ data: { name: `${tag}_shop`, branchType: "oil_service" } });
  const coffee = await db.branch.create({ data: { name: `${tag}_coffee`, branchType: "coffee" } });
  const oil = await db.ingredient.create({ data: { name: `${tag}_oil`, unit: "ลิตร", costPerUnit: 120 } });
  const filter = await db.ingredient.create({ data: { name: `${tag}_filter`, unit: "ชิ้น", costPerUnit: 80 } });
  const warehouse = await db.centralWarehouse.create({ data: { name: `${tag}_warehouse`, managerBranchId: hub.id } });
  const stockAt = async (branchId: number, ingredientId: number) => (await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId } } }))?.stockQty ?? 0;
  const inv = async (ingredientId: number) => (await getWarehouseInventory(warehouse.id)).find((row) => row.ingredientId === ingredientId)!;

  await adjustWarehouseStock({ warehouseId: warehouse.id, ingredientId: oil.id, qty: 10, reorderLevel: 4, reason: "รับเข้า" });
  await adjustWarehouseStock({ warehouseId: warehouse.id, ingredientId: filter.id, qty: 2, reason: "รับเข้า" });
  await assert.rejects(() => createRestockRequest({ warehouseId: warehouse.id, branchId: coffee.id, items: [{ ingredientId: oil.id, requestedQty: 1 }] }), /คนละธุรกิจ/);
  pass("a coffee branch cannot request from the oil warehouse");

  // two branches race for the same 10 litres: reservations never exceed stock
  const a = await createRestockRequest({ warehouseId: warehouse.id, branchId: shop.id, items: [{ ingredientId: oil.id, requestedQty: 8 }, { ingredientId: filter.id, requestedQty: 5 }] });
  const b = await createRestockRequest({ warehouseId: warehouse.id, branchId: hub.id, items: [{ ingredientId: oil.id, requestedQty: 8 }] });
  await Promise.all([submitRestockRequest(a.id), submitRestockRequest(b.id)]);
  const reserved = await db.restockRequestItem.aggregate({ where: { ingredientId: oil.id, request: { warehouseId: warehouse.id } }, _sum: { reservedQty: true } });
  assert.equal(reserved._sum.reservedQty, 10);
  assert.equal((await inv(oil.id)).availableQty, 0);
  pass("concurrent submits reserve at most the 10 on hand");

  await assert.rejects(() => adjustWarehouseStock({ warehouseId: warehouse.id, ingredientId: oil.id, qty: -1, reason: "เสีย" }), /จองไว้/);
  pass("stock reserved for a branch cannot be written off");

  // re-reserving after new stock arrives fills only the shortfall, and never twice
  const aItems = async () => (await db.restockRequestItem.findMany({ where: { requestId: a.id }, orderBy: { id: "asc" } })) as any[];
  const before = await aItems();
  await adjustWarehouseStock({ warehouseId: warehouse.id, ingredientId: filter.id, qty: 10, reason: "รับเข้า" });
  await reserveRestockRequest(a.id);
  await reserveRestockRequest(a.id);
  const after = await aItems();
  assert.equal(after.find((i) => i.ingredientId === filter.id).reservedQty, 5);
  assert.equal(after.find((i) => i.ingredientId === oil.id).reservedQty, before.find((i) => i.ingredientId === oil.id).reservedQty);
  pass("re-reserve tops up to the requested qty and is idempotent");

  // ship part, ship the rest while the first is on the road, receive with a shortfall
  await startRestockPicking(a.id);
  const oilLine = after.find((i) => i.ingredientId === oil.id);
  const filterLine = after.find((i) => i.ingredientId === filter.id);
  const first = await dispatchRestockShipment({ requestId: a.id, items: [{ requestItemId: filterLine.id, qty: 5 }] });
  const second = await dispatchRestockShipment({ requestId: a.id, items: [{ requestItemId: oilLine.id, qty: oilLine.reservedQty }] });
  await assert.rejects(() => cancelRestockRequest(a.id), /กดรับของก่อน/);
  pass("a second shipment can leave while the first is in transit; cancel waits for receipts");

  const firstItem = first!.items[0];
  await receiveRestockShipment({ shipmentId: first!.id, items: [{ shipmentItemId: firstItem.id, receivedQty: 4 }] });
  await receiveRestockShipment({ shipmentId: second!.id, items: [] });
  assert.equal(await stockAt(shop.id, filter.id), 4);
  assert.equal(await stockAt(shop.id, oil.id), oilLine.reservedQty);
  assert.equal((await db.restockShipment.findUnique({ where: { id: first!.id } })).status, "DISCREPANCY");
  // everything that was reserved went out; the request closes only if that covered what was asked
  const expected = oilLine.reservedQty >= oilLine.requestedQty ? "RECEIVED" : "PARTIAL";
  assert.equal((await db.restockRequest.findUnique({ where: { id: a.id } })).status, expected);
  const ledger = await db.stockMovement.findMany({ where: { branchId: shop.id } });
  assert.ok(ledger.every((m: any) => m.reason.startsWith("RESTOCK_RECEIVE#")) && ledger.length === 2);
  pass("branch stock and ledger take what was actually received; shortfall marks a discrepancy");

  // cancelling the other request hands its reservation back to the warehouse
  const heldByB = (await db.restockRequestItem.findFirst({ where: { requestId: b.id } })).reservedQty;
  const availableBefore = (await inv(oil.id)).availableQty;
  await cancelRestockRequest(b.id);
  assert.equal((await inv(oil.id)).availableQty, availableBefore + heldByB);
  await assert.rejects(() => cancelRestockRequest(b.id), /ปิดไปแล้ว/);
  pass("cancel releases reservations and cannot run twice");

  return { branchIds: [hub.id, shop.id, coffee.id], ingredientIds: [oil.id, filter.id], warehouseId: warehouse.id };
}

let created: Awaited<ReturnType<typeof main>> | undefined;
try {
  created = await main();
  console.log("Verified restock workflow on a disposable database.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (created) {
    await db.restockShipment.deleteMany({ where: { request: { warehouseId: created.warehouseId } } });
    await db.restockRequest.deleteMany({ where: { warehouseId: created.warehouseId } });
    await db.centralWarehouse.deleteMany({ where: { id: created.warehouseId } });
    await db.stockMovement.deleteMany({ where: { branchId: { in: created.branchIds } } });
    await db.ingredientStock.deleteMany({ where: { branchId: { in: created.branchIds } } });
    await db.ingredient.deleteMany({ where: { id: { in: created.ingredientIds } } });
    await db.branch.deleteMany({ where: { id: { in: created.branchIds } } });
  }
  await prisma.$disconnect();
}
