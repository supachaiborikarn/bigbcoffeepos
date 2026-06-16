import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
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
  getInventoryItems, updateInventoryItem, adjustStock, getStockMovements,
  getRecipes, getRecipeCoverage, getRecipe, setRecipe,
  getCupStockSettings, setCupStockSettings,
  getOrders, getOrder, getOrderByIdempotencyKey, createOrder, updateOrderStatusWithContext,
  openShift, closeShift, getCurrentShift, getShifts, getShiftSummary,
  authenticatePin, getUsers, addUser, updateUser, deleteUser,
  getSalesSummary, getProfitReport, getStaffPerformance, getOrdersCsvRows, getDailyCloseReport,
  createPurchase, getPurchases,
  getIntegrationStatus, getIntegrationOutboxSummary, getIntegrationEvents, retryIntegrationEvent, processOutboxQueue,
  importProducts, importCustomers, importHistoricalOrders,
  getStoreSetting, updateStoreSetting,
  listTaxInvoices, createTaxInvoice,
  listStockCounts, createStockCount, postStockCount,
  listStockTransfers, createStockTransfer, receiveStockTransfer,
  approvePurchase,
  listProductUnits, saveProductUnit,
  listPriceRules, savePriceRule,
  listInventoryLots, saveInventoryLot,
  listProductVariants, saveProductVariant,
  listPromotions, listActivePromotions, savePromotion, updatePromotion, deletePromotion,
  listCoupons, saveCoupon, updateCoupon, deleteCoupon, validateCoupon,
  listBusinessDocuments, createBusinessDocument,
  getTaxExportRows, compareSales,
  getDailyEmailSetting, saveDailyEmailSetting, enqueueDailySummaryEmail,
  getCustomerDisplay,
  listMarketplaceConnections, saveMarketplaceConnection, enqueueMarketplaceSync
} from "./store/index.js";
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
async function readAuditRows(input: { limit?: number; action?: string } = {}) {
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

import { requireAuth, requireAdmin, requireRole, requireBranchAccess, generateToken, type AuthRequest } from "./middleware/auth.js";

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
app.use("/api", requireAuth);

/* ─── Audit ─── */
app.get("/api/audit", requireAdmin, async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const action = isStr(req.query.action) ? String(req.query.action) : undefined;
  return res.json({ items: await readAuditRows({ limit, action }) });
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
  try {
    const user = await addUser({ name, pin, role: role as "admin"|"manager"|"cashier", branchId: branchId ?? undefined });
    audit("user.created", req, { targetUserId: user?.id, role, branchId });
    return res.status(201).json({ user });
  }
  catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const user = await deleteUser(id);
  audit("user.deactivated", req, { targetUserId: id });
  return res.json({ user });
});

/* ─── Branches ─── */
app.get("/api/branches", async (_req, res) => res.json({ items: await getBranches() }));

/* ─── Customers ─── */
app.get("/api/customers", async (req, res) => {
  const search = isStr(req.query.search) ? String(req.query.search).trim() : undefined;
  res.json({ items: await getCustomers(search) });
});
app.get("/api/customers/insights", async (req, res) => {
  const inactiveDays = parseId(req.query.inactiveDays as string) ?? undefined;
  const limit = parseId(req.query.limit as string) ?? undefined;
  res.json({ insights: await getCustomerInsights({ inactiveDays, limit }) });
});
app.post("/api/customers", async (req, res) => {
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const phone = isStr(req.body?.phone) ? req.body.phone.trim() : "";
  if (!name || !phone) return res.status(400).json({ error: "กรุณากรอกชื่อและเบอร์โทร" });
  try { return res.status(201).json({ customer: await addCustomer({ name, phone }) }); }
  catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});
app.put("/api/customers/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

/* ─── Menu ─── */
app.get("/api/menu", async (_req, res) => res.json({ items: await getMenu() }));
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
app.get("/api/ingredients", async (_req, res) => res.json({ items: await getIngredients() }));
app.post("/api/ingredients", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const unit = isStr(req.body?.unit) ? req.body.unit.trim() : "";
  const costPerUnit = parseMoney(req.body?.costPerUnit);
  if (!name || !unit || costPerUnit === null) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const ingredient = await addIngredient({ name, unit, costPerUnit, stockQty: Number(req.body?.stockQty) || 0, reorderLevel: Number(req.body?.reorderLevel) || 0, branchId });
  audit("ingredient.created", req, { ingredientId: ingredient?.id, branchId });
  return res.status(201).json({ ingredient });
});
app.put("/api/ingredients/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const ingredient = await updateIngredient(id, { name: req.body?.name?.trim(), unit: req.body?.unit?.trim(), costPerUnit: req.body?.costPerUnit !== undefined ? parseMoney(req.body.costPerUnit) ?? undefined : undefined });
  if (!ingredient) return res.status(404).json({ error: "ไม่พบวัตถุดิบ" });
  audit("ingredient.updated", req, { ingredientId: id });
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

  const normalizedCostPerUnit = costPerUnit === null ? undefined : costPerUnit;
  const normalizedStockQty = stockQty === null ? undefined : stockQty;
  const normalizedReorderLevel = reorderLevel === null ? undefined : reorderLevel;

  const item = await updateInventoryItem({
    branchId,
    ingredientId,
    name: req.body?.name?.trim(),
    unit: req.body?.unit?.trim(),
    costPerUnit: normalizedCostPerUnit,
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
  res.json({ items: await getStockMovements(branchId) });
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
    return res.status(400).json({ error: (e as Error).message });
  }
});

/* ─── Recipes ─── */
app.get("/api/recipes", async (_req, res) => res.json({ items: await getRecipes() }));
app.get("/api/recipes/coverage", requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  return res.json({ report: await getRecipeCoverage({ branchId, from, to }) });
});
app.get("/api/recipes/:menuItemId", async (req, res) => {
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
  res.json({ items: await getOrders(branchId) });
});
app.get("/api/orders/idempotency/:key", requireRole("admin", "manager", "cashier"), async (req: AuthRequest, res) => {
  const key = String(req.params.key ?? "").trim();
  if (!key) return res.status(400).json({ error: "Invalid idempotency key" });
  const order = await getOrderByIdempotencyKey(key);
  if (!order) return res.status(404).json({ error: "ยังไม่พบบิลนี้" });
  if (req.user?.role === "cashier" && req.user.branchId !== order.branchId) {
    return res.status(403).json({ error: "ไม่มีสิทธิ์ดูออเดอร์ของสาขาอื่น" });
  }
  return res.json({ order });
});
app.get("/api/orders/:id", requireRole("admin", "manager", "cashier"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const order = await getOrder(id);
  if (!order) return res.status(404).json({ error: "ไม่พบออเดอร์" });
  if (req.user?.role === "cashier" && req.user.branchId !== order.branchId) {
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
    if (req.user?.role === "cashier" && req.user.branchId !== current.branchId) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์แก้ไขออเดอร์ของสาขาอื่น" });
    }
    const order = await updateOrderStatusWithContext(id, {
      status: req.body?.status ?? "PAID",
      actorId: req.user?.id ?? null,
      reason: typeof req.body?.reason === "string" ? req.body.reason : null
    });
    if (!order) return res.status(404).json({ error: "ไม่พบออเดอร์" });
    audit("order.status_updated", req, { orderId: id, status: req.body?.status ?? "PAID" });
    return res.json({ order });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});
app.post("/api/orders", requireBranchAccess((req) => parseId(req.body?.branchId)), async (req: AuthRequest, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null || !Array.isArray(req.body?.items) || !req.body.items.length) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
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
    audit("order.created", req, { orderId: order.id, branchId, total: order.total, paymentMethod: order.paymentMethod });
    return res.status(201).json({ order });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});
app.post("/api/shifts/:id/close", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const shift = await closeShift(id, Number(req.body?.closingCash) || 0, {
      cashCounts: req.body?.cashCounts,
      note: req.body?.note
    });
    const summary = await getShiftSummary(id);
    audit("shift.closed", req, { shiftId: id, closingCash: Number(req.body?.closingCash) || 0, difference: summary?.cash.difference ?? null });
    return res.json({ shift, summary });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.get("/api/shifts/:id/summary", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const summary = await getShiftSummary(id);
  if (!summary) return res.status(404).json({ error: "ไม่พบกะที่ระบุ" });
  return res.json({ summary });
});

/* ─── Reports ─── */
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
    { key: "status", label: "สถานะ" },
    { key: "paymentMethod", label: "ช่องทางชำระ" },
    { key: "itemCount", label: "จำนวนรายการ" },
    { key: "items", label: "สินค้า" },
    { key: "itemNotes", label: "หมายเหตุรายการ" },
    { key: "subtotal", label: "ยอดก่อนลด" },
    { key: "discountAmount", label: "ส่วนลด" },
    { key: "loyaltyPointsUsed", label: "แต้มที่ใช้" },
    { key: "tax", label: "ภาษี" },
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
    unitCost: parseMoney(item.unitCost)
  }));
  if (normalizedItems.some((item) => item.ingredientId === null || !Number.isFinite(item.qty) || item.qty <= 0 || item.unitCost === null)) {
    return res.status(400).json({ error: "รายการรับของเข้าไม่ถูกต้อง" });
  }
  try {
    const po = await createPurchase(branchId, supplier || "ไม่ระบุผู้ขาย", note, normalizedItems as { ingredientId: number; qty: number; unitCost: number }[]);
    audit("purchase.created", req, { purchaseId: po?.id, branchId, total: po?.totalCost });
    return res.status(201).json({ purchase: po });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.post("/api/purchases/:id/approve", requireRole("admin", "manager"), async (req: AuthRequest, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const purchase = await approvePurchase(id, req.user?.id ?? null);
    audit("purchase.approved", req, { purchaseId: id });
    return res.json({ purchase });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

/* ─── POSPOS parity features ─── */
app.get("/api/tax-invoices", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ items: await listTaxInvoices(branchId) });
});

app.post("/api/tax-invoices", requireRole("admin", "manager", "cashier"), async (req, res) => {
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
      items: items.map((item: any) => ({ ingredientId: parseId(item.ingredientId) ?? 0, countedQty: Number(item.countedQty) || 0 }))
    });
    audit("stock_count.created", req, { stockCountId: stockCount?.id, branchId });
    return res.status(201).json({ stockCount });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.post("/api/stock-counts/:id/post", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const stockCount = await postStockCount(id);
    audit("stock_count.posted", req, { stockCountId: id });
    return res.json({ stockCount });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.post("/api/stock-transfers/:id/receive", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const transfer = await receiveStockTransfer(id);
    audit("stock_transfer.received", req, { transferId: id });
    return res.json({ transfer });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.get("/api/product-units", requireRole("admin", "manager"), async (req, res) => {
  const menuItemId = parseId(req.query.menuItemId as string) ?? undefined;
  return res.json({ items: await listProductUnits(menuItemId) });
});

app.post("/api/product-units", requireRole("admin", "manager"), async (req, res) => {
  const menuItemId = parseId(req.body?.menuItemId);
  if (menuItemId === null) return res.status(400).json({ error: "กรุณาเลือกสินค้า" });
  try {
    const item = await saveProductUnit({
      menuItemId,
      unitName: String(req.body?.unitName ?? "").trim(),
      factor: Number(req.body?.factor) || 1,
      price: req.body?.price === "" || req.body?.price === undefined ? null : Number(req.body.price),
      barcode: String(req.body?.barcode ?? "")
    });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.get("/api/price-rules", requireRole("admin", "manager"), async (_req, res) => res.json({ items: await listPriceRules() }));
app.post("/api/price-rules", requireRole("admin", "manager"), async (req, res) => {
  try {
    const item = await savePriceRule({
      menuItemId: parseId(req.body?.menuItemId),
      customerTier: String(req.body?.customerTier ?? ""),
      minQty: Number(req.body?.minQty) || 1,
      price: Number(req.body?.price) || 0
    });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
    const item = await saveInventoryLot({ branchId, ingredientId, lotNo: String(req.body?.lotNo ?? ""), qty: Number(req.body?.qty) || 0, expiryDate: req.body?.expiryDate });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.get("/api/promotions", requireRole("admin", "manager"), async (_req, res) => res.json({ items: await listPromotions() }));
// Cashier-accessible: active promotions for POS auto-apply preview
app.get("/api/promotions/active", async (_req, res) => res.json({ items: await listActivePromotions() }));
app.post("/api/promotions", requireRole("admin", "manager"), async (req, res) => {
  try {
    const item = await savePromotion({ name: String(req.body?.name ?? ""), type: String(req.body?.type ?? "ORDER_PERCENT"), value: Number(req.body?.value) || 0, category: String(req.body?.category ?? ""), startAt: req.body?.startAt, endAt: req.body?.endAt, active: req.body?.active !== false });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});
app.delete("/api/promotions/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    await deletePromotion(id);
    audit("promotion.deleted", req, { promotionId: id });
    return res.json({ ok: true });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.get("/api/coupons", requireRole("admin", "manager"), async (_req, res) => res.json({ items: await listCoupons() }));
app.post("/api/coupons", requireRole("admin", "manager"), async (req, res) => {
  try {
    const item = await saveCoupon({ code: String(req.body?.code ?? ""), type: String(req.body?.type ?? "ORDER_FIXED"), value: Number(req.body?.value) || 0, maxUses: req.body?.maxUses ? Number(req.body.maxUses) : null, expiresAt: req.body?.expiresAt, active: req.body?.active !== false });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});
app.put("/api/coupons/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const item = await updateCoupon(id, {
      type: req.body?.type,
      value: req.body?.value !== undefined ? Number(req.body.value) : undefined,
      maxUses: req.body?.maxUses === null ? null : (req.body?.maxUses !== undefined ? Number(req.body.maxUses) : undefined),
      expiresAt: req.body?.expiresAt, active: req.body?.active
    });
    audit("coupon.updated", req, { couponId: id });
    return res.json({ item });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});
app.delete("/api/coupons/:id", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    await deleteCoupon(id);
    audit("coupon.deleted", req, { couponId: id });
    return res.json({ ok: true });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});
// Cashier-accessible coupon validation for POS (any authenticated user)
app.post("/api/coupons/validate", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code.trim()) return res.status(400).json({ error: "กรุณาใส่โค้ดคูปอง" });
  try {
    return res.json({ coupon: await validateCoupon(code) });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.get("/api/business-documents", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchId as string)), async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ items: await listBusinessDocuments(branchId) });
});

app.post("/api/business-documents", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.body?.branchId)), async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "กรุณาเลือกสาขา" });
  try {
    const item = await createBusinessDocument({ branchId, type: String(req.body?.type ?? "INVOICE"), customerName: String(req.body?.customerName ?? ""), total: Number(req.body?.total) || 0, payload: req.body?.payload ?? {} });
    return res.status(201).json({ item });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
    { key: "branch", label: "สาขา" },
    { key: "buyerName", label: "ผู้ซื้อ" },
    { key: "buyerTaxId", label: "เลขภาษีผู้ซื้อ" },
    { key: "subtotal", label: "มูลค่าสินค้า" },
    { key: "discountAmount", label: "ส่วนลด" },
    { key: "tax", label: "VAT" },
    { key: "total", label: "รวม" },
    { key: "eTaxStatus", label: "สถานะ e-Tax" }
  ]);
});

app.get("/api/reports/compare", requireRole("admin", "manager"), requireBranchAccess((req) => parseId(req.query.branchIdA as string)), async (req, res) => {
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.post("/api/marketplaces/:id/sync", requireRole("admin", "manager"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const event = await enqueueMarketplaceSync(id);
    return res.status(201).json({ event });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
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

// pospos-sync is dynamically imported on demand because it requires Playwright.

app.post("/api/migration/sync", async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (!branchId) return res.status(400).json({ error: "กรุณาเลือกสาขาที่จะนำเข้าข้อมูล" });
  
  try {
    const { syncPosposData } = await import("./scripts/pospos-sync.js");
    const result = await syncPosposData(branchId);
    audit("migration.pospos_sync", req, { branchId, result });
    return res.status(200).json(result);
  } catch (e) {
    const meta = { message: (e as Error).message, branchId };
    log("error", "migration_sync_failed", meta);
    sendAlert("critical", "migration_sync_failed", meta);
    return res.status(500).json({ error: (e as Error).message });
  }
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
  if (isStr(body.taxId) || body.taxId === "") input.taxId = String(body.taxId).replace(/[^0-9]/g, "").slice(0, 13);
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
