import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";
import { COUNTED_UNITS } from "./purchases.js";
import { consumeStockLots } from "./stockLots.js";

const KINDS = ["MOVE", "USE", "GIFT", "LOSS"] as const;
type DocumentKind = typeof KINDS[number];
type DocumentInput = {
  branchId: number; kind: DocumentKind; requestedByUserId: number; requestKey: string;
  fromLocation?: string; toLocation?: string; reason: string; note?: string;
  items: Array<{ ingredientId: number; qty: number }>; postImmediately?: boolean;
};
const round = (n: number) => Math.round(n * 10000) / 10000;
function text(value: unknown, max: number, label: string) {
  if (value !== undefined && typeof value !== "string") throw new Error(`${label}ไม่ถูกต้อง`);
  const result = String(value ?? "").trim();
  if (result.length > max) throw new Error(`${label}ยาวเกิน ${max} ตัวอักษร`);
  return result;
}
function normalize(input: DocumentInput) {
  if (input.postImmediately !== undefined && typeof input.postImmediately !== "boolean") throw new Error("รูปแบบการอนุมัติไม่ถูกต้อง");
  if (!Number.isInteger(input.branchId) || input.branchId <= 0 || !Number.isInteger(input.requestedByUserId) || input.requestedByUserId <= 0) throw new Error("กรุณาเลือกสาขาและผู้ขอเบิก");
  if (!KINDS.includes(input.kind)) throw new Error("ประเภทใบเบิกไม่ถูกต้อง");
  const requestKey = text(input.requestKey, 100, "รหัสรายการ");
  const reason = text(input.reason, 160, "เหตุผล");
  const note = text(input.note, 500, "หมายเหตุ");
  const fromLocation = text(input.fromLocation, 80, "จุดเก็บต้นทาง");
  const toLocation = text(input.toLocation, 80, "จุดใช้งาน");
  if (!requestKey || !reason) throw new Error("กรุณาระบุเหตุผลและรหัสรายการ");
  if (input.kind === "MOVE" && (!fromLocation || !toLocation || fromLocation === toLocation)) throw new Error("กรุณาระบุจุดเก็บต้นทางและปลายทางที่ต่างกัน");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw new Error("กรุณาเลือกสินค้า 1–100 รายการ");
  const quantities = new Map<number, number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.ingredientId) || item.ingredientId <= 0 || !Number.isFinite(item.qty) || item.qty <= 0 || round(item.qty) !== item.qty) throw new Error("จำนวนเบิกต้องมากกว่า 0 และมีทศนิยมไม่เกิน 4 ตำแหน่ง");
    quantities.set(item.ingredientId, round((quantities.get(item.ingredientId) ?? 0) + item.qty));
  }
  const items = [...quantities].sort(([a], [b]) => a - b).map(([ingredientId, qty]) => ({ ingredientId, qty }));
  return { branchId: input.branchId, kind: input.kind, requestedByUserId: input.requestedByUserId, requestKey, reason, note, fromLocation, toLocation, items };
}

function matches(document: any, input: ReturnType<typeof normalize>) {
  return document.branchId === input.branchId && document.requestedByUserId === input.requestedByUserId && document.kind === input.kind && document.reason === input.reason && document.note === input.note && document.fromLocation === input.fromLocation && document.toLocation === input.toLocation && JSON.stringify(document.items.map((i: any) => ({ ingredientId: i.ingredientId, qty: i.qty })).sort((a: any, b: any) => a.ingredientId - b.ingredientId)) === JSON.stringify(input.items);
}

async function hydrate(documents: any[]) {
  const ingredientIds = [...new Set(documents.flatMap(d => d.items.map((i: any) => i.ingredientId)))] as number[];
  const userIds = [...new Set(documents.flatMap(d => [d.requestedByUserId, d.approvedByUserId]).filter(Boolean))] as number[];
  const [ingredients, users] = await Promise.all([
    prisma.ingredient.findMany({ where: { id: { in: ingredientIds } }, select: { id: true, name: true, unit: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
  ]);
  const names = new Map(ingredients.map(i => [i.id, i]));
  const actors = new Map(users.map(u => [u.id, u.name]));
  return documents.map(d => ({ ...d, requestedByName: actors.get(d.requestedByUserId) ?? "ไม่ทราบผู้ขอเบิก", approvedByName: actors.get(d.approvedByUserId) ?? null,
    items: d.items.map((i: any) => ({ id: i.id, ingredientId: i.ingredientId, qty: i.qty, unitCost: i.unitCost, ingredientName: names.get(i.ingredientId)?.name ?? `สินค้า #${i.ingredientId}`, unit: names.get(i.ingredientId)?.unit ?? "" })) }));
}
export async function getInventoryDocument(id: number) {
  const document = await prisma.inventoryDocument.findUnique({ where: { id }, include: { items: true } });
  return document ? (await hydrate([document]))[0] : null;
}
export async function getInventoryDocuments(branchId: number) {
  return hydrate(await prisma.inventoryDocument.findMany({ where: { branchId }, include: { items: true }, orderBy: { id: "desc" }, take: 100 }));
}

async function lockStocks(tx: Prisma.TransactionClient, branchId: number, ingredientIds: number[]) {
  return tx.$queryRaw<Array<{ ingredient_id: number; stock_qty: number }>>(Prisma.sql`SELECT ingredient_id, stock_qty FROM ingredient_stocks WHERE branch_id = ${branchId} AND ingredient_id IN (${Prisma.join(ingredientIds)}) ORDER BY ingredient_id FOR UPDATE`);
}

async function post(tx: Prisma.TransactionClient, id: number, actorUserId: number) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM inventory_documents WHERE id = ${id} FOR UPDATE`);
  const document = await tx.inventoryDocument.findUnique({ where: { id }, include: { items: { orderBy: { ingredientId: "asc" } } } });
  if (!document) throw new Error("ไม่พบใบเบิกสินค้า");
  if (document.status === "POSTED") return document;
  if (document.status !== "PENDING") throw new Error("ใบเบิกนี้ถูกยกเลิกแล้ว");
  const balances = new Map((await lockStocks(tx, document.branchId, document.items.map(i => i.ingredientId))).map(i => [i.ingredient_id, i.stock_qty]));
  for (const item of document.items) {
    const beforeQty = balances.get(item.ingredientId) ?? 0;
    if (beforeQty + 1e-8 < item.qty) {
      const ingredient = await tx.ingredient.findUnique({ where: { id: item.ingredientId }, select: { name: true } });
      throw new Error(`สต็อกไม่พอ: ${ingredient?.name ?? `#${item.ingredientId}`} คงเหลือ ${beforeQty}, ต้องใช้ ${item.qty}`);
    }
    let afterQty = beforeQty;
    if (document.kind !== "MOVE") {
      afterQty = Math.max(0, round(beforeQty - item.qty));
      const changed = await tx.ingredientStock.updateMany({ where: { branchId: document.branchId, ingredientId: item.ingredientId, stockQty: { gte: item.qty - 1e-8 } }, data: { stockQty: afterQty } });
      if (changed.count !== 1) throw new Error("สต็อกมีการเปลี่ยนแปลง กรุณาลองใหม่");
      const allocations = await consumeStockLots(tx, document.branchId, item.ingredientId, item.qty);
      await tx.inventoryDocumentItem.update({ where: { id: item.id }, data: { lotAllocations: JSON.stringify(allocations) } });
    }
    await tx.stockMovement.create({ data: { branchId: document.branchId, ingredientId: item.ingredientId, qty: document.kind === "MOVE" ? 0 : -item.qty, beforeQty, afterQty, actorUserId, documentId: id, reason: `DOC_${document.kind}#${id} · ${document.reason}` } });
  }
  return tx.inventoryDocument.update({ where: { id }, data: { status: "POSTED", postedAt: new Date(), approvedByUserId: actorUserId } });
}

export async function createInventoryDocument(raw: DocumentInput) {
  const input = normalize(raw);
  const id = await prisma.$transaction(async tx => {
    // Stable client key serializes retries before either the document or stock is written.
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`inventory-document:${input.requestKey}`}))::text`);
    const existing = await tx.inventoryDocument.findUnique({ where: { requestKey: input.requestKey }, include: { items: true } });
    if (existing) {
      if (!matches(existing, input)) throw new Error("รหัสรายการนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาเริ่มรายการใหม่");
      return existing.id;
    }
    const branch = await tx.branch.findUnique({ where: { id: input.branchId }, select: { active: true } });
    if (!branch?.active) throw new Error("ไม่พบสาขาที่ใช้งาน");
    const ingredients = await tx.ingredient.findMany({ where: { id: { in: input.items.map(i => i.ingredientId) } }, select: { id: true, name: true, unit: true, costPerUnit: true } });
    const byId = new Map(ingredients.map(i => [i.id, i]));
    for (const item of input.items) {
      const ingredient = byId.get(item.ingredientId);
      if (!ingredient) throw new Error(`ไม่พบสินค้า #${item.ingredientId}`);
      if (COUNTED_UNITS.has(ingredient.unit.trim()) && !Number.isInteger(item.qty)) throw new Error(`${ingredient.name} ต้องเบิกเป็นจำนวนเต็ม${ingredient.unit}`);
    }
    const document = await tx.inventoryDocument.create({ data: { ...input, items: { create: input.items.map(i => ({ ...i, unitCost: byId.get(i.ingredientId)!.costPerUnit })) } } });
    if (raw.postImmediately) await post(tx, document.id, input.requestedByUserId);
    return document.id;
  }, { timeout: 15000 });
  return getInventoryDocument(id);
}

export async function postInventoryDocument(id: number, actorUserId: number) {
  await prisma.$transaction(tx => post(tx, id, actorUserId), { timeout: 15000 });
  return getInventoryDocument(id);
}

export async function voidInventoryDocument(id: number, reason: string, actorUserId: number) {
  const why = text(reason, 300, "เหตุผลยกเลิก");
  if (!why) throw new Error("กรุณาระบุเหตุผลที่ยกเลิก");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM inventory_documents WHERE id = ${id} FOR UPDATE`);
    const document = await tx.inventoryDocument.findUnique({ where: { id }, include: { items: { orderBy: { ingredientId: "asc" } } } });
    if (!document) throw new Error("ไม่พบใบเบิกสินค้า");
    if (document.status === "VOID") return;
    if (document.status === "POSTED") {
      await lockStocks(tx, document.branchId, document.items.map(i => i.ingredientId));
      for (const item of document.items) {
        const current = await tx.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: document.branchId, ingredientId: item.ingredientId } } });
        const beforeQty = current?.stockQty ?? 0;
        const qty = document.kind === "MOVE" ? 0 : item.qty;
        if (qty > 0) {
          await tx.ingredientStock.upsert({ where: { branchId_ingredientId: { branchId: document.branchId, ingredientId: item.ingredientId } }, update: { stockQty: round(beforeQty + qty) }, create: { branchId: document.branchId, ingredientId: item.ingredientId, stockQty: qty } });
          const allocations = JSON.parse(item.lotAllocations) as Array<{ lotId: number; qty: number }>;
          for (const allocation of allocations) {
            const restored = await tx.$executeRaw(Prisma.sql`UPDATE inventory_lots SET qty = ROUND((qty + ${allocation.qty})::numeric, 4)::double precision WHERE id = ${allocation.lotId} AND branch_id = ${document.branchId} AND ingredient_id = ${item.ingredientId}`);
            if (restored !== 1) throw new Error("ล็อตสินค้าของใบเบิกนี้เปลี่ยนไปแล้ว กรุณาตรวจสอบก่อนยกเลิก");
          }
        }
        await tx.stockMovement.create({ data: { branchId: document.branchId, ingredientId: item.ingredientId, qty, beforeQty, afterQty: round(beforeQty + qty), actorUserId, documentId: id, reason: `DOC_VOID_${document.kind}#${id} · ${why}` } });
      }
    }
    await tx.inventoryDocument.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidReason: why } });
  }, { timeout: 15000 });
  return getInventoryDocument(id);
}

const LEDGER_KINDS = [...KINDS, "RECEIVE", "SALE", "RETURN", "COUNT", "TRANSFER", "ADJUSTMENT"];
function kindFor(reason: string) {
  if (reason.startsWith("DOC_VOID_MOVE#")) return "MOVE";
  if (/^(DOC_VOID_|PO_VOID#|CANCELLED-|REFUNDED-)/.test(reason)) return "RETURN";
  const document = /^DOC_(MOVE|USE|GIFT|LOSS)#/.exec(reason);
  if (document) return document[1];
  if (reason.startsWith("OUT: ใช้ในร้าน")) return "USE";
  if (reason.startsWith("OUT: แจก/ชิม")) return "GIFT";
  if (reason.startsWith("OUT: ของเสีย/หมดอายุ")) return "LOSS";
  if (/^(PO#|RECEIVE|RESTOCK)/.test(reason)) return "RECEIVE";
  if (reason.startsWith("SALE-")) return "SALE";
  if (/^(COUNT|STOCK_COUNT|STOCKTAKE)/.test(reason)) return "COUNT";
  if (reason.startsWith("TRANSFER")) return "TRANSFER";
  return "ADJUSTMENT";
}
function dateBoundary(raw: string | undefined) {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("รูปแบบวันที่ไม่ถูกต้อง");
  const value = new Date(`${raw}T00:00:00+07:00`);
  if (Number.isNaN(value.getTime()) || new Date(value.getTime() + 7 * 3600000).toISOString().slice(0, 10) !== raw) throw new Error("วันที่ไม่ถูกต้อง");
  return value;
}
export async function getStockLedger(branchId: number, options: { ingredientId?: number; kind?: string; from?: string; to?: string; page?: number; limit?: number; snapshotId?: number } = {}) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 25)));
  if (!Number.isFinite(page) || !Number.isFinite(limit) || page > 100000) throw new Error("หน้าประวัติไม่ถูกต้อง");
  if (options.snapshotId !== undefined && (!Number.isSafeInteger(options.snapshotId) || options.snapshotId < 0 || options.snapshotId > 2147483647)) throw new Error("ชุดประวัติไม่ถูกต้อง");
  const from = dateBoundary(options.from);
  const to = dateBoundary(options.to);
  const until = to ? new Date(to.getTime() + 86400000) : undefined;
  if (from && until && from >= until) throw new Error("วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด");
  if (options.kind && !LEDGER_KINDS.includes(options.kind)) throw new Error("ประเภทประวัติไม่ถูกต้อง");
  // Classify on the server with the same rules used for response labels.
  const predicates: Record<string, Prisma.StockMovementWhereInput> = {
    MOVE: { OR: [{ reason: { startsWith: "DOC_MOVE#" } }, { reason: { startsWith: "DOC_VOID_MOVE#" } }] },
    USE: { OR: ["DOC_USE#", "OUT: ใช้ในร้าน"].map(prefix => ({ reason: { startsWith: prefix } })) },
    GIFT: { OR: ["DOC_GIFT#", "OUT: แจก/ชิม"].map(prefix => ({ reason: { startsWith: prefix } })) },
    LOSS: { OR: ["DOC_LOSS#", "OUT: ของเสีย/หมดอายุ"].map(prefix => ({ reason: { startsWith: prefix } })) },
    RECEIVE: { OR: ["PO#", "RECEIVE", "RESTOCK"].map(prefix => ({ reason: { startsWith: prefix } })) },
    SALE: { reason: { startsWith: "SALE-" } },
    RETURN: { OR: ["DOC_VOID_USE#", "DOC_VOID_GIFT#", "DOC_VOID_LOSS#", "PO_VOID#", "CANCELLED-", "REFUNDED-"].map(prefix => ({ reason: { startsWith: prefix } })) },
    COUNT: { OR: ["COUNT", "STOCK_COUNT", "STOCKTAKE"].map(prefix => ({ reason: { startsWith: prefix } })) },
    TRANSFER: { reason: { startsWith: "TRANSFER" } }
  };
  const knownPredicates = Object.values(predicates);
  const where: Prisma.StockMovementWhereInput = { branchId, ...(options.ingredientId ? { ingredientId: options.ingredientId } : {}), ...(from || until ? { createdAt: { gte: from, lt: until } } : {}), ...(options.kind === "ADJUSTMENT" ? { NOT: { OR: knownPredicates } } : options.kind ? predicates[options.kind] : {}) };
  // Keep new ledger entries from shifting subsequent export pages.
  const { total, movements, snapshotId } = await prisma.$transaction(async (tx) => {
    const snapshotId = options.snapshotId ?? (await tx.stockMovement.findFirst({ where, select: { id: true }, orderBy: { id: "desc" } }))?.id ?? 0;
    const boundedWhere = { ...where, id: { lte: snapshotId } };
    const total = await tx.stockMovement.count({ where: boundedWhere });
    const movements = await tx.stockMovement.findMany({ where: boundedWhere, include: { ingredient: { select: { name: true, unit: true } } }, orderBy: { id: "desc" }, skip: (page - 1) * limit, take: limit });
    return { total, movements, snapshotId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const orderIds = movements.map(m => /^SALE-(\d+)$/.exec(m.reason)).filter(Boolean).map(m => Number(m![1]));
  const orders = orderIds.length ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, userId: true } }) : [];
  const orderActors = new Map(orders.map(o => [o.id, o.userId]));
  const actorIds = [...new Set([...movements.map(m => m.actorUserId), ...orders.map(o => o.userId)].filter(Boolean))] as number[];
  const users = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const actors = new Map(users.map(u => [u.id, u.name]));
  const documentIds = movements.map(m => m.documentId).filter(Boolean) as number[];
  const documents = documentIds.length ? await prisma.inventoryDocument.findMany({ where: { id: { in: documentIds }, branchId }, select: { id: true, kind: true, fromLocation: true, toLocation: true, note: true } }) : [];
  const byDocument = new Map(documents.map(d => [d.id, d]));
  return { total, page, limit, snapshotId, items: movements.map(m => {
    const orderId = Number(/^SALE-(\d+)$/.exec(m.reason)?.[1] ?? 0);
    const actorUserId = m.actorUserId ?? orderActors.get(orderId) ?? null;
    const reference = m.documentId ? `ใบเบิก/ย้าย #${m.documentId}` : /^PO(?:_VOID)?#(\d+)/.test(m.reason) ? `ใบรับ #${/^PO(?:_VOID)?#(\d+)/.exec(m.reason)![1]}` : /^(?:SALE-|CANCELLED-|REFUNDED-)(\d+)/.test(m.reason) ? `บิลขาย #${/^(?:SALE-|CANCELLED-|REFUNDED-)(\d+)/.exec(m.reason)![1]}` : m.reason;
    const { ingredient, ...movement } = m;
    return { ...movement, ingredientName: ingredient.name, unit: ingredient.unit, kind: kindFor(m.reason), reference, actorUserId, actorName: actors.get(actorUserId ?? 0) ?? null, document: byDocument.get(m.documentId ?? 0) ?? null };
  }) };
}
