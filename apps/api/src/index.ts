import cors from "cors";
import express from "express";

// Detect local vs cloud mode
const isLocalMode = !process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("file:") || process.env.DATABASE_URL.includes("placeholder");

import {
  getBranches, getCustomers, addCustomer, updateCustomer,
  getMenu, addMenuItem, updateMenuItem,
  getIngredients, addIngredient, updateIngredient,
  getInventoryItems, adjustStock, getStockMovements,
  getRecipes, getRecipe, setRecipe,
  getOrders, getOrder, createOrder, updateOrderStatus,
  openShift, closeShift, getCurrentShift, getShifts,
  authenticatePin, getUsers, addUser, updateUser, deleteUser,
  getSalesSummary, getProfitReport, getStaffPerformance,
  createPurchase, getPurchases,
  getIntegrationStatus, getIntegrationEvents, retryIntegrationEvent
} from "./store/index.js";

const app = express();
const PORT = Number(process.env.PORT ?? 5175);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* ─── Helpers ─── */
function parseId(raw: string | number | undefined) { const id = Number(raw); return Number.isFinite(id) ? id : null; }
function isStr(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function parseMoney(v: unknown) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; }

/* ─── Local Mode Init ─── */
if (isLocalMode) {
  import("./db.js").then(() => import("./db-migrate.js")).then(({ runMigrations }) => {
    runMigrations();
    import("./backup.js").then(({ startAutoBackup }) => startAutoBackup());
  }).catch(err => console.error("[Local Init Error]", err));
} else {
  console.log("[DB] Cloud mode — using Neon PostgreSQL");
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

import { requireAuth, requireAdmin, generateToken } from "./middleware/auth.js";

/* ─── Auth ─── */
app.post("/api/auth/pin", async (req, res) => {
  const pin = String(req.body?.pin ?? "").trim();
  if (!pin) return res.status(400).json({ error: "กรุณาใส่ PIN" });
  const user = await authenticatePin(pin);
  if (!user) return res.status(401).json({ error: "PIN ไม่ถูกต้อง" });
  
  const token = generateToken(user);
  return res.json({ user, token });
});

/* ─── Protect All Routes Below ─── */
app.use("/api", requireAuth);

/* ─── Users ─── */
app.get("/api/users", async (_req, res) => res.json({ items: await getUsers() }));

app.post("/api/users", async (req, res) => {
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const pin = isStr(req.body?.pin) ? req.body.pin.trim() : "";
  const role = req.body?.role || "cashier";
  const branchId = parseId(req.body?.branchId);
  if (!name || !pin) return res.status(400).json({ error: "กรุณากรอกชื่อและ PIN" });
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: "PIN ต้องเป็นตัวเลข 4 หลัก" });
  if (!["admin", "manager", "cashier"].includes(role)) return res.status(400).json({ error: "Role ไม่ถูกต้อง" });
  try { return res.status(201).json({ user: await addUser({ name, pin, role: role as "admin"|"manager"|"cashier", branchId: branchId ?? undefined }) }); }
  catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.put("/api/users/:id", async (req, res) => {
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
    return res.json({ user });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

app.delete("/api/users/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const user = await deleteUser(id);
  return res.json({ user });
});

/* ─── Branches ─── */
app.get("/api/branches", async (_req, res) => res.json({ items: await getBranches() }));

/* ─── Customers ─── */
app.get("/api/customers", async (req, res) => {
  const search = isStr(req.query.search) ? String(req.query.search).trim() : undefined;
  res.json({ items: await getCustomers(search) });
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
    const c = await updateCustomer(id, { name: req.body?.name?.trim(), phone: req.body?.phone?.trim() });
    if (!c) return res.status(404).json({ error: "ไม่พบสมาชิก" });
    return res.json({ customer: c });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

/* ─── Menu ─── */
app.get("/api/menu", async (_req, res) => res.json({ items: await getMenu() }));
app.post("/api/menu", async (req, res) => {
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const category = isStr(req.body?.category) ? req.body.category.trim() : "";
  const basePrice = parseMoney(req.body?.basePrice);
  if (!name || !category || basePrice === null) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const item = await addMenuItem({ name, category, basePrice, sku: req.body?.sku?.trim(), barcode: req.body?.barcode?.trim(), cost: parseMoney(req.body?.cost) ?? undefined, branchType: req.body?.branchType });
  return res.status(201).json({ item });
});
app.put("/api/menu/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const item = await updateMenuItem(id, {
    name: req.body?.name?.trim(), category: req.body?.category?.trim(),
    basePrice: req.body?.basePrice !== undefined ? parseMoney(req.body.basePrice) ?? undefined : undefined,
    active: req.body?.active, sku: req.body?.sku?.trim(), barcode: req.body?.barcode?.trim(),
    cost: req.body?.cost !== undefined ? parseMoney(req.body.cost) ?? undefined : undefined
  });
  if (!item) return res.status(404).json({ error: "ไม่พบสินค้า" });
  return res.json({ item });
});

/* ─── Ingredients & Inventory ─── */
app.get("/api/ingredients", async (_req, res) => res.json({ items: await getIngredients() }));
app.post("/api/ingredients", async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  const name = isStr(req.body?.name) ? req.body.name.trim() : "";
  const unit = isStr(req.body?.unit) ? req.body.unit.trim() : "";
  const costPerUnit = parseMoney(req.body?.costPerUnit);
  if (!name || !unit || costPerUnit === null) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const ingredient = await addIngredient({ name, unit, costPerUnit, stockQty: Number(req.body?.stockQty) || 0, reorderLevel: Number(req.body?.reorderLevel) || 0, branchId });
  return res.status(201).json({ ingredient });
});
app.put("/api/ingredients/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const ingredient = await updateIngredient(id, { name: req.body?.name?.trim(), unit: req.body?.unit?.trim(), costPerUnit: req.body?.costPerUnit !== undefined ? parseMoney(req.body.costPerUnit) ?? undefined : undefined });
  if (!ingredient) return res.status(404).json({ error: "ไม่พบวัตถุดิบ" });
  return res.json({ ingredient });
});
app.get("/api/inventory", async (req, res) => {
  const branchId = parseId(req.query.branchId as string);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  res.json({ items: await getInventoryItems(branchId) });
});
app.post("/api/stock-adjustments", async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  const ingredientId = parseId(req.body?.ingredientId);
  const qty = Number(req.body?.qty);
  if (branchId === null || ingredientId === null || !Number.isFinite(qty) || qty === 0) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const result = await adjustStock({ branchId, ingredientId, qty, reason: req.body?.reason?.trim() || "ADJUSTMENT" });
  const items = await getInventoryItems(branchId);
  const inventoryItem = items.find((item: any) => item.ingredientId === ingredientId) ?? null;
  return res.status(201).json({ inventoryItem, movement: result.movement });
});
app.get("/api/stock-movements", async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  res.json({ items: await getStockMovements(branchId) });
});

/* ─── Recipes ─── */
app.get("/api/recipes", async (_req, res) => res.json({ items: await getRecipes() }));
app.get("/api/recipes/:menuItemId", async (req, res) => {
  const id = parseId(req.params.menuItemId);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const recipe = await getRecipe(id);
  if (!recipe) return res.status(404).json({ error: "ไม่พบสูตร" });
  return res.json({ recipe });
});
app.put("/api/recipes/:menuItemId", async (req, res) => {
  const id = parseId(req.params.menuItemId);
  if (id === null || !Array.isArray(req.body?.ingredients)) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  const recipe = await setRecipe({ menuItemId: id, ingredients: req.body.ingredients });
  return res.json({ recipe });
});

/* ─── Orders ─── */
app.get("/api/orders", async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  res.json({ items: await getOrders(branchId) });
});
app.get("/api/orders/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const order = await getOrder(id);
  if (!order) return res.status(404).json({ error: "ไม่พบออเดอร์" });
  return res.json({ order });
});
app.patch("/api/orders/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const order = await updateOrderStatus(id, req.body?.status ?? "PAID");
  if (!order) return res.status(404).json({ error: "ไม่พบออเดอร์" });
  return res.json({ order });
});
app.post("/api/orders", async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null || !Array.isArray(req.body?.items) || !req.body.items.length) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  try {
    const order = await createOrder({
      branchId,
      customerId: req.body.customerId ?? null,
      items: req.body.items.map((i: Record<string, unknown>) => ({
        menuItemId: Number(i.menuItemId), qty: Number(i.qty),
        modifiers: Array.isArray(i.modifiers) ? i.modifiers : [],
        note: typeof i.note === "string" ? i.note.trim() : undefined
      })),
      paymentMethod: req.body.paymentMethod ?? "CASH",
      discountType: req.body.discountType ?? null,
      discountValue: Number(req.body.discountValue) || 0,
      discounts: Array.isArray(req.body.discounts) ? req.body.discounts : undefined,
      loyaltyPointsToUse: Number(req.body.loyaltyPointsToUse) || 0,
      userId: req.body.userId ?? undefined,
      shiftId: req.body.shiftId ?? undefined
    });
    return res.status(201).json({ order });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

/* ─── Shifts ─── */
app.get("/api/shifts", async (req, res) => {
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  res.json({ items: await getShifts(branchId) });
});
app.get("/api/shifts/current", async (req, res) => {
  const branchId = parseId(req.query.branchId as string);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  const shift = await getCurrentShift(branchId);
  return res.json({ shift });
});
app.post("/api/shifts/open", async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (branchId === null) return res.status(400).json({ error: "ระบุสาขา" });
  try {
    const shift = await openShift({ branchId, userId: req.body?.userId ?? undefined, openingCash: Number(req.body?.openingCash) || 0 });
    return res.status(201).json({ shift });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});
app.post("/api/shifts/:id/close", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const shift = await closeShift(id, Number(req.body?.closingCash) || 0);
    return res.json({ shift });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

/* ─── Reports ─── */
app.get("/api/reports/summary", async (req, res) => {
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json({ summary: await getSalesSummary({ from, to, branchId }) });
});

app.get("/api/reports/profit", async (req, res) => {
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json(await getProfitReport({ from, to, branchId }));
});

app.get("/api/reports/staff", async (req, res) => {
  const from = isStr(req.query.from) ? String(req.query.from) : undefined;
  const to = isStr(req.query.to) ? String(req.query.to) : undefined;
  const branchId = parseId(req.query.branchId as string) ?? undefined;
  return res.json(await getStaffPerformance({ from, to, branchId }));
});

/* ─── Backups (local mode only) ─── */
app.get("/api/backups/status", requireAdmin, async (_req, res) => {
  if (!isLocalMode) return res.json({ status: { enabled: false, message: "Backups not available in cloud mode" } });
  const { getBackupStatus } = await import("./backup.js");
  return res.json({ status: getBackupStatus() });
});

app.get("/api/backups", requireAdmin, async (_req, res) => {
  if (!isLocalMode) return res.json({ items: [] });
  const { listDatabaseBackups } = await import("./backup.js");
  return res.json({ items: listDatabaseBackups() });
});

app.post("/api/backups", requireAdmin, async (req, res) => {
  if (!isLocalMode) return res.status(503).json({ error: "Backups not available in cloud mode" });
  try {
    const { createDatabaseBackup } = await import("./backup.js");
    const reason = isStr(req.body?.reason) ? req.body.reason.trim() : "manual";
    const backup = await createDatabaseBackup(reason);
    return res.status(201).json({ backup });
  } catch (e) {
    return res.status(409).json({ error: (e as Error).message });
  }
});

/* ─── Purchases ─── */
app.get("/api/purchases", async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  res.json({ items: await getPurchases(branchId) });
});

app.post("/api/purchases", async (req, res) => {
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
    return res.status(201).json({ purchase: po });
  } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
});

/* ─── Integrations ─── */
app.get("/api/integrations/status", requireAdmin, async (_req, res) => {
  return res.json({ items: await getIntegrationStatus() });
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
  return res.json({ event });
});

// pospos-sync is dynamically imported in local mode only (requires Playwright)

app.post("/api/migration/sync", async (req, res) => {
  const branchId = parseId(req.body?.branchId);
  if (!branchId) return res.status(400).json({ error: "กรุณาเลือกสาขาที่จะนำเข้าข้อมูล" });
  
  if (!isLocalMode) {
    return res.status(503).json({ error: "ฟีเจอร์ดึงข้อมูล POSPOS ใช้ได้เฉพาะบนเครื่อง Local เท่านั้น" });
  }
  
  try {
    const { syncPosposData } = await import("./scripts/pospos-sync.js");
    const result = await syncPosposData(branchId);
    return res.status(200).json(result);
  } catch (e) {
    console.error("Migration Sync Error:", e);
    return res.status(500).json({ error: (e as Error).message });
  }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => console.log(`🚀 Big B Coffee API on http://localhost:${PORT}`));
