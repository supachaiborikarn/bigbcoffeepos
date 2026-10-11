import "./env.js";
import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { waitUntil } from "@vercel/functions";
import { audit, log, requestLogger, sendAlert } from "./logger.js";

const isProduction = process.env.NODE_ENV === "production";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl.startsWith("file:") || databaseUrl.includes("placeholder")) {
  throw new Error("DATABASE_URL must be a PostgreSQL connection string for the API runtime. Set DATABASE_URL in apps/api/.env.");
}

import {
  getBranches, getCustomers, getCustomerInsights, addCustomer, updateCustomer,
  getMenu, addMenuItem, setMenuGroupActive, updateMenuItem,
  getIngredients, addIngredient, updateIngredient,
  getInventoryItems, updateInventoryItem, adjustStock, getStockMovements, normalizeBarcode, assertBarcodeFree,
  getCentralWarehouses, ensureCentralWarehouse, getWarehouseInventory, adjustWarehouseStock,
  listRestockRequests, createRestockRequest, submitRestockRequest, startRestockPicking, dispatchRestockShipment, receiveRestockShipment,
  getRecipes, getRecipeCoverage, getRecipe, setRecipe,
  getCupStockSettings, setCupStockSettings,
  getOrders, getOrder, getOrderByIdempotencyKey, createOrder, updateOrderStatusWithContext,
  openShift, closeShift, getCurrentShift, getShifts, getShiftSummary,
  authenticatePin, verifyApproverPin, getUsers, addUser, updateUser, deleteUser,
  getSalesSummary, getProfitReport, getStaffPerformance, getOrdersCsvRows, getDailyCloseReport, assertReportRange,
  createPurchase, getPurchases, voidPurchase,
  getIntegrationStatus, getIntegrationOutboxSummary, getIntegrationEvents, retryIntegrationEvent, processOutboxQueue,
  enqueuePosposSync, getLatestPosposSyncJobsByBranch, getPosposSyncJob, runPosposSyncJob,
  importProducts, importCustomers, importHistoricalOrders,
  getStoreSetting, updateStoreSetting,
  listTaxInvoices, createTaxInvoice, voidTaxInvoice,
  listStockCounts, createStockCount, postStockCount, cancelStockCount,
  listStockTransfers, createStockTransfer, receiveStockTransfer, cancelStockTransfer,
  approvePurchase,
  listProductUnits, saveProductUnit,
  listPriceRules, savePriceRule,
  listInventoryLots, saveInventoryLot,
  listProductVariants, saveProductVariant,
  listPromotions, listActivePromotions, savePromotion, updatePromotion, deletePromotion,
  listCoupons, saveCoupon, updateCoupon, deleteCoupon, validateCoupon,
  listBusinessDocuments, createBusinessDocument, updateBusinessDocument, setBusinessDocumentStatus, convertQuotationToInvoice,
  getTaxExportRows, compareSales,
  getDailyEmailSetting, saveDailyEmailSetting, enqueueDailySummaryEmail,
  getCustomerDisplay,
  listMarketplaceConnections, saveMarketplaceConnection, enqueueMarketplaceSync
} from "./store/index.js";
import prisma from "./prisma.js";
import { customerHasBranch, getUnassignedCustomers, assignCustomerBranch } from "./store/customers.js";
import { resolveBranchScope, requireRecordBranch, protectSharedConfiguration } from "./middleware/branchScope.js";
import type { StoreSettingInput, VatMode } from "./store/index.js";

const app = express();
const PORT = Number(process.env.PORT ?? 5175);
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(requestLogger);

/* ─── Helpers ─── */
function parseId(raw: string | number | undefined) { const id = Number(raw); return Number.isFinite(id) ? id : null; }
function isStr(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function parseMoney(v: unknown) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; }
function parseNonNegativeNumber(v: unknown) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null; }
function parseBranchType(v: unknown) { return v === "coffee" || v === "oil_service" ? v : undefined; }
function parseReportSource(v: unknown) { return v === "pospos" || v === "all" || v === "system" ? v : "system"; }
function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
function sendCsv(res: express.Response, filename: string, rows: Record<string, unknown>[], columns: { key: string; label: string }[]) {
  const header = columns.map((column) => csvEscape(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(`\uFEFF${header}\n${body}`);
}
function sendExcelXml(res: express.Response, filename: string, rows: Record<string, unknown>[], columns: { key: string; label: string }[]) {
  const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const header = columns.map((column) => `<Cell><Data ss:Type="String">${esc(column.label)}</Data></Cell>`).join("");
  const body = rows.map((row) => `<Row>${columns.map((column) => `<Cell><Data ss:Type="${typeof row[column.key] === "number" ? "Number" : "String"}">${esc(row[column.key])}</Data></Cell>`).join("")}</Row>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Tax Export"><Table><Row>${header}</Row>${body}</Table></Worksheet>
</Workbook>`;
  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(xml);
}
function scheduleBackgroundTask(name: string, task: Promise<unknown>, meta: Record<string, unknown> = {}) {
  const tracked = task.catch((error) => {
    const details = { ...meta, message: error instanceof Error ? error.message : String(error) };
    log("error", `${name}_failed`, details);
    sendAlert("critical", `${name}_failed`, details);
  });

  try {
    waitUntil(tracked);
  } catch {
    // Local Express has no Vercel request context, but the promise has already started.
  }
}
async function readAuditRows(input: { limit?: number; action?: string; branchId?: number } = {}) {
  try {
    return await listAuditEvents(input);
  } catch (error) {
    log("warn", "audit_db_read_failed", { message: (error as Error).message });
  }
  const auditLogFile = process.env.AUDIT_LOG_FILE || path.resolve(process.cwd(), "data", "audit.log");
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 1000);
  try {
    const text = await fs.promises.readFile(auditLogFile, "utf8");
    const actionFilter = input.action?.trim().toLowerCase();
    const rows: Record<string, unknown>[] = [];
    for (const line of text.trim().split("\n").reverse()) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const action = String(row.action ?? "").toLowerCase();
        if (actionFilter && !action.includes(actionFilter)) continue;
        rows.push(row);
        if (rows.length >= limit) break;
      } catch {
        // Ignore malformed audit lines so one bad append does not break operations.
      }
    }
    return rows;
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

log("info", "db_mode", { mode: isProduction ? "production" : "development", provider: "postgresql_prisma" });

app.get("/api/health", (_req, res) => res.json({ ok: true }));

import { normalizeThaiTaxId } from "./lib/taxId.js";
import { publicError } from "./lib/publicError.js";
import { requireAuth, requireAdmin, requireRole, requireBranchAccess, generateToken, signDiscountApproval, verifyDiscountApproval, type AuthRequest } from "./middleware/auth.js";
import { listAuditEvents } from "./store/auditEvents.js";
import { closeTimeEntry, getTimeEntryBranch, listTimeEntries, punch } from "./store/timeClock.js";
import { addCashEntry, CASH_IN_CATEGORIES, CASH_OUT_CATEGORIES, getCashEntryBranch, listCashEntries, voidCashEntry } from "./store/cashDrawer.js";

const pinAttempts = new Map<string, { count: number; resetAt: number }>();
function enforcePinRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = pinAttempts.get(key);
  if (!current || current.resetAt < now) {
    pinAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  if (current.count >= 8) {
    audit("auth.pin.rate_limited", req, { ip: key });
    return res.status(429).json({ error: "ลองผิดหลายครั้งเกินไป กรุณารอสักครู่" });
  }
  current.count += 1;
  return next();
}

/* ─── Auth ─── */
app.post("/api/auth/pin", enforcePinRateLimit, async (req, res) => {
  const pin = String(req.body?.pin ?? "").trim();
  if (!pin) return res.status(400).json({ error: "กรุณาใส่ PIN" });
  const user = await authenticatePin(pin);
  if (!user) {
    audit("auth.pin.failed", req, { ip: req.ip });
    return res.status(401).json({ error: "PIN ไม่ถูกต้อง" });
  }
  
  const token = generateToken(user);
  pinAttempts.delete(req.ip || "unknown");
  audit("auth.pin.succeeded", req, { userId: user.id, role: user.role, branchId: user.branchId ?? null });
  return res.json({ user, token });
});

/* ─── Protect All Routes Below ─── */
app.use("/api", requireAuth, resolveBranchScope, protectSharedConfiguration);
app.get("/api/auth/me", (req: AuthRequest, res) => res.json({ user: req.user }));

/* ─── Audit ─── */
app.get("/api/audit", requireAdmin, async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const action = isStr(req.query.action) ? String(req.query.action) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ items: await readAuditRows({ limit, action, branchId }) });
});

app.get("/api/audit.csv", requireAdmin, async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 1000;
  const action = isStr(req.query.action) ? String(req.query.action) : undefined;
  const rows = await readAuditRows({ limit, action });
  return sendCsv(res, "audit-log.csv", rows, [
    { key: "ts", label: "Time" },
    { key: "action", label: "Action" },
    { key: "ip", label: "IP" },
    { key: "requestId", label: "Request ID" },
    { key: "orderId", label: "Order ID" },
    { key: "branchId", label: "Branch ID" }
  ]);
});

/* ─── Monitoring ─── */
app.post("/api/monitoring/alert-test", requireAdmin, async (req, res) => {
  const authReq = req as AuthRequest;
  const event = isStr(req.body?.event) ? req.body.event.trim() : "monitoring_alert_test";
  const configured = sendAlert("info", event, {
    requestId: (req as express.Request & { requestId?: string }).requestId,
    actorId: authReq.user?.id,
    role: authReq.user?.role,
    branchId: authReq.user?.branchId ?? null,
    note: isStr(req.body?.note) ? req.body.note.trim() : undefined
  });
  audit("monitoring.alert_test", req, { event, configured });
  return res.json({ ok: true, configured });
});

/* ─── Users ─── */
app.get("/api/users", requireAdmin, async (_req, res) => res.json({ items: await getUsers() }));

app.post("/api/users", requireAdmin, async (req, res) => {
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const pin = isStr(req.body?.pin) ? req.body.pin.trim() : "";
  const role = req.body?.role || "cashier";
  const branchId = parseId(req.body?.branchId);
  if (!name || !pin) return res.status(400).json({ error: "กรุณากรอกชื่อและ PIN" });
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: "PIN ต้องเป็นตัวเลข 4 หลัก" });
  if (!["admin", "manager", "cashier"].includes(role)) return res.status(400).json({ error: "Role ไม่ถูกต้อง" });
  if (role !== "admin" && branchId === null) return res.status(400).json({ error: "กรุณาเลือกสาขาประจำของพนักงาน" });
  if (branchId !== null && !(await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } }))) return res.status(400).json({ error: "ไม่พบสาขาที่เลือก" });
  try {
    const user = await addUser({ name, pin, role: role as "admin"|"manager"|"cashier", branchId: branchId ?? undefined });
    audit("user.created", req, { targetUserId: user?.id, role, branchId });
    return res.status(201).json({ user });
  }
  catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.put("/api/users/:id", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const data: any = {};
  if (isStr(req.body?.name)) data.name = req.body.name.trim();
  if (isStr(req.body?.pin)) {
    if (!/^\d{4}$/.test(req.body.pin.trim())) return res.status(400).json({ error: "PIN ต้องเป็นตัวเลข 4 หลัก" });
    data.pin = req.body.pin.trim();
  }
  if (req.body?.role && ["admin", "manager", "cashier"].includes(req.body.role)) data.role = req.body.role;
  if (req.body?.active !== undefined) data.active = req.body.active ? 1 : 0;
  if (req.body?.branchId !== undefined) {
    const bId = parseId(req.body.branchId);
    data.branchId = bId !== null ? bId : null;
  }
  try {
    const user = await updateUser(id, data);
    if (!user) return res.status(404).json({ error: "ไม่พบพนักงาน" });
    audit("user.updated", req, { targetUserId: id, changedFields: Object.keys(data) });
    return res.json({ user });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const user = await deleteUser(id);
  audit("user.deactivated", req, { targetUserId: id });
  return res.json({ user });
});

/* ─── Branches ─── */
app.get("/api/branches", async (req: AuthRequest, res) => res.json({ items: (await getBranches()).filter((branch) => branch.active && (req.user?.role === "admin" || branch.id === req.user?.branchId)) }));

/* ─── Customers ─── */
app.get("/api/customers/unassigned", requireRole("admin"), async (_req, res) => {
  res.json({ items: await getUnassignedCustomers() });
});
app.put("/api/customers/:id/branch", requireRole("admin"), async (req, res) => {
  const id = parseId(req.params.id);
  const branchId = parseId(req.body?.branchId);
  if (id === null || branchId === null) return res.status(400).json({ error: "กรุณาเลือกสมาชิกและสาขา" });
  try {
    const customer = await assignCustomerBranch(id, branchId);
    audit("customer.branch_assigned", req, { customerId: id, branchId });
    return res.json({ customer });
  } catch (error) { return res.status(400).json({ error: publicError(error) }); }
});
app.get("/api/customers", async (req: AuthRequest, res) => {
  const search = isStr(req.query.search) ? String(req.query.search).trim() : undefined;
  res.json({ items: await getCustomers(search, req.branchScope?.id) });
});
app.get("/api/customers/insights", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const inactiveDays = parseId(req.query.inactiveDays as string) ?? undefined;
  const limit = parseId(req.query.limit as string) ?? undefined;
  res.json({ insights: await getCustomerInsights({ inactiveDays, limit, branchId: req.branchScope?.id }) });
});
app.post("/api/customers", async (req: AuthRequest, res) => {
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const phone = isStr(req.body?.phone) ? req.body.phone.trim() : "";
  if (!name || !phone) return res.status(400).json({ error: "กรุณากรอกชื่อและเบอร์โทร" });
  try { return res.status(201).json({ customer: await addCustomer({ name, phone, branchId: req.branchScope?.id }) }); }
  catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.put("/api/customers/:id", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  if (req.user?.role !== "admin" && !(await customerHasBranch(id, req.user!.branchId!))) return res.status(403).json({ error: "คุณไม่มีสิทธิ์แก้ไขสมาชิกของสาขานี้" });
  try {
    const c = await updateCustomer(id, {
      name: req.body?.name?.trim(),
      phone: req.body?.phone?.trim(),
      tier: req.body?.tier !== undefined ? String(req.body.tier).trim() : undefined,
      memberCode: req.body?.memberCode === null ? null : req.body?.memberCode !== undefined ? String(req.body.memberCode).trim() : undefined,
      birthday: req.body?.birthday === null ? null : req.body?.birthday !== undefined ? String(req.body.birthday) : undefined,
      notes: req.body?.notes !== undefined ? String(req.body.notes).trim() : undefined,
      totalSpend: req.body?.totalSpend !== undefined ? parseMoney(req.body.totalSpend) ?? undefined : undefined,
      creditBalance: req.body?.creditBalance !== undefined ? parseMoney(req.body.creditBalance) ?? undefined : undefined,
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean) : undefined,
      lineUserId: req.body?.lineUserId === null ? null : req.body?.lineUserId !== undefined ? String(req.body.lineUserId).trim() : undefined,
      metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined
    });
    if (!c) return res.status(404).json({ error: "ไม่พบสมาชิก" });
    return res.json({ customer: c });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

/* ─── Menu ─── */
app.get("/api/menu", async (req: AuthRequest, res) => res.json({ items: await getMenu(req.branchScope?.branchType) }));
app.post("/api/menu", requireRole("admin", "manager"), async (req, res) => {
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const category = isStr(req.body?.category) ? req.body.category.trim() : "";
  const basePrice = parseMoney(req.body?.basePrice);
  const taxRate = req.body?.taxRate === undefined || req.body?.taxRate === null || req.body?.taxRate === "" ? undefined : parseNonNegativeNumber(req.body.taxRate);
  if (req.body?.taxRate !== undefined && req.body?.taxRate !== null && req.body?.taxRate !== "" && taxRate === null) return res.status(400).json({ error: "ภาษีไม่ถูกต้อง" });
  if (!name || !category || basePrice === null) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const item = await addMenuItem({
    name,
    category,
    basePrice,
    sku: req.body?.sku?.trim(),
    barcode: req.body?.barcode?.trim(),
    cost: parseMoney(req.body?.cost) ?? undefined,
    imageUrl: req.body?.imageUrl?.trim(),
    unit: req.body?.unit?.trim(),
    taxRate: taxRate ?? undefined,
    optionGroup: req.body?.optionGroup?.trim(),
    optionLabel: req.body?.optionLabel?.trim(),
    branchType: parseBranchType(req.body?.branchType)
  });
  audit("menu.created", req, { menuItemId: item.id, branchType: item.branchType });
  return res.status(201).json({ item });
});
app.put("/api/menu/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const cost = req.body?.cost === null || req.body?.cost === "" ? null : req.body?.cost !== undefined ? parseMoney(req.body.cost) ?? undefined : undefined;
  const taxRate = req.body?.taxRate === null || req.body?.taxRate === "" ? null : req.body?.taxRate !== undefined ? parseNonNegativeNumber(req.body.taxRate) ?? undefined : undefined;
  const item = await updateMenuItem(id, {
    name: req.body?.name?.trim(), category: req.body?.category?.trim(),
    basePrice: req.body?.basePrice !== undefined ? parseMoney(req.body.basePrice) ?? undefined : undefined,
    active: req.body?.active, sku: req.body?.sku?.trim(), barcode: req.body?.barcode?.trim(),
    cost,
    imageUrl: req.body?.imageUrl === null ? null : req.body?.imageUrl?.trim(),
    unit: req.body?.unit === null ? null : req.body?.unit?.trim(),
    taxRate,
    optionGroup: req.body?.optionGroup === null ? null : req.body?.optionGroup?.trim(),
    optionLabel: req.body?.optionLabel === null ? null : req.body?.optionLabel?.trim(),
    branchType: parseBranchType(req.body?.branchType)
  });
  if (!item) return res.status(404).json({ error: "ไม่พบสินค้า" });
  audit("menu.updated", req, { menuItemId: id });
  return res.json({ item });
});
app.delete("/api/menu/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const item = await updateMenuItem(id, { active: false });
  if (!item) return res.status(404).json({ error: "ไม่พบสินค้า" });
  audit("menu.deactivated", req, { menuItemId: id });
  return res.json({ item });
});
app.post("/api/menu/:id/restore", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const item = await updateMenuItem(id, { active: true });
  if (!item) return res.status(404).json({ error: "ไม่พบสินค้า" });
  audit("menu.restored", req, { menuItemId: id });
  return res.json({ item });
});
app.patch("/api/menu/groups/status", requireRole("admin", "manager"), async (req, res) => {
  const optionGroup = isStr(req.body?.optionGroup) ? req.body.optionGroup.trim() : "";
  const category = isStr(req.body?.category) ? req.body.category.trim() : "";
  const branchType = parseBranchType(req.body?.branchType);
  const active = req.body?.active === true;
  if (!optionGroup || !category || !branchType || typeof req.body?.active !== "boolean") {
    return res.status(400).json({ error: "ข้อมูลการ์ดเมนูไม่ครบ" });
  }
  const items = await setMenuGroupActive({ optionGroup, category, branchType, active });
  if (!items.length) return res.status(404).json({ error: "ไม่พบการ์ดเมนู" });
  audit(active ? "menu.group.restored" : "menu.group.deactivated", req, { optionGroup, category, branchType, count: items.length });
  return res.json({ items });
});

/* ─── Ingredients & Inventory ─── */
app.get("/api/ingredients", async (req: AuthRequest, res) => {
  const scope = req.branchScope;
  // scope=receivable also lists items this branch sells (via recipes) but has never stocked, so they can be received
  const where = !scope ? {} : req.query.scope === "receivable"
    ? { OR: [{ stocks: { some: { branchId: scope.id } } }, { recipes: { some: { menuItem: { branchType: scope.branchType } } } }] }
    : { stocks: { some: { branchId: scope.id } } };
  res.json({ items: await prisma.ingredient.findMany({ where, orderBy: { id: "asc" } }) });
});
app.post("/api/ingredients", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const unit = isStr(req.body?.unit) ? req.body.unit.trim() : "";
  const costPerUnit = parseMoney(req.body?.costPerUnit);
  if (!name || !unit || costPerUnit === null) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  let barcode: string | null | undefined;
  try { barcode = normalizeBarcode(req.body?.barcode); await assertBarcodeFree(barcode); }
  catch (e) { return res.status(409).json({ error: publicError(e) }); }
  const ingredient = await addIngredient({ name, unit, costPerUnit, barcode, stockQty: Number(req.body?.stockQty) || 0, reorderLevel: Number(req.body?.reorderLevel) || 0, branchId });
  audit("ingredient.created", req, { ingredientId: ingredient?.id, branchId });
  return res.status(201).json({ ingredient });
});
app.put("/api/ingredients/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  let barcode: string | null | undefined;
  try { barcode = normalizeBarcode(req.body?.barcode); await assertBarcodeFree(barcode, id); }
  catch (e) { return res.status(409).json({ error: publicError(e) }); }
  const ingredient = await updateIngredient(id, { name: req.body?.name?.trim(), unit: req.body?.unit?.trim(), costPerUnit: req.body?.costPerUnit !== undefined ? parseMoney(req.body.costPerUnit) ?? undefined : undefined, barcode });
  if (!ingredient) return res.status(404).json({ error: "ไม่พบวัตถุดิบ" });
  audit("ingredient.updated", req, { ingredientId: id, changedFields: Object.keys(req.body ?? {}) });
  return res.json({ ingredient });
});
app.get("/api/inventory", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  res.json({ items: await getInventoryItems(branchId) });
});
app.put("/api/inventory/:ingredientId", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  const ingredientId = parseId(req.params.ingredientId);
  if (branchId === null || ingredientId === null) return res.status(400).json({ error: "ระบุสาขาและสินค้า" });

  const costPerUnit = req.body?.costPerUnit !== undefined ? parseMoney(req.body.costPerUnit) : undefined;
  const stockQty = req.body?.stockQty !== undefined ? parseNonNegativeNumber(req.body.stockQty) : undefined;
  const reorderLevel = req.body?.reorderLevel !== undefined ? parseNonNegativeNumber(req.body.reorderLevel) : undefined;

  if (req.body?.costPerUnit !== undefined && costPerUnit === null) return res.status(400).json({ error: "ต้นทุนไม่ถูกต้อง" });
  if (req.body?.stockQty !== undefined && stockQty === null) return res.status(400).json({ error: "จำนวนคงเหลือไม่ถูกต้อง" });
  if (req.body?.reorderLevel !== undefined && reorderLevel === null) return res.status(400).json({ error: "จุดสั่งซื้อไม่ถูกต้อง" });
  let barcode: string | null | undefined;
  try { barcode = normalizeBarcode(req.body?.barcode); await assertBarcodeFree(barcode, ingredientId); }
  catch (e) { return res.status(409).json({ error: publicError(e) }); }

  const normalizedCostPerUnit = costPerUnit === null ? undefined : costPerUnit;
  const normalizedStockQty = stockQty === null ? undefined : stockQty;
  const normalizedReorderLevel = reorderLevel === null ? undefined : reorderLevel;

  const item = await updateInventoryItem({
    branchId,
    ingredientId,
    name: req.body?.name?.trim(),
    unit: req.body?.unit?.trim(),
    costPerUnit: normalizedCostPerUnit,
    barcode,
    stockQty: normalizedStockQty,
    reorderLevel: normalizedReorderLevel
  });
  if (!item) return res.status(404).json({ error: "ไม่พบสินค้าในสต็อก" });
  audit("inventory.updated", req, { branchId, ingredientId, changedFields: Object.keys(req.body ?? {}) });
  return res.json({ item });
});
app.post("/api/stock-adjustments", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  const ingredientId = parseId(req.body?.ingredientId);
  const qty = Number(req.body?.qty);
  if (branchId === null || ingredientId === null || !Number.isFinite(qty) || qty === 0) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const result = await adjustStock({ branchId, ingredientId, qty, reason: req.body?.reason?.trim() || "ADJUSTMENT" });
  const items = await getInventoryItems(branchId);
  const inventoryItem = items.find((item: any) => item.ingredientId === ingredientId) ?? null;
  audit("stock.adjusted", req, { branchId, ingredientId, qty, reason: req.body?.reason?.trim() || "ADJUSTMENT" });
  return res.status(201).json({ inventoryItem, movement: result.movement });
});
app.get("/api/stock-movements", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const ingredientId = parseId(req.query.ingredientId as string) ?? undefined;
  const limit = parseId(req.query.limit as string);
  res.json({ items: await getStockMovements(branchId, { ingredientId, manualOnly: req.query.manual === "1", take: limit && limit > 0 ? Math.min(Math.floor(limit), 500) : undefined }) });
});

/* ─── Central Warehouse & Restock ─── */
app.get("/api/warehouses", requireRole("admin", "manager"), async (_req, res) => {
  return res.json({ items: await getCentralWarehouses() });
});

app.post("/api/warehouses/setup", requireAdmin, async (req, res) => {
  const managerBranchId = req.body?.managerBranchId === null ? null : parseId(req.body?.managerBranchId);
  try {
    const warehouse = await ensureCentralWarehouse({ name: isStr(req.body?.name) ? req.body.name.trim() : undefined, managerBranchId });
    audit("warehouse.configured", req, { warehouseId: warehouse.id, managerBranchId });
    return res.json({ warehouse });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/warehouses/:id/inventory", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const warehouseId = parseId(req.params.id);
  if (warehouseId === null) return res.status(400).json({ error: "Invalid warehouse" });
  const warehouse = await prisma.centralWarehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) return res.status(404).json({ error: "ไม่พบสต็อกกลาง" });
  if (req.user?.role !== "admin" && warehouse.managerBranchId !== req.user?.branchId) return res.status(403).json({ error: "คุณไม่มีสิทธิ์ดูสต็อกกลาง" });
  return res.json({ items: await getWarehouseInventory(warehouseId) });
});

app.post("/api/warehouses/:id/adjustments", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const warehouseId = parseId(req.params.id);
  const ingredientId = parseId(req.body?.ingredientId);
  const qty = Number(req.body?.qty);
  if (warehouseId === null || ingredientId === null || !Number.isFinite(qty) || qty === 0) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const warehouse = await prisma.centralWarehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) return res.status(404).json({ error: "ไม่พบสต็อกกลาง" });
  if (req.user?.role !== "admin" && warehouse.managerBranchId !== req.user?.branchId) return res.status(403).json({ error: "คุณไม่มีสิทธิ์ปรับสต็อกกลาง" });
  try {
    const result = await adjustWarehouseStock({ warehouseId, ingredientId, qty, reorderLevel: req.body?.reorderLevel !== undefined ? Number(req.body.reorderLevel) : undefined, reason: isStr(req.body?.reason) ? req.body.reason.trim() : "WAREHOUSE_ADJUSTMENT", actorUserId: req.user?.id });
    audit("warehouse.stock_adjusted", req, { warehouseId, ingredientId, qty });
    return res.status(201).json(result);
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/restock-requests", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const warehouseId = parseId(req.query.warehouseId as string) ?? undefined;
  const requestedBranchId = parseId(req.query.branchId as string) ?? undefined;
  let branchId = requestedBranchId;
  if (req.user?.role !== "admin") {
    const warehouse = warehouseId ? await prisma.centralWarehouse.findUnique({ where: { id: warehouseId } }) : null;
    const managesWarehouse = Boolean(warehouse && warehouse.managerBranchId === req.user?.branchId);
    if (!managesWarehouse) branchId = req.user?.branchId ?? undefined;
  }
  return res.json({ items: await listRestockRequests({ branchId, warehouseId }) });
});

app.post("/api/restock-requests", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req: AuthRequest, res) => {
  const warehouseId = parseId(req.body?.warehouseId);
  const branchId = parseId(req.body?.branchId);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (warehouseId === null || branchId === null) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  try {
    const request = await createRestockRequest({ warehouseId, branchId, note: String(req.body?.note ?? ""), requestedByUserId: req.user?.id, items: items.map((item: any) => ({ ingredientId: parseId(item?.ingredientId) ?? 0, requestedQty: Number(item?.requestedQty) })) });
    audit("restock_request.created", req, { requestId: request.id, warehouseId, branchId });
    return res.status(201).json({ request });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/restock-requests/:id/submit", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const row = await prisma.restockRequest.findUnique({ where: { id }, include: { warehouse: true } });
  if (!row) return res.status(404).json({ error: "ไม่พบใบเบิก" });
  if (req.user?.role !== "admin" && row.branchId !== req.user?.branchId) return res.status(403).json({ error: "คุณไม่มีสิทธิ์ส่งใบเบิกนี้" });
  try {
    const request = await submitRestockRequest(id);
    audit("restock_request.submitted", req, { requestId: id, branchId: row.branchId });
    return res.json({ request });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

async function requireWarehouseOperator(req: AuthRequest, requestId: number) {
  const row = await prisma.restockRequest.findUnique({ where: { id: requestId }, include: { warehouse: true } });
  if (!row) throw new Error("NOT_FOUND");
  if (req.user?.role !== "admin" && row.warehouse.managerBranchId !== req.user?.branchId) throw new Error("FORBIDDEN");
  return row;
}

app.post("/api/restock-requests/:id/picking", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    await requireWarehouseOperator(req, id);
    const request = await startRestockPicking(id);
    audit("restock_request.picking_started", req, { requestId: id });
    return res.json({ request });
  } catch (e) {
    if ((e as Error).message === "NOT_FOUND") return res.status(404).json({ error: "ไม่พบใบเบิก" });
    if ((e as Error).message === "FORBIDDEN") return res.status(403).json({ error: "คุณไม่มีสิทธิ์จัดของจากคลังกลาง" });
    return res.status(400).json({ error: publicError(e) });
  }
});

app.post("/api/restock-requests/:id/dispatch", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    await requireWarehouseOperator(req, id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const shipment = await dispatchRestockShipment({ requestId: id, dispatchedByUserId: req.user?.id, note: String(req.body?.note ?? ""), items: items.map((item: any) => ({ requestItemId: parseId(item?.requestItemId) ?? 0, qty: Number(item?.qty) })) });
    audit("restock_shipment.dispatched", req, { requestId: id, shipmentId: shipment?.id });
    return res.status(201).json({ shipment });
  } catch (e) {
    if ((e as Error).message === "NOT_FOUND") return res.status(404).json({ error: "ไม่พบใบเบิก" });
    if ((e as Error).message === "FORBIDDEN") return res.status(403).json({ error: "คุณไม่มีสิทธิ์ออกของจากคลังกลาง" });
    return res.status(400).json({ error: publicError(e) });
  }
});

app.post("/api/restock-shipments/:id/receive", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const row = await prisma.restockShipment.findUnique({ where: { id }, include: { request: true } });
  if (!row) return res.status(404).json({ error: "ไม่พบรายการส่ง" });
  if (req.user?.role !== "admin" && row.request.branchId !== req.user?.branchId) return res.status(403).json({ error: "คุณไม่มีสิทธิ์รับของรายการนี้" });
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const shipment = await receiveRestockShipment({ shipmentId: id, receivedByUserId: req.user?.id, items: items.map((item: any) => ({ shipmentItemId: parseId(item?.shipmentItemId) ?? 0, receivedQty: Number(item?.receivedQty) })) });
    audit("restock_shipment.received", req, { shipmentId: id, requestId: row.restockRequestId, status: shipment?.status });
    return res.json({ shipment });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

/* ─── Cup Stock Settings ─── */
app.get("/api/cup-stock-settings", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  return res.json({ settings: await getCupStockSettings(branchId) });
});
app.put("/api/cup-stock-settings", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string);
  if (branchId === null || !Array.isArray(req.body?.settings)) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const settings = req.body.settings.map((setting: any) => ({
    cupOption: String(setting?.cupOption ?? "").trim(),
    deductStock: setting?.deductStock === true,
    items: Array.isArray(setting?.items)
      ? setting.items.map((item: any) => ({
        ingredientId: parseId(item?.ingredientId) ?? 0,
        qty: parseNonNegativeNumber(item?.qty) ?? 0
      }))
      : []
  }));
  try {
    const updated = await setCupStockSettings(branchId, settings);
    audit("cup_stock_settings.updated", req, { branchId, settingCount: updated.length });
    return res.json({ settings: updated });
  } catch (e) {
    return res.status(400).json({ error: publicError(e) });
  }
});

/* ─── Recipes ─── */
app.get("/api/recipes", async (req: AuthRequest, res) => res.json({ items: await getRecipes(req.branchScope?.branchType) }));
app.get("/api/recipes/coverage", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  return res.json({ report: await getRecipeCoverage({ branchId, from, to }) });
});
app.get("/api/recipes/:menuItemId", async (req: AuthRequest, res) => {
  if (req.branchScope && !(await prisma.menuItem.findFirst({ where: { id: Number(req.params.menuItemId) || 0, branchType: req.branchScope.branchType } }))) return res.status(403).json({ error: "ไม่พบเมนูในสาขานี้" });
  const id = parseId(req.params.menuItemId);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const recipe = await getRecipe(id);
  return res.json({ recipe });
});
app.put("/api/recipes/:menuItemId", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.menuItemId);
  if (id === null || !Array.isArray(req.body?.ingredients)) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const recipe = await setRecipe({ menuItemId: id, ingredients: req.body.ingredients });
  audit("recipe.updated", req, { menuItemId: id, ingredientCount: req.body.ingredients.length });
  return res.json({ recipe });
});

/* ─── Orders ─── */
app.get("/api/orders", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const limit = parseId(req.query.limit as string);
  res.json({ items: await getOrders(branchId, limit ? Math.min(limit, 1000) : undefined) });
});
app.get("/api/orders/idempotency/:key", requireRole("admin", "manager", "cashier"), async (req: AuthRequest, res) => {
  const key = String(req.params.key ?? "").trim();
  if (!key) return res.status(400).json({ error: "Invalid idempotency key" });
  const order = await getOrderByIdempotencyKey(key);
  if (!order) return res.status(404).json({ error: "ยังไม่พบบิลนี้" });
  if (req.user?.role !== "admin" && req.user?.branchId !== order.branchId) {
    return res.status(403).json({ error: "ไม่มีสิทธิ์ดูออเดอร์ของสาขาอื่น" });
  }
  return res.json({ order });
});
app.get("/api/orders/:id", requireRole("admin", "manager", "cashier"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const order = await getOrder(id);
  if (!order) return res.status(404).json({ error: "ไม่พบออเดอร์" });
  if (req.user?.role !== "admin" && req.user?.branchId !== order.branchId) {
    return res.status(403).json({ error: "ไม่มีสิทธิ์ดูออเดอร์ของสาขาอื่น" });
  }
  return res.json({ order });
});
app.patch("/api/orders/:id", requireRole("admin", "manager", "cashier"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const current = await getOrder(id);
    if (!current) return res.status(404).json({ error: "ไม่พบออเดอร์" });
    if (req.user?.role !== "admin" && req.user?.branchId !== current.branchId) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์แก้ไขออเดอร์ของสาขาอื่น" });
    }
    // a refund pays money back out: managers and admins only, and say why
    if (req.body?.status === "REFUNDED") {
      if (req.user?.role !== "admin" && req.user?.role !== "manager") return res.status(403).json({ error: "คืนเงินได้เฉพาะผู้จัดการหรือผู้ดูแลระบบ" });
      if (!isStr(req.body?.reason) || !req.body.reason.trim()) return res.status(400).json({ error: "กรุณาระบุเหตุผลที่คืนเงิน" });
    }
    const order = await updateOrderStatusWithContext(id, {
      status: req.body?.status ?? "PAID",
      actorId: req.user?.id ?? null,
      reason: typeof req.body?.reason === "string" ? req.body.reason : null
    });
    if (!order) return res.status(404).json({ error: "ไม่พบออเดอร์" });
    audit("order.status_updated", req, { orderId: id, status: req.body?.status ?? "PAID" });
    return res.json({ order });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.post("/api/orders", requireBranchAccess((req) => parseId(req.body?.branchId)), async (req: AuthRequest, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null || !Array.isArray(req.body?.items) || !req.body.items.length) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  if (!parseId(req.body.shiftId)) return res.status(400).json({ error: "กรุณาเปิดกะของสาขานี้ก่อนขาย" });
  if (req.body.customerId && req.user?.role !== "admin" && !(await customerHasBranch(Number(req.body.customerId), branchId))) return res.status(403).json({ error: "สมาชิกนี้ยังไม่ได้ผูกกับสาขาที่ขาย" });
  const sellerCanApprove = req.user?.role === "admin" || req.user?.role === "manager";
  const approver = !sellerCanApprove ? verifyDiscountApproval(req.body?.discountApprovalToken, branchId) : null;
  try {
    const order = await createOrder({
      branchId,
      customerId: req.body.customerId ?? null,
      items: req.body.items.map((i: Record<string, unknown>) => ({
        menuItemId: Number(i.menuItemId),
        productUnitId: i.productUnitId === undefined || i.productUnitId === null ? null : Number(i.productUnitId),
        qty: Number(i.qty),
        modifiers: Array.isArray(i.modifiers) ? i.modifiers : [],
        note: typeof i.note === "string" ? i.note.trim() : undefined
      })),
      paymentMethod: req.body.paymentMethod ?? "CASH",
      discountType: req.body.discountType ?? null,
      discountValue: Number(req.body.discountValue) || 0,
      discounts: Array.isArray(req.body.discounts) ? req.body.discounts : undefined,
      couponCode: typeof req.body.couponCode === "string" ? req.body.couponCode : undefined,
      skipPromotions: req.body?.skipPromotions === true,
      canApproveDiscount: sellerCanApprove || Boolean(approver),
      loyaltyPointsToUse: Number(req.body.loyaltyPointsToUse) || 0,
      userId: req.user?.id ?? req.body.userId ?? undefined,
      shiftId: req.body.shiftId ?? undefined,
      paymentDetails: {
        cashReceived: req.body?.paymentDetails?.cashReceived,
        paymentConfirmed: req.body?.paymentDetails?.paymentConfirmed === true,
        referenceNo: req.body?.paymentDetails?.referenceNo
      },
      idempotencyKey: typeof req.body?.idempotencyKey === "string"
        ? req.body.idempotencyKey
        : typeof req.header("Idempotency-Key") === "string"
          ? req.header("Idempotency-Key")
          : null
    });
    audit("order.created", req, { orderId: order.id, branchId, total: order.total, paymentMethod: order.paymentMethod, ...(approver ? { discountApprovedBy: approver.approverId } : {}) });
    return res.status(201).json({ order });
  } catch (e) {
    const message = (e as Error).message;
    if (message.startsWith("DISCOUNT_APPROVAL_REQUIRED: ")) return res.status(403).json({ error: message.slice("DISCOUNT_APPROVAL_REQUIRED: ".length), code: "DISCOUNT_APPROVAL_REQUIRED" });
    return res.status(400).json({ error: publicError(e) });
  }
});

// Manager/admin PIN at the till -> short-lived token the order carries (the PIN itself never leaves this request)
app.post("/api/discount-approvals", enforcePinRateLimit, requireBranchAccess((req) => parseId(req.body?.branchId)), async (req: AuthRequest, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  const approver = await verifyApproverPin(req.body?.pin);
  if (!approver || (approver.role !== "admin" && approver.branchId !== branchId)) {
    audit("discount.approval_denied", req, { branchId });
    return res.status(403).json({ error: "PIN ผู้จัดการไม่ถูกต้อง หรือไม่ใช่ผู้จัดการของสาขานี้" });
  }
  pinAttempts.delete(req.ip || "unknown");
  audit("discount.approved", req, { branchId, approverId: approver.id });
  return res.json({ token: signDiscountApproval(approver, branchId), approverName: approver.name });
});

/* ─── Shifts ─── */
app.get("/api/shifts", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  res.json({ items: await getShifts(branchId) });
});
app.get("/api/shifts/current", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  const shift = await getCurrentShift(branchId);
  return res.json({ shift });
});
app.post("/api/shifts/open", requireBranchAccess((req) => parseId(req.body?.branchId)), async (req: AuthRequest, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  try {
    const shift = await openShift({ branchId, userId: req.user?.id ?? req.body?.userId ?? undefined, openingCash: Number(req.body?.openingCash) || 0 });
    audit("shift.opened", req, { shiftId: shift?.id, branchId, openingCash: Number(req.body?.openingCash) || 0 });
    return res.status(201).json({ shift });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.post("/api/shifts/:id/close", requireRecordBranch(async (req) => prisma.shift.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } })), requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const shift = await closeShift(id, Number(req.body?.closingCash ?? 0), {
      cashCounts: req.body?.cashCounts,
      note: req.body?.note,
      closedByUserId: req.user?.id
    });
    const summary = await getShiftSummary(id);
    audit("shift.closed", req, { shiftId: id, closingCash: Number(req.body?.closingCash) || 0, difference: summary?.cash.difference ?? null });
    return res.json({ shift, summary });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

/* ─── Staff time clock (PIN punch in / out) ─── */
app.post("/api/time-clock/punch", enforcePinRateLimit, requireBranchAccess((req) => parseId(req.body?.branchId)), async (req: AuthRequest, res) => {
  const branchId = parseId(req.body?.branchId);
  const pin = String(req.body?.pin ?? "").trim();
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  if (!pin) return res.status(400).json({ error: "กรุณาใส่ PIN" });
  const staff = await authenticatePin(pin);
  if (!staff) {
    audit("time_clock.pin_failed", req, { branchId });
    return res.status(401).json({ error: "PIN ไม่ถูกต้อง" });
  }
  try {
    const result = await punch({ userId: staff.id, branchId });
    pinAttempts.delete(req.ip || "unknown");
    audit(result.action === "in" ? "time_clock.in" : "time_clock.out", req, { branchId, staffId: staff.id, staffName: staff.name, entryId: result.entry.id, minutes: result.entry.minutes });
    return res.json({ ...result, staff: { id: staff.id, name: staff.name } });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.get("/api/time-clock", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? "")) ? String(req.query.date) : new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const entries = await listTimeEntries(branchId, new Date(`${day}T00:00:00+07:00`), new Date(`${day}T23:59:59.999+07:00`));
  return res.json({ date: day, items: entries });
});
app.post("/api/time-clock/:id/close", requireRole("admin", "manager"), requireRecordBranch(async (req) => getTimeEntryBranch(Number(req.params.id) || 0)), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  const clockOut = new Date(String(req.body?.clockOut ?? ""));
  if (id === null || Number.isNaN(clockOut.getTime())) return res.status(400).json({ error: "ระบุเวลาออก" });
  try {
    const entry = await closeTimeEntry(id, clockOut, req.user?.id);
    audit("time_clock.closed_by_manager", req, { entryId: id, branchId: entry.branchId, staffId: entry.userId, clockOut: entry.clockOut });
    return res.json({ entry });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

/* ─── Cash drawer pay-outs / pay-ins (per open shift) ─── */
const shiftBranch = async (req: AuthRequest) => prisma.shift.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } });
app.get("/api/cash-entry-categories", (_req, res) => res.json({ out: CASH_OUT_CATEGORIES, in: CASH_IN_CATEGORIES }));
app.get("/api/shifts/:id/cash-entries", requireRecordBranch(shiftBranch), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  return res.json({ items: await listCashEntries([id], { includeVoided: true }) });
});
app.post("/api/shifts/:id/cash-entries", requireRecordBranch(shiftBranch), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    // can't pay out more cash than the drawer should hold right now
    if (req.body?.type === "OUT") {
      const drawer = (await getShiftSummary(id))?.cash.expectedCash ?? 0;
      if (Number(req.body?.amount) > drawer) return res.status(400).json({ error: `เงินในลิ้นชักตามระบบมี ${drawer.toLocaleString("th-TH")} บาท จ่ายออก ${Number(req.body.amount).toLocaleString("th-TH")} บาทไม่ได้ ถ้ามีเงินจริงมากกว่านี้ให้บันทึกเงินเข้าก่อน` });
    }
    const entry = await addCashEntry({ shiftId: id, type: req.body?.type, amount: Number(req.body?.amount), category: req.body?.category, note: req.body?.note, userId: req.user?.id });
    audit("cash_drawer.entry_added", req, { shiftId: id, entryId: entry.id, type: entry.type, amount: entry.amount, category: entry.category });
    return res.status(201).json({ entry });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.post("/api/cash-entries/:id/void", requireRole("admin", "manager"), requireRecordBranch(async (req) => getCashEntryBranch(Number(req.params.id) || 0)), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    await voidCashEntry(id, req.user?.id);
    audit("cash_drawer.entry_voided", req, { entryId: id });
    return res.json({ ok: true });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/shifts/:id/summary", requireRecordBranch(async (req) => prisma.shift.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } })), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const summary = await getShiftSummary(id);
  if (!summary) return res.status(404).json({ error: "ไม่พบกะที่ระบุ" });
  return res.json({ summary });
});

/* ─── Reports ─── */
// reversed or malformed ranges are refused instead of quietly showing old numbers
app.use(["/api/reports/summary", "/api/reports/profit", "/api/reports/staff", "/api/reports/orders.csv"], (req, res, next) => {
  try { assertReportRange({ from: isStr(req.query.from) ? String(req.query.from) : undefined, to: isStr(req.query.to) ? String(req.query.to) : undefined }); next(); }
  catch (e) { res.status(400).json({ error: publicError(e) }); }
});
app.get("/api/reports/summary", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const source = parseReportSource(req.query.source);
  return res.json({ summary: await getSalesSummary({ from, to, branchId, source }) });
});

app.get("/api/reports/profit", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const source = parseReportSource(req.query.source);
  return res.json(await getProfitReport({ from, to, branchId, source }));
});

app.get("/api/reports/staff", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const source = parseReportSource(req.query.source);
  return res.json(await getStaffPerformance({ from, to, branchId, source }));
});

app.get("/api/reports/day-close", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const date = isStr(req.query.date) ? String(req.query.date) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const source = parseReportSource(req.query.source);
  return res.json({ report: await getDailyCloseReport({ date, branchId, source }) });
});

app.get("/api/reports/orders.csv", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const source = parseReportSource(req.query.source);
  const rows = await getOrdersCsvRows({ from, to, branchId, source });
  return sendCsv(res, `orders_${from ?? "all"}_${to ?? "all"}.csv`, rows, [
    { key: "id", label: "Order ID" },
    { key: "createdAt", label: "วันที่เวลา" },
    { key: "source", label: "แหล่งที่มา" },
    { key: "branch", label: "สาขา" },
    { key: "customer", label: "ลูกค้า" },
    { key: "staff", label: "พนักงาน" },
    { key: "paymentStatus", label: "สถานะชำระเงิน" },
    { key: "fulfillmentStatus", label: "สถานะการทำ" },
    { key: "paymentMethod", label: "ช่องทางชำระ" },
    { key: "itemCount", label: "จำนวนรายการ" },
    { key: "items", label: "สินค้า (ตัวเลือก)" },
    { key: "itemNotes", label: "หมายเหตุรายการ" },
    { key: "subtotal", label: "ยอดก่อนลด" },
    { key: "discountAmount", label: "ส่วนลด" },
    { key: "loyaltyPointsUsed", label: "แต้มสมาชิกที่ใช้" },
    { key: "tax", label: "VAT ในบิล" },
    { key: "total", label: "ยอดสุทธิ" }
  ]);
});

/* ─── Imports ─── */
app.post("/api/import/products", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null || !Array.isArray(req.body?.items)) return res.status(400).json({ error: "ข้อมูลนำเข้าไม่ครบ" });
  const result = await importProducts({ branchId, items: req.body.items });
  audit("import.products", req, { branchId, ...result, errors: result.errors.length });
  return res.json({ result });
});

app.post("/api/import/customers", requireRole("admin", "manager"), async (req, res) => {
  if (!Array.isArray(req.body?.items)) return res.status(400).json({ error: "ข้อมูลนำเข้าไม่ครบ" });
  const result = await importCustomers({ items: req.body.items });
  audit("import.customers", req, { ...result, errors: result.errors.length });
  return res.json({ result });
});

app.post("/api/import/orders", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null || !Array.isArray(req.body?.items)) return res.status(400).json({ error: "ข้อมูลนำเข้าไม่ครบ" });
  const result = await importHistoricalOrders({ branchId, items: req.body.items });
  audit("import.historical_orders", req, { branchId, ...result, errors: result.errors.length });
  return res.json({ result });
});

/* ─── Legacy SQLite backup utility is unavailable in the PostgreSQL API runtime. ─── */
app.get("/api/backups/status", requireAdmin, async (_req, res) => {
  return res.json({ status: { enabled: false, message: "SQLite backups are not available in the PostgreSQL API runtime" } });
});

app.get("/api/backups", requireAdmin, async (_req, res) => {
  return res.json({ items: [] });
});

app.post("/api/backups", requireAdmin, async (req, res) => {
  audit("backup.unavailable", req, { reason: req.body?.reason });
  return res.status(503).json({ error: "SQLite backups are not available in the PostgreSQL API runtime" });
});

/* ─── Purchases ─── */
app.get("/api/purchases", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  res.json({ items: await getPurchases(branchId) });
});

app.post("/api/purchases", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  const supplier = isStr(req.body?.supplier) ? req.body.supplier.trim() : "";
  const note = String(req.body?.note ?? "").trim();
  const items = req.body?.items;
  if (branchId === null) return res.status(400).json({ error: "กรุณาเลือกสาขา" });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "กรุณาเพิ่มรายการสินค้า" });
  const normalizedItems = items.map((item: Record<string, unknown>) => ({
    ingredientId: parseId(item.ingredientId as number | string | undefined),
    qty: Number(item.qty),
    unitCost: parseMoney(item.unitCost),
    description: isStr(item.description) ? item.description.trim() : "",
    lotNo: isStr(item.lotNo) ? item.lotNo.trim() : "",
    expiryDate: isStr(item.expiryDate) && item.expiryDate ? item.expiryDate : null
  }));
  if (normalizedItems.some((item) => item.ingredientId === null || !Number.isFinite(item.qty) || item.qty <= 0 || item.unitCost === null)) {
    return res.status(400).json({ error: "รายการรับของเข้าไม่ถูกต้อง" });
  }
  try {
    // cost is shared master data (see protectSharedConfiguration), so only an admin's receipt moves it
    const updateCost = req.body?.updateCost !== false && (req as AuthRequest).user?.role === "admin";
    const po = await createPurchase(branchId, supplier || "ไม่ระบุผู้ขาย", note, normalizedItems as { ingredientId: number; qty: number; unitCost: number; description: string; lotNo: string; expiryDate: string | null }[], { updateCost });
    audit("purchase.created", req, { purchaseId: po?.id, branchId, total: po?.totalCost, costChanges: po?.costChanges });
    return res.status(201).json({ purchase: po });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/purchases/:id/void", requireRecordBranch(async (req) => prisma.purchase.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } })), requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const purchase = await voidPurchase(id, String(req.body?.reason ?? ""));
    audit("purchase.voided", req, { purchaseId: id, reason: purchase?.voidReason });
    return res.json({ purchase });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/purchases/:id/approve", requireRecordBranch(async (req) => prisma.purchase.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } })), requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const purchase = await approvePurchase(id, req.user?.id ?? null);
    audit("purchase.approved", req, { purchaseId: id });
    return res.json({ purchase });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

/* ─── POSPOS parity features ─── */
app.get("/api/tax-invoices", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ items: await listTaxInvoices(branchId) });
});

app.post("/api/tax-invoices", requireRecordBranch(async (req) => prisma.order.findUnique({ where: { id: Number(req.body?.orderId) || 0 }, select: { branchId: true } })), requireRole("admin", "manager", "cashier"), async (req, res) => {
  const orderId = parseId(req.body?.orderId);
  if (orderId === null) return res.status(400).json({ error: "กรุณาระบุออเดอร์" });
  try {
    const invoice = await createTaxInvoice({
      orderId,
      buyerName: String(req.body?.buyerName ?? "").trim(),
      buyerTaxId: String(req.body?.buyerTaxId ?? "").trim(),
      buyerAddress: String(req.body?.buyerAddress ?? "").trim(),
      buyerBranch: String(req.body?.buyerBranch ?? "").trim()
    });
    audit("tax_invoice.created", req, { invoiceId: invoice.id, orderId });
    return res.status(201).json({ invoice });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/tax-invoices/:id/void", requireRecordBranch(async (req) => prisma.taxInvoice.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } })), requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const invoice = await voidTaxInvoice(id, String(req.body?.reason ?? ""));
    audit("tax_invoice.voided", req, { invoiceId: id, reason: invoice.voidReason });
    return res.json({ invoice });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/stock-counts", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ items: await listStockCounts(branchId) });
});

app.post("/api/stock-counts", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (branchId === null) return res.status(400).json({ error: "กรุณาเลือกสาขา" });
  try {
    const stockCount = await createStockCount({
      branchId,
      note: String(req.body?.note ?? ""),
      items: items.map((item: any) => ({ ingredientId: parseId(item.ingredientId) ?? 0, countedQty: item.countedQty === "" || item.countedQty === null || item.countedQty === undefined ? NaN : Number(item.countedQty) }))
    });
    audit("stock_count.created", req, { stockCountId: stockCount?.id, branchId });
    return res.status(201).json({ stockCount });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/stock-counts/:id/cancel", requireRecordBranch(async (req) => prisma.stockCount.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } })), requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const stockCount = await cancelStockCount(id);
    audit("stock_count.cancelled", req, { stockCountId: id });
    return res.json({ stockCount });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/stock-counts/:id/post", requireRecordBranch(async (req) => prisma.stockCount.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } })), requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const stockCount = await postStockCount(id);
    audit("stock_count.posted", req, { stockCountId: id });
    return res.json({ stockCount });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/stock-transfers", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ items: await listStockTransfers(branchId) });
});

app.post("/api/stock-transfers", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.fromBranchId)), async (req, res) => {
  const fromBranchId = parseId(req.body?.fromBranchId);
  const toBranchId = parseId(req.body?.toBranchId);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (fromBranchId === null || toBranchId === null) return res.status(400).json({ error: "กรุณาเลือกสาขา" });
  try {
    const transfer = await createStockTransfer({
      fromBranchId,
      toBranchId,
      note: String(req.body?.note ?? ""),
      items: items.map((item: any) => ({ ingredientId: parseId(item.ingredientId) ?? 0, qty: Number(item.qty) || 0 }))
    });
    audit("stock_transfer.created", req, { transferId: transfer.id, fromBranchId, toBranchId });
    return res.status(201).json({ transfer });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/stock-transfers/:id/cancel", requireRecordBranch(async (req) => { const row = await prisma.stockTransfer.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { fromBranchId: true } }); return row ? { branchId: row.fromBranchId } : null; }), requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const transfer = await cancelStockTransfer(id);
    audit("stock_transfer.cancelled", req, { transferId: id });
    return res.json({ transfer });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/stock-transfers/:id/receive", requireRecordBranch(async (req) => { const row = await prisma.stockTransfer.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { toBranchId: true } }); return row ? { branchId: row.toBranchId } : null; }), requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const transfer = await receiveStockTransfer(id);
    audit("stock_transfer.received", req, { transferId: id });
    return res.json({ transfer });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/product-units", async (req: AuthRequest, res) => {
  const menuItemId = parseId(req.query.menuItemId as string) ?? undefined;
  return res.json({ items: await listProductUnits(menuItemId, req.branchScope?.branchType) });
});

app.post("/api/product-units", requireRole("admin", "manager"), async (req, res) => {
  const menuItemId = parseId(req.body?.menuItemId);
  if (menuItemId === null) return res.status(400).json({ error: "กรุณาเลือกสินค้า" });
  try {
    const item = await saveProductUnit({
      menuItemId,
      unitName: String(req.body?.unitName ?? "").trim(),
      factor: Number(req.body?.factor),
      price: req.body?.price === "" || req.body?.price === undefined ? null : Number(req.body.price),
      barcode: String(req.body?.barcode ?? "")
    });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/price-rules", requireRole("admin", "manager"), async (_req, res) => res.json({ items: await listPriceRules() }));
app.post("/api/price-rules", requireRole("admin", "manager"), async (req, res) => {
  try {
    const item = await savePriceRule({
      menuItemId: parseId(req.body?.menuItemId),
      customerTier: String(req.body?.customerTier ?? ""),
      minQty: Number(req.body?.minQty) || 1,
      price: Number(req.body?.price)
    });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/inventory-lots", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const days = parseId(req.query.days as string) ?? 30;
  return res.json({ items: await listInventoryLots(branchId, days) });
});

app.post("/api/inventory-lots", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  const ingredientId = parseId(req.body?.ingredientId);
  if (branchId === null || ingredientId === null) return res.status(400).json({ error: "ข้อมูล lot ไม่ครบ" });
  try {
    const item = await saveInventoryLot({ branchId, ingredientId, lotNo: String(req.body?.lotNo ?? ""), qty: Number(req.body?.qty), expiryDate: req.body?.expiryDate });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/product-variants", requireRole("admin", "manager"), async (req, res) => {
  const menuItemId = parseId(req.query.menuItemId as string) ?? undefined;
  return res.json({ items: await listProductVariants(menuItemId) });
});

app.post("/api/product-variants", requireRole("admin", "manager"), async (req, res) => {
  const menuItemId = parseId(req.body?.menuItemId);
  if (menuItemId === null) return res.status(400).json({ error: "กรุณาเลือกสินค้า" });
  try {
    const item = await saveProductVariant({
      menuItemId,
      optionName: String(req.body?.optionName ?? "").trim(),
      optionValue: String(req.body?.optionValue ?? "").trim(),
      priceDelta: Number(req.body?.priceDelta) || 0,
      sku: String(req.body?.sku ?? ""),
      barcode: String(req.body?.barcode ?? "")
    });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/promotions", requireRole("admin", "manager"), async (_req, res) => res.json({ items: await listPromotions() }));
// Cashier-accessible: active promotions for POS auto-apply preview
app.get("/api/promotions/active", async (_req, res) => res.json({ items: await listActivePromotions() }));
app.post("/api/promotions", requireRole("admin", "manager"), async (req, res) => {
  try {
    const item = await savePromotion({ name: String(req.body?.name ?? ""), type: String(req.body?.type ?? "ORDER_PERCENT"), value: Number(req.body?.value), category: String(req.body?.category ?? ""), startAt: req.body?.startAt, endAt: req.body?.endAt, active: req.body?.active !== false });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.put("/api/promotions/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const item = await updatePromotion(id, {
      name: req.body?.name, type: req.body?.type,
      value: req.body?.value !== undefined ? Number(req.body.value) : undefined,
      category: req.body?.category, startAt: req.body?.startAt, endAt: req.body?.endAt, active: req.body?.active
    });
    audit("promotion.updated", req, { promotionId: id });
    return res.json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.delete("/api/promotions/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    await deletePromotion(id);
    audit("promotion.deleted", req, { promotionId: id });
    return res.json({ ok: true });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/coupons", requireRole("admin", "manager"), async (_req, res) => res.json({ items: await listCoupons() }));
app.post("/api/coupons", requireRole("admin", "manager"), async (req, res) => {
  try {
    const item = await saveCoupon({ code: String(req.body?.code ?? ""), type: String(req.body?.type ?? "ORDER_FIXED"), value: Number(req.body?.value), maxUses: req.body?.maxUses ? Number(req.body.maxUses) : null, minSpend: req.body?.minSpend !== undefined && req.body?.minSpend !== "" ? Number(req.body.minSpend) : undefined, expiresAt: req.body?.expiresAt, active: req.body?.active !== false });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.put("/api/coupons/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const item = await updateCoupon(id, {
      type: req.body?.type,
      value: req.body?.value !== undefined ? Number(req.body.value) : undefined,
      maxUses: req.body?.maxUses === null ? null : (req.body?.maxUses !== undefined ? Number(req.body.maxUses) : undefined),
      minSpend: req.body?.minSpend !== undefined ? Number(req.body.minSpend) : undefined,
      expiresAt: req.body?.expiresAt, active: req.body?.active
    });
    audit("coupon.updated", req, { couponId: id });
    return res.json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.delete("/api/coupons/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    await deleteCoupon(id);
    audit("coupon.deleted", req, { couponId: id });
    return res.json({ ok: true });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
// Cashier-accessible coupon validation for POS (any authenticated user)
app.post("/api/coupons/validate", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code.trim()) return res.status(400).json({ error: "กรุณาใส่โค้ดคูปอง" });
  try {
    return res.json({ coupon: await validateCoupon(code) });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/business-documents", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ items: await listBusinessDocuments(branchId) });
});

app.post("/api/business-documents", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "กรุณาเลือกสาขา" });
  try {
    const item = await createBusinessDocument({ branchId, type: String(req.body?.type ?? "INVOICE"), customerName: String(req.body?.customerName ?? ""), total: Number(req.body?.total), payload: req.body?.payload ?? {} });
    audit("business_document.created", req, { documentId: item.id, documentNo: item.documentNo });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

const documentBranch = requireRecordBranch(async (req) => prisma.businessDocument.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } }));
app.put("/api/business-documents/:id", documentBranch, requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const item = await updateBusinessDocument(id, {
      customerName: req.body?.customerName !== undefined ? String(req.body.customerName) : undefined,
      total: req.body?.total !== undefined ? Number(req.body.total) : undefined,
      note: req.body?.note !== undefined ? String(req.body.note) : undefined
    });
    audit("business_document.updated", req, { documentId: id });
    return res.json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.post("/api/business-documents/:id/status", documentBranch, requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const item = await setBusinessDocumentStatus(id, String(req.body?.status ?? ""), String(req.body?.reason ?? ""));
    audit("business_document.status", req, { documentId: id, status: item.status });
    return res.json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});
app.post("/api/business-documents/:id/convert", documentBranch, requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const item = await convertQuotationToInvoice(id);
    audit("business_document.converted", req, { quotationId: id, invoiceId: item.id });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/reports/tax-export.xls", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const rows = await getTaxExportRows({
    from: isStr(req.query.from) ? String(req.query.from) : undefined,
    to: isStr(req.query.to) ? String(req.query.to) : undefined,
    branchId: parseId(req.query.branchId as string) ?? undefined
  });
  return sendExcelXml(res, "tax-export.xls", rows, [
    { key: "invoiceNo", label: "เลขที่เอกสาร" },
    { key: "createdAt", label: "วันที่" },
    { key: "orderId", label: "บิล" },
    { key: "branch", label: "สาขา" },
    { key: "buyerName", label: "ผู้ซื้อ" },
    { key: "buyerTaxId", label: "เลขภาษีผู้ซื้อ" },
    { key: "vatRate", label: "อัตรา VAT (%)" },
    { key: "base", label: "มูลค่าก่อน VAT" },
    { key: "tax", label: "VAT" },
    { key: "total", label: "รวม" },
    { key: "status", label: "สถานะ" },
    { key: "eTaxStatus", label: "สถานะ e-Tax" }
  ]);
});

app.get("/api/reports/compare", requireBranchAccess((req) => parseId(req.query.branchIdB as string)), requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchIdA as string)), async (req, res) => {
  const fromA = isStr(req.query.fromA) ? String(req.query.fromA) : "";
  const toA = isStr(req.query.toA) ? String(req.query.toA) : "";
  const fromB = isStr(req.query.fromB) ? String(req.query.fromB) : "";
  const toB = isStr(req.query.toB) ? String(req.query.toB) : "";
  if (!fromA || !toA || !fromB || !toB) return res.status(400).json({ error: "กรุณาระบุช่วงวันที่เปรียบเทียบ" });
  return res.json({ report: await compareSales({ fromA, toA, fromB, toB, branchIdA: parseId(req.query.branchIdA as string) ?? undefined, branchIdB: parseId(req.query.branchIdB as string) ?? undefined }) });
});

app.get("/api/daily-email-setting", requireAdmin, async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ setting: await getDailyEmailSetting(branchId) });
});

app.put("/api/daily-email-setting", requireAdmin, async (req, res) => {
  const setting = await saveDailyEmailSetting({ branchId: parseId(req.body?.branchId), recipients: String(req.body?.recipients ?? ""), sendTime: String(req.body?.sendTime ?? "21:00"), enabled: req.body?.enabled === true });
  audit("daily_email_setting.updated", req, { branchId: setting.branchId });
  return res.json({ setting });
});

app.post("/api/daily-email/enqueue", requireAdmin, async (req, res) => {
  try {
    const event = await enqueueDailySummaryEmail({ date: String(req.body?.date ?? new Date().toISOString().slice(0, 10)), branchId: parseId(req.body?.branchId) ?? undefined });
    return res.status(201).json({ event });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.get("/api/customer-display", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string);
  if (branchId === null) return res.status(400).json({ error: "กรุณาเลือกสาขา" });
  return res.json({ display: await getCustomerDisplay(branchId) });
});

app.get("/api/marketplaces", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ items: await listMarketplaceConnections(branchId) });
});

app.put("/api/marketplaces", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "กรุณาเลือกสาขา" });
  try {
    const item = await saveMarketplaceConnection({ branchId, provider: String(req.body?.provider ?? ""), shopName: String(req.body?.shopName ?? ""), config: req.body?.config ?? {} });
    return res.json({ item });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

app.post("/api/marketplaces/:id/sync", requireRecordBranch(async (req) => prisma.marketplaceConnection.findUnique({ where: { id: Number(req.params.id) || 0 }, select: { branchId: true } })), requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const event = await enqueueMarketplaceSync(id);
    return res.status(201).json({ event });
  } catch (e) { return res.status(400).json({ error: publicError(e) }); }
});

/* ─── Integrations ─── */
app.get("/api/integrations/status", requireAdmin, async (_req, res) => {
  return res.json({ items: await getIntegrationStatus() });
});

app.get("/api/integrations/summary", requireAdmin, async (_req, res) => {
  return res.json({ summary: await getIntegrationOutboxSummary() });
});

app.get("/api/integrations/events", requireAdmin, async (req, res) => {
  const provider = isStr(req.query.provider) ? String(req.query.provider) as any : undefined;
  const status = isStr(req.query.status) ? String(req.query.status) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  return res.json({ items: await getIntegrationEvents({ provider, status, limit }) });
});

app.post("/api/integrations/events/:id/retry", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const event = await retryIntegrationEvent(id);
  if (!event) return res.status(404).json({ error: "ไม่พบ integration event" });
  audit("integration_event.retry", req, { eventId: id });
  return res.json({ event });
});

app.post("/api/integrations/process", requireAdmin, async (req, res) => {
  const result = await processOutboxQueue();
  audit("integration_outbox.processed", req, result);
  return res.json({ result });
});

const outboxIntervalMs = Number(process.env.INTEGRATION_OUTBOX_INTERVAL_MS || 0);
if (Number.isFinite(outboxIntervalMs) && outboxIntervalMs >= 30_000) {
  setInterval(() => {
    processOutboxQueue().then((result) => {
      if (result.total > 0) log("info", "integration_outbox_tick", result);
      if (result.failed > 0 || result.remainingFailed > 0) {
        log("warn", "integration_outbox_attention_required", result);
        sendAlert("warning", "integration_outbox_attention_required", result);
      }
    }).catch((error) => {
      const meta = { message: error instanceof Error ? error.message : String(error) };
      log("error", "integration_outbox_tick_failed", meta);
      sendAlert("critical", "integration_outbox_tick_failed", meta);
    });
  }, outboxIntervalMs).unref();
}

// pospos-sync runs as a background job because Playwright scraping can outlive a normal HTTP request.

app.post(
  "/api/migration/sync",
  requireRole("admin", "manager"),
  requireBranchAccess((req) => parseId(req.body?.branchId)),
  async (req: AuthRequest, res) => {
    const branchId = parseId(req.body?.branchId);
    if (!branchId) return res.status(400).json({ error: "กรุณาเลือกสาขาที่จะนำเข้าข้อมูล" });

    try {
      const job = await enqueuePosposSync(branchId, req.user?.id);
      if (!job) return res.status(500).json({ error: "สร้างงานดึงข้อมูลไม่สำเร็จ" });

      if (job.status === "PENDING") {
        const task = runPosposSyncJob(job.id).then((done) => {
          if (done?.status === "SENT") {
            log("info", "migration_pospos_sync_completed", { branchId, jobId: job.id, result: done.result });
          } else if (done?.status === "FAILED") {
            log("error", "migration_pospos_sync_failed", { branchId, jobId: job.id, message: done.lastError });
          }
        });
        scheduleBackgroundTask("migration_pospos_sync", task, { branchId, jobId: job.id });
      }

      audit("migration.pospos_sync_queued", req, { branchId, jobId: job.id, status: job.status });
      return res.status(202).json({ job });
    } catch (e) {
      const meta = { message: (e as Error).message, branchId };
      log("error", "migration_sync_enqueue_failed", meta);
      sendAlert("critical", "migration_sync_enqueue_failed", meta);
      return res.status(500).json({ error: publicError(e) });
    }
  }
);

app.get("/api/migration/sync/latest", requireRole("admin", "manager"), async (_req, res) => {
  return res.json({ items: await getLatestPosposSyncJobsByBranch() });
});

app.get("/api/migration/sync/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const job = await getPosposSyncJob(id);
  if (!job) return res.status(404).json({ error: "ไม่พบงานดึงข้อมูล POSPOS" });
  return res.json({ job });
});

/* ─── Store Settings ─── */
app.get(
  "/api/settings/store",
  requireBranchAccess((req) => parseId(req.query.branchId as string | undefined)),
  async (req, res) => {
    const branchId = parseId(req.query.branchId as string | undefined);
    if (branchId === null) return res.status(400).json({ error: "กรุณาระบุสาขา" });
    return res.json({ settings: await getStoreSetting(branchId) });
  }
);

app.put("/api/settings/store", requireAdmin, async (req: AuthRequest, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "กรุณาระบุสาขา" });

  const body = req.body ?? {};
  const input: StoreSettingInput = {};
  if (isStr(body.shopName) || body.shopName === "") input.shopName = String(body.shopName).slice(0, 200);
  if (body.taxId === "" || body.taxId === null) input.taxId = "";
  else if (isStr(body.taxId)) {
    try { input.taxId = normalizeThaiTaxId(body.taxId, "เลขผู้เสียภาษีของร้าน"); }
    catch (e) { return res.status(400).json({ error: publicError(e) }); }
  }
  if (isStr(body.branchLabel) || body.branchLabel === "") input.branchLabel = String(body.branchLabel).slice(0, 100);
  if (isStr(body.addressLine) || body.addressLine === "") input.addressLine = String(body.addressLine).slice(0, 500);
  if (isStr(body.phone) || body.phone === "") input.phone = String(body.phone).slice(0, 50);
  if (isStr(body.receiptHeader) || body.receiptHeader === "") input.receiptHeader = String(body.receiptHeader).slice(0, 500);
  if (isStr(body.receiptFooter) || body.receiptFooter === "") input.receiptFooter = String(body.receiptFooter).slice(0, 500);
  if (body.vatMode === "INCLUSIVE" || body.vatMode === "EXCLUSIVE" || body.vatMode === "NONE") {
    input.vatMode = body.vatMode as VatMode;
  }
  if (body.vatRate !== undefined) {
    const rate = Number(body.vatRate);
    if (Number.isFinite(rate) && rate >= 0 && rate <= 100) input.vatRate = Math.round(rate * 100) / 100;
  }
  if (Array.isArray(body.paymentMethods)) {
    input.paymentMethods = body.paymentMethods.filter((x: unknown): x is string => typeof x === "string");
  }
  if (typeof body.allowNegativeStock === "boolean") input.allowNegativeStock = body.allowNegativeStock;

  const settings = await updateStoreSetting(branchId, input);
  audit("settings.store.updated", req, { branchId });
  return res.json({ settings });
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const meta = {
    requestId: (req as express.Request & { requestId?: string }).requestId,
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    stack: err.stack
  };
  log("error", "unhandled_error", meta);
  sendAlert("critical", "unhandled_error", meta);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => log("info", "api_started", { url: `http://localhost:${PORT}` }));
