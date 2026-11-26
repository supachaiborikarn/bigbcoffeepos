import prisma from "../prisma.js";
import { getMenuItem, updateMenuItem } from "./menu.js";
import { assertBarcodeFree, getRecipe, setRecipe, updateIngredient, updateInventoryItem } from "./inventory.js";
import { getCupStockSettings, setCupStockSettings } from "./cupStockSettings.js";
import { isSelfMenuImageUrl, publicMenuImageUrl, serializeMenuItem } from "../lib/menuImage.js";

// Managers may add catalog records directly, but a change to an existing one
// (menu details, recipes, ingredient details, cup stock) waits for an admin.
// Filling a value that was empty (first recipe, first barcode) counts as adding.

export type CatalogChangeKind = "menu.update" | "ingredient.update" | "inventory.update" | "recipe.update" | "cup_stock.update";
export type CatalogFieldChange = { field: string; label: string; before: unknown; after: unknown };
export type CatalogActor = { id: number; role: string };

type MenuUpdateInput = NonNullable<Parameters<typeof updateMenuItem>[1]>;
type RecipeLine = { ingredientId: number; qty: number };
type CupSettingInput = { cupOption: string; deductStock: boolean; items: RecipeLine[] };

export type CatalogPayload = {
  "menu.update": MenuUpdateInput;
  "ingredient.update": { name?: string; unit?: string; costPerUnit?: number; barcode?: string | null };
  "inventory.update": { name?: string; unit?: string; costPerUnit?: number; barcode?: string | null; stockQty?: number; reorderLevel?: number };
  "recipe.update": { ingredients: RecipeLine[] };
  "cup_stock.update": { settings: CupSettingInput[] };
};

export class CatalogChangeError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const MENU_LABELS: Record<string, string> = {
  name: "ชื่อ", category: "หมวดหมู่", basePrice: "ราคาขาย", sku: "SKU", barcode: "บาร์โค้ด", cost: "ต้นทุน",
  imageUrl: "รูปภาพ", unit: "หน่วย", taxRate: "ภาษี", optionGroup: "การ์ดเมนู", optionLabel: "ชื่อตัวเลือก",
  branchType: "ประเภทร้าน", active: "เปิดขาย"
};
const INGREDIENT_LABELS: Record<string, string> = {
  name: "ชื่อ", unit: "หน่วย", costPerUnit: "ต้นทุน/หน่วย", barcode: "บาร์โค้ด", stockQty: "จำนวนคงเหลือ", reorderLevel: "จุดแจ้งเตือน"
};
// Opening/closing a menu for sale is not an edit that needs approval.
const MENU_DIRECT_FIELDS = new Set(["active"]);

function blank(value: unknown) {
  return value === undefined || value === null || value === "";
}

function sameValue(a: unknown, b: unknown) {
  if (blank(a) && blank(b)) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return a === b;
}

function fieldChanges(current: Record<string, unknown>, next: Record<string, unknown>, labels: Record<string, string>) {
  const changes: CatalogFieldChange[] = [];
  for (const [field, after] of Object.entries(next)) {
    if (after === undefined || !(field in labels)) continue;
    const before = current[field] ?? null;
    if (!sameValue(before, after)) changes.push({ field, label: labels[field], before, after: after ?? null });
  }
  return changes;
}

function linesKey(lines: RecipeLine[]) {
  return [...lines].sort((a, b) => a.ingredientId - b.ingredientId).map((line) => `${line.ingredientId}:${Number(line.qty)}`).join(",");
}

async function ingredientNames(ids: number[]) {
  const rows = ids.length ? await prisma.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } }) : [];
  return new Map(rows.map((row) => [row.id, row]));
}

async function describeLines(lines: RecipeLine[]) {
  if (!lines.length) return "—";
  const names = await ingredientNames(lines.map((line) => line.ingredientId));
  return lines.map((line) => {
    const row = names.get(line.ingredientId);
    return `${row?.name ?? `#${line.ingredientId}`} ${Number(line.qty)}${row?.unit ? ` ${row.unit}` : ""}`;
  }).join(", ");
}

type Described = { targetName: string; changes: CatalogFieldChange[]; needsApproval: boolean; payload: unknown };

/** Compare a proposed change with the live record; payload keeps only what actually changes. */
async function describe(kind: CatalogChangeKind, targetId: number, branchId: number | null, payload: any): Promise<Described> {
  if (kind === "menu.update") {
    const item = await getMenuItem(targetId);
    if (!item) throw new CatalogChangeError("ไม่พบสินค้า", 404);
    const normalizedPayload = payload && typeof payload === "object" ? { ...payload } : {};
    if (normalizedPayload.imageUrl !== undefined && isSelfMenuImageUrl(targetId, normalizedPayload.imageUrl)) {
      delete normalizedPayload.imageUrl;
    }
    const rawChanges = fieldChanges(item as unknown as Record<string, unknown>, normalizedPayload, MENU_LABELS);
    const changes = rawChanges.map((change) =>
      change.field === "imageUrl"
        ? {
            ...change,
            before: typeof change.before === "string" ? publicMenuImageUrl(targetId, change.before) : change.before
          }
        : change
    );
    const changed = Object.fromEntries(rawChanges.map((change) => [change.field, normalizedPayload[change.field]]));
    // Filling a missing product photo counts as adding data (like linking a first barcode).
    const needsApproval = rawChanges.some((change) =>
      !MENU_DIRECT_FIELDS.has(change.field) && !(change.field === "imageUrl" && blank(change.before))
    );
    return { targetName: item.name, changes, needsApproval, payload: changed };
  }
  if (kind === "ingredient.update" || kind === "inventory.update") {
    const ingredient = await prisma.ingredient.findUnique({ where: { id: targetId } });
    if (!ingredient) throw new CatalogChangeError("ไม่พบวัตถุดิบ", 404);
    const stock = kind === "inventory.update" && branchId
      ? await prisma.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId: targetId } } })
      : null;
    const current = { ...ingredient, stockQty: stock?.stockQty ?? 0, reorderLevel: stock?.reorderLevel ?? 0 };
    const changes = fieldChanges(current as unknown as Record<string, unknown>, payload, INGREDIENT_LABELS);
    const changed = Object.fromEntries(changes.map((change) => [change.field, payload[change.field]]));
    // Linking a barcode to an item that has none is adding data, not changing it.
    const firstBarcodeOnly = changes.every((change) => change.field === "barcode" && blank(change.before));
    return { targetName: ingredient.name, changes, needsApproval: changes.length > 0 && !firstBarcodeOnly, payload: changed };
  }
  if (kind === "recipe.update") {
    const item = await getMenuItem(targetId);
    if (!item) throw new CatalogChangeError("ไม่พบเมนู", 404);
    const current = (await getRecipe(targetId)).ingredients;
    const next: RecipeLine[] = payload.ingredients;
    const same = linesKey(current) === linesKey(next);
    const changes = same ? [] : [{ field: "ingredients", label: "สูตรตัดสต็อก", before: await describeLines(current), after: await describeLines(next) }];
    return { targetName: item.name, changes, needsApproval: !same && current.length > 0, payload };
  }
  // cup_stock.update
  if (!branchId) throw new CatalogChangeError("ระบุสาขา");
  const current = await getCupStockSettings(branchId);
  const byOption = new Map(current.map((setting) => [setting.cupOption, setting]));
  const changes: CatalogFieldChange[] = [];
  let needsApproval = false;
  for (const setting of payload.settings as CupSettingInput[]) {
    const existing = byOption.get(setting.cupOption as never);
    const beforeLines = existing?.deductStock ? existing.items.map((item: RecipeLine) => ({ ingredientId: item.ingredientId, qty: item.qty })) : [];
    const afterLines = setting.deductStock ? setting.items : [];
    if (linesKey(beforeLines) === linesKey(afterLines) && Boolean(existing?.deductStock) === setting.deductStock) continue;
    changes.push({
      field: setting.cupOption, label: setting.cupOption,
      before: existing?.deductStock ? await describeLines(beforeLines) : "ไม่ตัดสต็อก",
      after: setting.deductStock ? await describeLines(afterLines) : "ไม่ตัดสต็อก"
    });
    // A cup that was never configured for this branch is being set up, not changed.
    if (existing?.configured) needsApproval = true;
  }
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
  return { targetName: `การตัดสต็อกแก้ว · ${branch?.name ?? `สาขา #${branchId}`}`, changes, needsApproval, payload };
}

async function apply(kind: CatalogChangeKind, targetId: number, branchId: number | null, payload: any): Promise<Record<string, unknown>> {
  if (kind === "menu.update") {
    const safePayload = payload && typeof payload === "object" ? { ...payload } : {};
    if (safePayload.imageUrl !== undefined && isSelfMenuImageUrl(targetId, safePayload.imageUrl)) {
      delete safePayload.imageUrl;
    }
    const item = await updateMenuItem(targetId, safePayload);
    if (!item) throw new CatalogChangeError("ไม่พบสินค้า", 404);
    return { item: serializeMenuItem(item) };
  }
  if (kind === "ingredient.update") {
    await assertBarcodeFree(payload.barcode, targetId);
    if (!Object.keys(payload).length) return { ingredient: await prisma.ingredient.findUnique({ where: { id: targetId } }) };
    const ingredient = await updateIngredient(targetId, payload);
    if (!ingredient) throw new CatalogChangeError("ไม่พบวัตถุดิบ", 404);
    return { ingredient };
  }
  if (kind === "inventory.update") {
    if (!branchId) throw new CatalogChangeError("ระบุสาขา");
    await assertBarcodeFree(payload.barcode, targetId);
    const item = await updateInventoryItem({ branchId, ingredientId: targetId, ...payload });
    if (!item) throw new CatalogChangeError("ไม่พบสินค้าในสต็อก", 404);
    return { item };
  }
  if (kind === "recipe.update") return { recipe: await setRecipe({ menuItemId: targetId, ingredients: payload.ingredients }) };
  if (!branchId) throw new CatalogChangeError("ระบุสาขา");
  return { settings: await setCupStockSettings(branchId, payload.settings) };
}

export type CatalogEditOutcome =
  | { status: "applied"; result: Record<string, unknown>; changes: CatalogFieldChange[] }
  | { status: "pending"; request: CatalogChangeView };

/** Admins (and managers making no approval-worthy change) apply now; other manager edits are queued. */
export async function submitCatalogEdit(input: { kind: CatalogChangeKind; targetId: number; branchId: number | null; payload: unknown; actor: CatalogActor }): Promise<CatalogEditOutcome> {
  const described = await describe(input.kind, input.targetId, input.branchId, input.payload);
  if (input.actor.role === "admin" || !described.needsApproval) {
    // An admin's save is applied in full, exactly as before this workflow existed.
    const payload = input.actor.role === "admin" ? input.payload : described.payload;
    return { status: "applied", result: await apply(input.kind, input.targetId, input.branchId, payload), changes: described.changes };
  }
  const data = {
    targetName: described.targetName,
    payload: JSON.stringify(described.payload),
    changes: JSON.stringify(described.changes),
    createdAt: new Date()
  };
  // A second edit to the same record by the same person replaces the one still waiting.
  const waiting = await prisma.catalogChangeRequest.findFirst({
    where: { kind: input.kind, targetId: input.targetId, branchId: input.branchId, requestedByUserId: input.actor.id, status: "PENDING" },
    select: { id: true }
  });
  const row = waiting
    ? await prisma.catalogChangeRequest.update({ where: { id: waiting.id }, data })
    : await prisma.catalogChangeRequest.create({ data: { ...data, kind: input.kind, targetId: input.targetId, branchId: input.branchId, requestedByUserId: input.actor.id } });
  const [view] = await toViews([row]);
  return { status: "pending", request: view };
}

type Row = Awaited<ReturnType<typeof prisma.catalogChangeRequest.findMany>>[number];
export type CatalogChangeView = Omit<Row, "payload" | "changes"> & {
  changes: CatalogFieldChange[];
  requestedByName: string | null;
  reviewedByName: string | null;
  branchName: string | null;
  outdated: boolean;
};

async function toViews(rows: Row[]): Promise<CatalogChangeView[]> {
  const userIds = [...new Set(rows.flatMap((row) => [row.requestedByUserId, row.reviewedByUserId]).filter((id): id is number => Boolean(id)))];
  const branchIds = [...new Set(rows.map((row) => row.branchId).filter((id): id is number => Boolean(id)))];
  const [users, branches] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    branchIds.length ? prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : []
  ]);
  const userName = new Map(users.map((user) => [user.id, user.name]));
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  return Promise.all(rows.map(async ({ payload, changes, ...row }) => {
    const recorded: CatalogFieldChange[] = JSON.parse(changes || "[]");
    let outdated = false;
    if (row.status === "PENDING") {
      // Someone changed the record after this request was made; approving would overwrite that.
      try {
        const now = await describe(row.kind as CatalogChangeKind, row.targetId, row.branchId, JSON.parse(payload || "{}"));
        const liveBefore = new Map(now.changes.map((change) => [change.field, change.before]));
        outdated = recorded.some((change) => liveBefore.has(change.field) ? !sameValue(liveBefore.get(change.field), change.before) : true);
      } catch { outdated = true; }
    }
    return {
      ...row,
      changes: recorded,
      requestedByName: userName.get(row.requestedByUserId) ?? null,
      reviewedByName: row.reviewedByUserId ? userName.get(row.reviewedByUserId) ?? null : null,
      branchName: row.branchId ? branchName.get(row.branchId) ?? null : null,
      outdated
    };
  }));
}

export async function listCatalogChangeRequests(input: { status?: string; requestedByUserId?: number; limit?: number }) {
  const rows = await prisma.catalogChangeRequest.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.requestedByUserId ? { requestedByUserId: input.requestedByUserId } : {})
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input.limit ?? 100, 1), 300)
  });
  return toViews(rows);
}

export async function countPendingCatalogChanges() {
  return prisma.catalogChangeRequest.count({ where: { status: "PENDING" } });
}

export async function getCatalogChangeRequest(id: number) {
  return prisma.catalogChangeRequest.findUnique({ where: { id } });
}

async function claim(id: number, data: { status: string; reviewedByUserId: number | null; reviewNote?: string }, extraWhere: Record<string, unknown> = {}) {
  const claimed = await prisma.catalogChangeRequest.updateMany({
    where: { id, status: "PENDING", ...extraWhere },
    data: { ...data, reviewNote: data.reviewNote ?? "", reviewedAt: new Date() }
  });
  if (!claimed.count) throw new CatalogChangeError("คำขอนี้ถูกจัดการไปแล้ว หรือไม่พบคำขอ", 409);
  return prisma.catalogChangeRequest.findUniqueOrThrow({ where: { id } });
}

export async function approveCatalogChange(id: number, reviewerId: number, note = "") {
  const row = await claim(id, { status: "APPROVED", reviewedByUserId: reviewerId, reviewNote: note });
  try {
    const result = await apply(row.kind as CatalogChangeKind, row.targetId, row.branchId, JSON.parse(row.payload || "{}"));
    const [view] = await toViews([row]);
    return { request: view, result };
  } catch (error) {
    // Put it back so the admin can retry or reject after fixing the cause.
    await prisma.catalogChangeRequest.update({ where: { id }, data: { status: "PENDING", reviewedByUserId: null, reviewedAt: null, reviewNote: "" } });
    throw error;
  }
}

export async function rejectCatalogChange(id: number, reviewerId: number, note = "") {
  const [view] = await toViews([await claim(id, { status: "REJECTED", reviewedByUserId: reviewerId, reviewNote: note })]);
  return view;
}

export async function cancelCatalogChange(id: number, requesterId: number) {
  const [view] = await toViews([await claim(id, { status: "CANCELLED", reviewedByUserId: null }, { requestedByUserId: requesterId })]);
  return view;
}
