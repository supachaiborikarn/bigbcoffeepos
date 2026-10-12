import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

export interface PurchaseItemInput {
  ingredientId: number;
  /** Stock units after packs have been converted, e.g. 2 cases × 12 = 24. */
  qty: number;
  unitCost: number;
  description?: string;
  lotNo?: string;
  expiryDate?: string | null;
  packSize?: number;
}
export interface PurchaseOptions {
  mode?: "RECEIPT" | "ORDER";
  updateCost?: boolean;
  invoiceNumber?: string;
  documentDate?: string | null;
  receivedAt?: string | null;
  dueDate?: string | null;
  attachmentName?: string;
  attachmentDataUrl?: string;
  requestKey?: string;
  createdByUserId?: number | null;
}
export interface ReceivePurchaseItemInput {
  purchaseItemId: number;
  qty: number;
  lotNo?: string;
  expiryDate?: string | null;
  packSize?: number;
}
export interface ReceivePurchaseOptions {
  requestKey?: string;
  receivedAt?: string | null;
  note?: string;
  actorUserId?: number | null;
  updateCost?: boolean;
}

/** Fractions are valid for measures; counted items must remain whole. */
export const COUNTED_UNITS = new Set(["ชิ้น", "ขวด", "กระป๋อง", "แพ็ค", "ใบ", "ซอง", "กล่อง", "ลัง", "ถุง", "แก้ว", "อัน", "ห่อ", "หลอด", "ฝา", "ถ้วย", "ลูก", "ตัว", "แผ่น", "ม้วน", "คู่"]);
const db = prisma as any;
const round = (value: number, dp = 4) => Math.round(value * 10 ** dp) / 10 ** dp;
const money = (value: number) => round(value, 2);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
function boundedText(value: unknown, label: string, max: number) {
  if (value != null && typeof value !== "string") throw new Error(`${label}ไม่ถูกต้อง`);
  const text = String(value ?? "").trim();
  if (text.length > max) throw new Error(`${label}ยาวเกิน ${max} ตัวอักษร`);
  return text;
}
function dateValue(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) throw new Error(`${label}ไม่ถูกต้อง`);
  const date = new Date(value);
  const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error(`${label}ไม่ถูกต้อง`);
  return date;
}
function actorId(value: number | null | undefined) {
  if (value != null && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("ข้อมูลผู้ทำรายการไม่ถูกต้อง");
  return value ?? null;
}
function checkQty(qty: number, unit: string, name: string) {
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1e9) throw new Error(`จำนวน ${name} ต้องมากกว่า 0 และไม่เกิน 1,000,000,000`);
  if (COUNTED_UNITS.has(unit.trim()) && Math.abs(qty - Math.round(qty)) > 1e-9) throw new Error(`${name} นับเป็น${unit} ต้องรับเป็นจำนวนเต็ม (ใส่ ${qty})`);
}
function checkPack(value: number | undefined) {
  const size = value ?? 1;
  if (!Number.isFinite(size) || size <= 0 || size > 1e9) throw new Error("จำนวนต่อแพ็คต้องมากกว่า 0");
  return size;
}
/** Store a bounded original image with the document; no external storage required. */
export function validatePurchaseAttachment(dataUrl: unknown, name: unknown = "") {
  const attachmentName = boundedText(name, "ชื่อไฟล์บิล", 160);
  if (dataUrl == null || dataUrl === "") return { attachmentName: "", attachmentDataUrl: "" };
  if (typeof dataUrl !== "string" || dataUrl.length > 2_800_000) throw new Error("รูปบิลต้องเป็น JPEG, PNG หรือ WebP ขนาดไม่เกิน 2 MB");
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new Error("รูปบิลต้องเป็น JPEG, PNG หรือ WebP");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 2 * 1024 * 1024 || buffer.toString("base64") !== match[2]) throw new Error("รูปบิลต้องมีขนาดไม่เกิน 2 MB และข้อมูลไฟล์ต้องถูกต้อง");
  const valid = match[1] === "jpeg" ? buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : match[1] === "png" ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new Error("ชนิดไฟล์รูปบิลไม่ตรงกับข้อมูลไฟล์");
  return { attachmentName: attachmentName || `รูปบิล.${match[1] === "jpeg" ? "jpg" : match[1]}`, attachmentDataUrl: dataUrl };
}
const includePurchase = { items: { orderBy: { id: "asc" } }, branch: true, receipts: { include: { items: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } } };
async function lockPurchase(tx: any, id: number) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM purchases WHERE id = ${id} FOR UPDATE`);
  const po = await tx.purchase.findUnique({ where: { id }, include: { items: { orderBy: { id: "asc" } } } });
  if (!po) throw new Error("ไม่พบใบรับสินค้าหรือใบสั่งซื้อ");
  return po;
}
async function lockRequest(tx: any, namespace: string, requestKey: string) {
  if (requestKey) await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${namespace}:${requestKey}`}))::text`);
}
async function lockIngredients(tx: any, ids: number[]) {
  // Serialize cost writes without blocking movement foreign-key KEY SHARE locks.
  if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM ingredients WHERE id IN (${Prisma.join([...new Set(ids)].sort((a, b) => a - b))}) ORDER BY id FOR NO KEY UPDATE`);
}
type StockLine = { id: number; ingredientId: number; ingredientName: string; unit: string; qty: number; unitCost: number; lotNo: string; expiryDate: Date | null; packSize: number };
async function postReceipt(tx: any, po: any, lines: StockLine[], options: { receivedAt: Date; actorUserId: number | null; updateCost: boolean; note: string; requestKey?: string; requestHash?: string }) {
  await lockIngredients(tx, lines.map((line) => line.ingredientId));
  const receipt = await tx.purchaseReceipt.create({ data: {
    purchaseId: po.id, receivedAt: options.receivedAt, actorUserId: options.actorUserId, note: options.note,
    requestKey: options.requestKey || null, requestHash: options.requestHash ?? "",
    items: { createMany: { data: lines.map((line) => ({ purchaseItemId: line.id, ingredientId: line.ingredientId, ingredientName: line.ingredientName, unit: line.unit, qty: line.qty, unitCost: line.unitCost, lotNo: line.lotNo, expiryDate: line.expiryDate, packSize: line.packSize })) } }
  } });
  const ingredientIds = [...new Set(lines.map((line) => line.ingredientId))];
  // An overlapping sale/issue must finish before its stock is weighted into the
  // new cost; unit costs are shared, so this covers the stock of every branch.
  if (options.updateCost) await tx.$queryRaw(Prisma.sql`SELECT branch_id, ingredient_id FROM ingredient_stocks WHERE ingredient_id IN (${Prisma.join(ingredientIds)}) ORDER BY branch_id, ingredient_id FOR UPDATE`);
  const onHandRows = options.updateCost ? await tx.ingredientStock.groupBy({ by: ["ingredientId"], where: { ingredientId: { in: ingredientIds }, stockQty: { gt: 0 } }, _sum: { stockQty: true } }) : [];
  const onHand = new Map<number, number>(onHandRows.map((r: any) => [r.ingredientId, Number(r._sum.stockQty) || 0]));
  const increments = new Map<number, number>();
  for (const line of lines) increments.set(line.ingredientId, (increments.get(line.ingredientId) ?? 0) + line.qty);
  const values = [...increments].sort(([a], [b]) => a - b).map(([ingredientId, qty]) => Prisma.sql`(${po.branchId}, ${ingredientId}, ${qty}, 0)`);
  const changed: { ingredient_id: number; stock_qty: number }[] = await tx.$queryRaw(Prisma.sql`
    INSERT INTO ingredient_stocks (branch_id, ingredient_id, stock_qty, reorder_level)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (branch_id, ingredient_id) DO UPDATE SET stock_qty = ingredient_stocks.stock_qty + EXCLUDED.stock_qty
    RETURNING ingredient_id, stock_qty
  `);
  const running = new Map<number, number>(changed.map((row) => [row.ingredient_id, row.stock_qty - increments.get(row.ingredient_id)!]));
  const movements = lines.map((line) => {
    const beforeQty = running.get(line.ingredientId)!;
    const afterQty = beforeQty + line.qty;
    running.set(line.ingredientId, afterQty);
    return { branchId: po.branchId, ingredientId: line.ingredientId, qty: line.qty, beforeQty, afterQty, actorUserId: options.actorUserId, reason: `PO#${po.id}` };
  });
  await tx.stockMovement.createMany({ data: movements });
  const lots = lines.filter((line) => line.expiryDate || line.lotNo).map((line) => ({ branchId: po.branchId, ingredientId: line.ingredientId, purchaseId: po.id, lotNo: line.lotNo, qty: line.qty, expiryDate: line.expiryDate }));
  if (lots.length) await tx.inventoryLot.createMany({ data: lots });
  const costChanges: { ingredientId: number; from: number; to: number }[] = [];
  if (options.updateCost) {
    const received = new Map<number, { qty: number; value: number }>();
    for (const line of lines) {
      if (!(line.unitCost > 0)) continue;
      const current = received.get(line.ingredientId) ?? { qty: 0, value: 0 };
      received.set(line.ingredientId, { qty: current.qty + line.qty, value: current.value + line.qty * line.unitCost });
    }
    const current = await tx.ingredient.findMany({ where: { id: { in: [...received.keys()] } }, select: { id: true, costPerUnit: true } });
    for (const ing of current) {
      const receivedItem = received.get(ing.id)!;
      const stock = ing.costPerUnit > 0 ? onHand.get(ing.id) ?? 0 : 0;
      const to = round((stock * ing.costPerUnit + receivedItem.value) / (stock + receivedItem.qty));
      if (Math.abs(to - ing.costPerUnit) >= 1e-6) costChanges.push({ ingredientId: ing.id, from: ing.costPerUnit, to });
    }
    if (costChanges.length) {
      const costs = costChanges.map((change) => Prisma.sql`(${change.ingredientId}::integer, ${change.to}::double precision)`);
      await tx.$executeRaw(Prisma.sql`UPDATE ingredients AS ingredient SET cost_per_unit = changed.cost FROM (VALUES ${Prisma.join(costs)}) AS changed(id, cost) WHERE ingredient.id = changed.id`);
    }
  }
  return { receiptId: receipt.id, costChanges };
}

/** Legacy callers receive immediately; ORDER prepares a supplier PO without changing stock. */
export async function createPurchase(branchId: number, supplier: string, note: string, items: PurchaseItemInput[], options: PurchaseOptions = {}) {
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw new Error("กรุณาเลือกสาขา");
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) throw new Error("กรุณาเพิ่มรายการสินค้า 1–200 รายการ");
  const supplierName = boundedText(supplier, "ชื่อผู้ขาย", 120);
  const invoiceNumber = boundedText(options.invoiceNumber, "เลขบิลผู้ขาย", 100);
  if (invoiceNumber && (!supplierName || supplierName === "ไม่ระบุผู้ขาย")) throw new Error("กรุณาระบุผู้ขายสำหรับบิลที่มีเลขบิล");
  const noteText = boundedText(note, "หมายเหตุ", 1000);
  const requestKey = boundedText(options.requestKey, "รหัสคำขอ", 120);
  const mode = options.mode ?? "RECEIPT";
  if (!["ORDER", "RECEIPT"].includes(mode)) throw new Error("ประเภทใบรับสินค้าหรือใบสั่งซื้อไม่ถูกต้อง");
  const documentDate = dateValue(options.documentDate, "วันที่บิล");
  const receivedAt = dateValue(options.receivedAt, "วันที่รับสินค้า");
  const dueDate = dateValue(options.dueDate, "วันครบกำหนดชำระ");
  const creator = actorId(options.createdByUserId);
  const attachment = validatePurchaseAttachment(options.attachmentDataUrl, options.attachmentName);
  const ingredients = await prisma.ingredient.findMany({ where: { id: { in: [...new Set(items.map((item) => item.ingredientId))] } }, select: { id: true, name: true, unit: true } });
  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const normalized = items.map((item) => {
    const ingredient = ingredientById.get(item.ingredientId);
    if (!ingredient) throw new Error(`ไม่พบสินค้า #${item.ingredientId}`);
    checkQty(item.qty, ingredient.unit, ingredient.name);
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0 || item.unitCost > 1e9) throw new Error(`ราคาของ ${ingredient.name} ไม่ถูกต้อง`);
    return { ingredientId: item.ingredientId, ingredientName: ingredient.name, unit: ingredient.unit, description: boundedText(item.description, "รายละเอียดสินค้า", 120), qty: item.qty, receivedQty: mode === "RECEIPT" ? item.qty : 0, unitCost: item.unitCost, lineTotal: money(item.qty * item.unitCost), lotNo: boundedText(item.lotNo, "เลขล็อต", 40), expiryDate: dateValue(item.expiryDate, `วันหมดอายุของ ${ingredient.name}`), packSize: checkPack(item.packSize) };
  });
  const totalCost = money(normalized.reduce((sum, item) => sum + item.qty * item.unitCost, 0));
  const requestHash = hash({ branchId, supplier: supplierName, note: noteText, items: normalized.map(({ ingredientName, unit, ...item }) => item), mode, invoiceNumber, documentDate, receivedAt, dueDate, attachment, creator, updateCost: !!options.updateCost });
  let outcome: { id: number; costChanges: { ingredientId: number; from: number; to: number }[] };
  try {
    outcome = await db.$transaction(async (tx: any) => {
      await lockRequest(tx, "purchase", requestKey);
      if (requestKey) {
        const existing = await tx.purchase.findUnique({ where: { requestKey } });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new Error("รหัสคำขอนี้เคยใช้กับข้อมูลบิลอื่นแล้ว กรุณาตรวจสอบรายการ");
          return { id: existing.id, costChanges: [] };
        }
      }
      const branch = await tx.branch.findUnique({ where: { id: branchId } });
      if (!branch || !branch.active) throw new Error("ไม่พบสาขาที่เปิดใช้งาน");
      const po = await tx.purchase.create({ data: { branchId, supplier: supplierName, supplierKey: normalKey(supplierName), invoiceNumber, invoiceKey: normalKey(invoiceNumber), note: noteText, kind: mode, total: totalCost, status: mode === "ORDER" ? "PENDING" : "RECEIVED", documentDate, receivedAt: mode === "RECEIPT" ? receivedAt ?? new Date() : null, dueDate, ...attachment, requestKey: requestKey || null, requestHash, createdByUserId: creator, items: { createMany: { data: normalized } } }, include: { items: { orderBy: { id: "asc" } } } });
      let costChanges: { ingredientId: number; from: number; to: number }[] = [];
      if (mode === "RECEIPT") ({ costChanges } = await postReceipt(tx, po, po.items, { receivedAt: po.receivedAt, actorUserId: creator, updateCost: !!options.updateCost, note: noteText }));
      return { id: po.id, costChanges };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new Error("เลขบิลนี้ถูกบันทึกกับผู้ขายรายนี้ในสาขานี้แล้ว");
    throw error;
  }
  const result = await getPurchase(outcome.id);
  return result ? { ...result, costChanges: outcome.costChanges } : null;
}

/** Approving authorizes a supplier PO; legacy receipts keep their received state. */
export async function approvePurchase(id: number, userId?: number | null) {
  const approver = actorId(userId);
  await db.$transaction(async (tx: any) => {
    const po = await lockPurchase(tx, id);
    if (po.status === "VOID") throw new Error("ใบนี้ถูกยกเลิกแล้ว");
    if (po.kind === "ORDER" && !["PENDING", "APPROVED", "PARTIAL", "RECEIVED"].includes(po.status)) throw new Error("สถานะใบสั่งซื้อไม่อนุญาตให้อนุมัติ");
    if (po.approvedAt) return;
    await tx.purchase.update({ where: { id }, data: { status: po.kind === "ORDER" && po.status === "PENDING" ? "APPROVED" : po.status, approvedByUserId: approver, approvedAt: new Date() } });
  });
  return getPurchase(id);
}

/** Every receive event has its own retry key and a snapshot of the actual delivery. */
export async function receivePurchase(id: number, items: ReceivePurchaseItemInput[], options: ReceivePurchaseOptions = {}) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new Error("กรุณาเพิ่มจำนวนสินค้าที่รับจริง");
  const requestKey = boundedText(options.requestKey, "รหัสคำขอ", 120);
  const receivedAt = dateValue(options.receivedAt, "วันที่รับสินค้า");
  const note = boundedText(options.note, "หมายเหตุ", 1000);
  const actorUserId = actorId(options.actorUserId);
  const seen = new Set<number>();
  const normalized = items.map((item) => {
    if (!Number.isSafeInteger(item.purchaseItemId) || item.purchaseItemId <= 0 || seen.has(item.purchaseItemId)) throw new Error("รายการสินค้าในใบรับซ้ำหรือไม่ถูกต้อง");
    seen.add(item.purchaseItemId);
    if (!Number.isFinite(item.qty) || item.qty <= 0) throw new Error("จำนวนรับสินค้าต้องมากกว่า 0");
    return { purchaseItemId: item.purchaseItemId, qty: item.qty, ...(item.lotNo !== undefined ? { lotNo: boundedText(item.lotNo, "เลขล็อต", 40) } : {}), ...(item.expiryDate !== undefined ? { expiryDate: dateValue(item.expiryDate, "วันหมดอายุ") } : {}), ...(item.packSize !== undefined ? { packSize: checkPack(item.packSize) } : {}) };
  });
  const requestHash = hash({ id, items: normalized, receivedAt, note, actorUserId, updateCost: !!options.updateCost });
  const outcome = await db.$transaction(async (tx: any) => {
    await lockRequest(tx, "purchase-receipt", requestKey);
    const po = await lockPurchase(tx, id);
    if (requestKey) {
      const existing = await tx.purchaseReceipt.findUnique({ where: { requestKey } });
      if (existing) {
        if (existing.purchaseId !== id || existing.requestHash !== requestHash) throw new Error("รหัสคำขอนี้เคยใช้กับการรับสินค้าอื่นแล้ว");
        return { receiptId: existing.id, costChanges: [] };
      }
    }
    if (po.kind !== "ORDER" || !["APPROVED", "PARTIAL"].includes(po.status)) throw new Error("ต้องอนุมัติใบสั่งซื้อก่อนรับสินค้า และใบนี้ต้องยังรับไม่ครบ");
    const itemMap = new Map<number, any>(po.items.map((item: any) => [item.id, item]));
    const lines: StockLine[] = normalized.map((input) => {
      const item = itemMap.get(input.purchaseItemId);
      if (!item || !item.ingredientId) throw new Error("รายการนี้ไม่อยู่ในใบสั่งซื้อ");
      checkQty(input.qty, item.unit, item.ingredientName);
      if (input.qty - (item.qty - item.receivedQty) > 1e-9) throw new Error(`รับ ${item.ingredientName} เกินจำนวนที่ยังค้างรับ`);
      return { id: item.id, ingredientId: item.ingredientId, ingredientName: item.ingredientName, unit: item.unit, qty: input.qty, unitCost: item.unitCost, lotNo: input.lotNo ?? item.lotNo, expiryDate: input.expiryDate === undefined ? item.expiryDate : input.expiryDate, packSize: input.packSize ?? item.packSize };
    });
    const posted = await postReceipt(tx, po, lines, { receivedAt: receivedAt ?? new Date(), actorUserId, updateCost: !!options.updateCost, note, requestKey, requestHash });
    for (const line of lines) await tx.purchaseItem.update({ where: { id: line.id }, data: { receivedQty: { increment: line.qty } } });
    const full = po.items.every((item: any) => item.receivedQty + (lines.find((line) => line.id === item.id)?.qty ?? 0) >= item.qty - 1e-9);
    await tx.purchase.update({ where: { id }, data: { status: full ? "RECEIVED" : "PARTIAL", receivedAt: receivedAt ?? new Date() } });
    return posted;
  });
  const result = await getPurchase(id);
  return result ? { ...result, ...outcome } : null;
}

/** Cancel only the stock actually received, once, with all changes in one transaction. */
export async function voidPurchase(id: number, reason: string, userId?: number | null) {
  const why = boundedText(reason, "เหตุผลที่ยกเลิก", 300);
  if (!why) throw new Error("กรุณาระบุเหตุผลที่ยกเลิก");
  const actorUserId = actorId(userId);
  await db.$transaction(async (tx: any) => {
    const po = await lockPurchase(tx, id);
    if (po.status === "VOID") return;
    const byIngredient = new Map<number, number>();
    for (const item of po.items) if (item.ingredientId && item.receivedQty > 0) byIngredient.set(item.ingredientId, (byIngredient.get(item.ingredientId) ?? 0) + item.receivedQty);
    // Stock writers take these row locks before consuming lots; wait for them
    // before inspecting remaining lots so an overlapping sale/issue is visible.
    if (byIngredient.size) await tx.$queryRaw(Prisma.sql`SELECT ingredient_id FROM ingredient_stocks WHERE branch_id = ${po.branchId} AND ingredient_id IN (${Prisma.join([...byIngredient.keys()].sort((a, b) => a - b))}) ORDER BY ingredient_id FOR UPDATE`);
    // For new deliveries, lots must still contain every tracked receipt unit.
    // A replenishment of total stock cannot erase an already consumed lot.
    const original = await tx.purchaseReceiptItem.findMany({ where: { receipt: { purchaseId: id }, OR: [{ expiryDate: { not: null } }, { lotNo: { not: "" } }] } });
    const lots = await tx.inventoryLot.findMany({ where: { purchaseId: id } });
    const lotKey = (row: any) => `${row.ingredientId}|${row.lotNo}|${row.expiryDate?.toISOString() ?? ""}`;
    const expected = new Map<string, number>();
    for (const line of original) expected.set(lotKey(line), (expected.get(lotKey(line)) ?? 0) + line.qty);
    for (const [key, qty] of expected) if (lots.filter((lot: any) => lotKey(lot) === key).reduce((sum: number, lot: any) => sum + lot.qty, 0) < qty - 1e-9) throw new Error("ยกเลิกไม่ได้: สินค้าในล็อตของใบนี้ถูกใช้ไปแล้วบางส่วน ให้นับสต็อกแทน");
    for (const [ingredientId, qty] of [...byIngredient].sort(([a], [b]) => a - b)) {
      const taken = await tx.ingredientStock.updateMany({ where: { branchId: po.branchId, ingredientId, stockQty: { gte: qty } }, data: { stockQty: { decrement: qty } } });
      if (taken.count !== 1) {
        const ing = await tx.ingredient.findUnique({ where: { id: ingredientId }, select: { name: true } });
        throw new Error(`ยกเลิกไม่ได้: ${ing?.name ?? `#${ingredientId}`} ถูกใช้ไปแล้วบางส่วน (คงเหลือน้อยกว่าที่รับ) ให้นับสต็อกแทน`);
      }
      const stock = await tx.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: po.branchId, ingredientId } } });
      await tx.stockMovement.create({ data: { branchId: po.branchId, ingredientId, qty: -qty, beforeQty: stock.stockQty + qty, afterQty: stock.stockQty, actorUserId, reason: `PO_VOID#${id}` } });
    }
    await tx.inventoryLot.deleteMany({ where: { purchaseId: id } });
    await tx.purchase.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidReason: why } });
  });
  return getPurchase(id);
}

async function hydratePurchases(pos: any[]) {
  const ingredientIds = [...new Set(pos.flatMap((po) => po.items.map((item: any) => item.ingredientId)).filter(Boolean))] as number[];
  const userIds = [...new Set(pos.flatMap((po) => [po.createdByUserId, po.approvedByUserId, ...po.receipts.map((receipt: any) => receipt.actorUserId)]).filter(Boolean))] as number[];
  const [ingredientRows, users] = await Promise.all([
    ingredientIds.length ? prisma.ingredient.findMany({ where: { id: { in: ingredientIds } }, select: { id: true, name: true, unit: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []
  ]);
  const ingMap = new Map(ingredientRows.map((ingredient) => [ingredient.id, ingredient]));
  const userMap = new Map(users.map((user) => [user.id, user.name]));
  const iso = (date: Date | null) => date ? date.toISOString() : null;
  return pos.map((po) => ({
    id: po.id, branchId: po.branchId, branchName: po.branch?.name, kind: po.kind, supplier: po.supplier, invoiceNumber: po.invoiceNumber,
    documentDate: iso(po.documentDate), dueDate: iso(po.dueDate), attachmentName: po.attachmentName, hasAttachment: !!po.attachmentName, ...(po.attachmentDataUrl !== undefined ? { attachmentDataUrl: po.attachmentDataUrl } : {}),
    note: po.note, totalCost: po.total, status: po.kind === "RECEIPT" && po.status === "APPROVED" ? "RECEIVED" : po.status,
    voidReason: po.voidReason ?? "", voidedAt: iso(po.voidedAt), receivedAt: iso(po.receivedAt), createdAt: po.createdAt.toISOString(),
    createdByUserId: po.createdByUserId, createdByName: userMap.get(po.createdByUserId) ?? "", approvedByUserId: po.approvedByUserId,
    approvedByName: userMap.get(po.approvedByUserId) ?? "", approvedAt: iso(po.approvedAt), itemCount: po.items.length,
    receivedCost: money(po.items.reduce((sum: number, item: any) => sum + item.receivedQty * item.unitCost, 0)),
    items: po.items.map((item: any) => ({ id: item.id, ingredientId: item.ingredientId, ingredientName: item.ingredientName || ingMap.get(item.ingredientId)?.name || "ไม่พบสินค้า", unit: item.unit || ingMap.get(item.ingredientId)?.unit || "-", description: item.description || "", qty: item.qty, receivedQty: item.receivedQty, remainingQty: Math.max(0, item.qty - item.receivedQty), unitCost: item.unitCost, lineTotal: item.lineTotal, lotNo: item.lotNo, expiryDate: iso(item.expiryDate), packSize: item.packSize })),
    receipts: po.receipts.map((receipt: any) => ({ id: receipt.id, receivedAt: receipt.receivedAt.toISOString(), createdAt: receipt.createdAt.toISOString(), actorUserId: receipt.actorUserId, actorName: userMap.get(receipt.actorUserId) ?? "", note: receipt.note,
      items: receipt.items.map((item: any) => ({ id: item.id, purchaseItemId: item.purchaseItemId, ingredientId: item.ingredientId, ingredientName: item.ingredientName, unit: item.unit, qty: item.qty, unitCost: item.unitCost, lotNo: item.lotNo, expiryDate: iso(item.expiryDate), packSize: item.packSize })) }))
  }));
}
export async function getPurchase(id: number) {
  const po = await db.purchase.findUnique({ where: { id }, include: includePurchase });
  return po ? (await hydratePurchases([po]))[0] : null;
}
export async function getPurchases(branchId?: number, options: { query?: string; status?: string } = {}) {
  const query = boundedText(options.query, "คำค้น", 120);
  const status = boundedText(options.status, "สถานะ", 20);
  if (status && !["PENDING", "APPROVED", "PARTIAL", "RECEIVED", "VOID"].includes(status)) throw new Error("สถานะใบสินค้าไม่ถูกต้อง");
  const where: any = { ...(branchId ? { branchId } : {}) };
  const AND: any[] = [];
  if (status === "RECEIVED") AND.push({ OR: [{ status: "RECEIVED" }, { kind: "RECEIPT", status: "APPROVED" }] });
  else if (status) AND.push({ status, ...(status === "APPROVED" ? { kind: "ORDER" } : {}) });
  if (query) AND.push({ OR: [{ supplier: { contains: query, mode: "insensitive" } }, { invoiceNumber: { contains: query, mode: "insensitive" } }, { note: { contains: query, mode: "insensitive" } }] });
  if (AND.length) where.AND = AND;
  const pos = await db.purchase.findMany({ where, omit: { attachmentDataUrl: true }, include: includePurchase, orderBy: { id: "desc" }, take: 100 });
  return hydratePurchases(pos);
}
