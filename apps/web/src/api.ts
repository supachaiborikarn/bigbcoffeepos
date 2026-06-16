import type {
  Branch,
  BusinessDocument,
  CartItem,
  CompareReport,
  Coupon,
  Customer,
  CustomerInsights,
  CupStockSetting,
  CustomerImportInput,
  DailyCloseReport,
  Ingredient,
  HistoricalOrderImportInput,
  IntegrationEvent,
  IntegrationOutboxSummary,
  IntegrationStatus,
  ImportResult,
  InventoryLot,
  InventoryItem,
  MarketplaceConnection,
  MenuItem,
  Order,
  OrderStatus,
  PaymentMethod,
  PriceRule,
  ProductImportInput,
  ProductUnit,
  ProductVariant,
  Promotion,
  PurchaseOrder,
  PurchaseOrderItem,
  Recipe,
  RecipeCoverageReport,
  ReportSource,
  SalesSummary,
  Shift,
  ShiftCloseResult,
  ShiftSummary,
  StockMovement,
  StockCount,
  StockTransfer,
  StoreSetting,
  TaxInvoice,
  User,
  DiscountRule,
  DiscountType
} from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5175/api";
const OFFLINE_ORDER_QUEUE_KEY = "bb_pos_offline_orders";

type CreateOrderInput = {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  paymentDetails?: {
    cashReceived?: number;
    paymentConfirmed?: boolean;
    referenceNo?: string;
  };
  idempotencyKey?: string;
  discountType: DiscountType;
  discountValue: number;
  discounts?: DiscountRule[];
  branchId: number;
  customerId: number | null;
  loyaltyPointsToUse: number;
  userId?: number;
  shiftId?: number;
};
type OfflineOrderInput = CreateOrderInput;

function getOfflineQueue(): OfflineOrderInput[] {
  try {
    const raw = localStorage.getItem(OFFLINE_ORDER_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setOfflineQueue(items: OfflineOrderInput[]) {
  localStorage.setItem(OFFLINE_ORDER_QUEUE_KEY, JSON.stringify(items));
}

function isOfflineCheckoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return navigator.onLine === false || /Failed to fetch|NetworkError|Load failed|internet|อินเทอร์เน็ต/i.test(message);
}

function queueOfflineOrder(input: OfflineOrderInput): Order {
  const queue = getOfflineQueue();
  queue.push(input);
  setOfflineQueue(queue);
  const now = new Date().toISOString();
  return {
    id: -Date.now(),
    branchId: input.branchId,
    customerId: input.customerId,
    userId: input.userId ?? null,
    shiftId: input.shiftId ?? null,
    createdAt: now,
    status: "PAID",
    subtotal: input.items.reduce((sum, item) => sum + ((item.basePrice + item.modifiers.reduce((s, mod) => s + mod.price, 0)) * item.qty), 0),
    discountType: input.discountType,
    discountValue: input.discountValue,
    discountAmount: 0,
    loyaltyPointsUsed: input.loyaltyPointsToUse,
    loyaltyPointsEarned: 0,
    tax: 0,
    total: input.items.reduce((sum, item) => sum + ((item.basePrice + item.modifiers.reduce((s, mod) => s + mod.price, 0)) * item.qty), 0),
    paymentMethod: input.paymentMethod,
    items: input.items.map((item, index) => ({
      id: index + 1,
      menuItemId: item.menuItemId,
      name: item.name,
      qty: item.qty,
      basePrice: item.basePrice,
      modifiers: item.modifiers,
      lineTotal: (item.basePrice + item.modifiers.reduce((sum, mod) => sum + mod.price, 0)) * item.qty,
      note: item.note
    }))
  };
}

export async function flushOfflineOrders() {
  const queue = getOfflineQueue();
  if (!queue.length) return { sent: 0, remaining: 0 };
  const remaining: OfflineOrderInput[] = [];
  let sent = 0;
  for (const item of queue) {
    try {
      await createOrderOnline(item);
      sent += 1;
    } catch {
      remaining.push(item);
    }
  }
  setOfflineQueue(remaining);
  return { sent, remaining: remaining.length };
}

type FetchJsonInit = RequestInit & { timeoutMs?: number };

async function fetchJson<T>(input: RequestInfo, init?: FetchJsonInit): Promise<T> {
  const token = localStorage.getItem("bb_pos_token");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const { timeoutMs, ...fetchInit } = init ?? {};
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(input, {
      ...fetchInit,
      headers: { ...headers, ...fetchInit.headers },
      signal: controller?.signal ?? fetchInit.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.error === "string" ? payload.error : "Request failed";
      throw new Error(message);
    }
    return payload as T;
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error("บันทึกออเดอร์นานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดรับเงินอีกครั้ง ระบบจะกันออเดอร์ซ้ำให้");
    }
    throw error;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

export async function getBranches() {
  const payload = await fetchJson<{ items: Branch[] }>(`${API_URL}/branches`);
  return payload.items;
}

export async function getUsers() {
  const payload = await fetchJson<{ items: User[] }>(`${API_URL}/users`);
  return payload.items;
}

export async function addUser(data: { name: string; pin: string; role: string; branchId?: number }) {
  const payload = await fetchJson<{ user: User }>(`${API_URL}/users`, {
    method: "POST",
    body: JSON.stringify(data)
  });
  return payload.user;
}

export async function updateUser(id: number, data: { name?: string; pin?: string; role?: string; branchId?: number | null; active?: boolean }) {
  const payload = await fetchJson<{ user: User }>(`${API_URL}/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
  return payload.user;
}

export async function deleteUser(id: number) {
  const payload = await fetchJson<{ user: User }>(`${API_URL}/users/${id}`, {
    method: "DELETE"
  });
  return payload.user;
}

export async function getCustomers(search?: string) {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  const payload = await fetchJson<{ items: Customer[] }>(`${API_URL}/customers?${query.toString()}`);
  return payload.items;
}

export async function getCustomerInsights(params: { inactiveDays?: number; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.inactiveDays) query.set("inactiveDays", String(params.inactiveDays));
  if (params.limit) query.set("limit", String(params.limit));
  const payload = await fetchJson<{ insights: CustomerInsights }>(`${API_URL}/customers/insights?${query.toString()}`);
  return payload.insights;
}

export async function createCustomer(input: { name: string; phone: string }) {
  const payload = await fetchJson<{ customer: Customer }>(`${API_URL}/customers`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.customer;
}

export async function updateCustomer(id: number, input: Omit<Partial<Customer>, "tags" | "metadata"> & { tags?: string[]; metadata?: Record<string, unknown> }) {
  const payload = await fetchJson<{ customer: Customer }>(`${API_URL}/customers/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
  return payload.customer;
}

export async function getMenu() {
  const payload = await fetchJson<{ items: MenuItem[] }>(`${API_URL}/menu`);
  return payload.items;
}

export async function createMenuItem(input: {
  name: string;
  category: string;
  basePrice: number;
  sku?: string;
  barcode?: string;
  cost?: number;
  imageUrl?: string;
  unit?: string;
  taxRate?: number;
  optionGroup?: string;
  optionLabel?: string;
  branchType?: MenuItem["branchType"];
}) {
  const payload = await fetchJson<{ item: MenuItem }>(`${API_URL}/menu`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.item;
}

export async function updateMenuItem(
  id: number,
  input: Partial<{
    name: string;
    category: string;
    basePrice: number;
    active: boolean;
    sku: string;
    barcode: string;
    cost: number | null;
    imageUrl: string | null;
    unit: string | null;
    taxRate: number | null;
    optionGroup: string | null;
    optionLabel: string | null;
    branchType: MenuItem["branchType"];
  }>
) {
  const payload = await fetchJson<{ item: MenuItem }>(`${API_URL}/menu/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
  return payload.item;
}

export async function deactivateMenuItem(id: number) {
  const payload = await fetchJson<{ item: MenuItem }>(`${API_URL}/menu/${id}`, {
    method: "DELETE"
  });
  return payload.item;
}

export async function restoreMenuItem(id: number) {
  const payload = await fetchJson<{ item: MenuItem }>(`${API_URL}/menu/${id}/restore`, {
    method: "POST"
  });
  return payload.item;
}

export async function setMenuGroupActive(input: {
  optionGroup: string;
  category: string;
  branchType: MenuItem["branchType"];
  active: boolean;
}) {
  const payload = await fetchJson<{ items: MenuItem[] }>(`${API_URL}/menu/groups/status`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
  return payload.items;
}

export async function getIngredients() {
  const payload = await fetchJson<{ items: Ingredient[] }>(`${API_URL}/ingredients`);
  return payload.items;
}

export async function getInventory(branchId: number) {
  const payload = await fetchJson<{ items: InventoryItem[] }>(`${API_URL}/inventory?branchId=${branchId}`);
  return payload.items;
}

export async function updateInventoryItem(
  ingredientId: number,
  input: Partial<{
    branchId: number;
    name: string;
    unit: string;
    costPerUnit: number;
    stockQty: number;
    reorderLevel: number;
  }>
) {
  const payload = await fetchJson<{ item: InventoryItem }>(`${API_URL}/inventory/${ingredientId}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
  return payload.item;
}

export async function createIngredient(input: {
  name: string;
  unit: string;
  costPerUnit: number;
  stockQty: number;
  reorderLevel: number;
  branchId: number;
}) {
  const payload = await fetchJson<{ ingredient: Ingredient }>(`${API_URL}/ingredients`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.ingredient;
}

export async function updateIngredient(
  id: number,
  input: Partial<{ name: string; unit: string; costPerUnit: number }>
) {
  const payload = await fetchJson<{ ingredient: Ingredient }>(`${API_URL}/ingredients/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
  return payload.ingredient;
}

export async function createStockAdjustment(input: {
  branchId: number;
  ingredientId: number;
  qty: number;
  reason: string;
}) {
  const payload = await fetchJson<{ inventoryItem: InventoryItem | null; movement: StockMovement }>(
    `${API_URL}/stock-adjustments`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
  return payload;
}

export async function getStockMovements(branchId: number) {
  const payload = await fetchJson<{ items: StockMovement[] }>(
    `${API_URL}/stock-movements?branchId=${branchId}`
  );
  return payload.items;
}

export async function getRecipes() {
  const payload = await fetchJson<{ items: Recipe[] }>(`${API_URL}/recipes`);
  return payload.items;
}

export async function getRecipeCoverage(params: { branchId?: number; from?: string; to?: string }) {
  const query = new URLSearchParams();
  if (params.branchId) query.set("branchId", String(params.branchId));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const payload = await fetchJson<{ report: RecipeCoverageReport }>(`${API_URL}/recipes/coverage?${query.toString()}`);
  return payload.report;
}

export async function getRecipe(menuItemId: number) {
  const payload = await fetchJson<{ recipe: Recipe }>(`${API_URL}/recipes/${menuItemId}`);
  return payload.recipe;
}

export async function updateRecipe(menuItemId: number, ingredients: Recipe["ingredients"]) {
  const payload = await fetchJson<{ recipe: Recipe }>(`${API_URL}/recipes/${menuItemId}`, {
    method: "PUT",
    body: JSON.stringify({ ingredients })
  });
  return payload.recipe;
}

export async function getCupStockSettings(branchId: number) {
  const payload = await fetchJson<{ settings: CupStockSetting[] }>(
    `${API_URL}/cup-stock-settings?branchId=${branchId}`
  );
  return payload.settings;
}

export async function updateCupStockSettings(branchId: number, settings: Pick<CupStockSetting, "cupOption" | "deductStock" | "items">[]) {
  const payload = await fetchJson<{ settings: CupStockSetting[] }>(
    `${API_URL}/cup-stock-settings?branchId=${branchId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        settings: settings.map((setting) => ({
          cupOption: setting.cupOption,
          deductStock: setting.deductStock,
          items: setting.items.map((item) => ({
            ingredientId: item.ingredientId,
            qty: item.qty
          }))
        }))
      })
    }
  );
  return payload.settings;
}

export async function getOrders(branchId: number) {
  const payload = await fetchJson<{ items: Order[] }>(`${API_URL}/orders?branchId=${branchId}`);
  return payload.items;
}

export async function getOrderByIdempotencyKey(idempotencyKey: string) {
  const payload = await fetchJson<{ order: Order }>(
    `${API_URL}/orders/idempotency/${encodeURIComponent(idempotencyKey)}`,
    { timeoutMs: 5_000 }
  );
  return payload.order;
}

async function createOrderOnline(input: CreateOrderInput) {
  const payload = await fetchJson<{ order: Order }>(`${API_URL}/orders`, {
    method: "POST",
    timeoutMs: 15_000,
    body: JSON.stringify({
      items: input.items.map((item) => ({
        menuItemId: item.menuItemId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        modifiers: item.modifiers,
        note: item.note
      })),
      paymentMethod: input.paymentMethod,
      paymentDetails: input.paymentDetails,
      idempotencyKey: input.idempotencyKey,
      discountType: input.discountType,
      discountValue: input.discountValue,
      discounts: input.discounts,
      branchId: input.branchId,
      customerId: input.customerId,
      loyaltyPointsToUse: input.loyaltyPointsToUse,
      userId: input.userId,
      shiftId: input.shiftId
    })
  });
  return payload.order;
}

export async function createOrder(input: OfflineOrderInput) {
  try {
    return await createOrderOnline(input);
  } catch (error) {
    if (!isOfflineCheckoutError(error)) throw error;
    return queueOfflineOrder(input);
  }
}

export async function updateOrderStatus(id: number, status: OrderStatus) {
  const payload = await fetchJson<{ order: Order }>(`${API_URL}/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  return payload.order;
}

export async function getSalesSummary(params: { from?: string; to?: string; branchId?: number; source?: ReportSource }) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.branchId) query.set("branchId", String(params.branchId));
  if (params.source) query.set("source", params.source);
  const payload = await fetchJson<{ summary: SalesSummary }>(`${API_URL}/reports/summary?${query.toString()}`);
  return payload.summary;
}

export async function getDailyCloseReport(params: { date?: string; branchId?: number; source?: ReportSource }) {
  const query = new URLSearchParams();
  if (params.date) query.set("date", params.date);
  if (params.branchId) query.set("branchId", String(params.branchId));
  if (params.source) query.set("source", params.source);
  const payload = await fetchJson<{ report: DailyCloseReport }>(`${API_URL}/reports/day-close?${query.toString()}`);
  return payload.report;
}

export function getOrdersCsvUrl(params: { from?: string; to?: string; branchId?: number; source?: ReportSource }) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.branchId) query.set("branchId", String(params.branchId));
  if (params.source) query.set("source", params.source);
  return `${API_URL}/reports/orders.csv?${query.toString()}`;
}

export async function importProducts(branchId: number, items: ProductImportInput[]) {
  const payload = await fetchJson<{ result: ImportResult }>(`${API_URL}/import/products`, {
    method: "POST",
    body: JSON.stringify({ branchId, items })
  });
  return payload.result;
}

export async function importCustomers(items: CustomerImportInput[]) {
  const payload = await fetchJson<{ result: ImportResult }>(`${API_URL}/import/customers`, {
    method: "POST",
    body: JSON.stringify({ items })
  });
  return payload.result;
}

export async function importHistoricalOrders(branchId: number, items: HistoricalOrderImportInput[]) {
  const payload = await fetchJson<{ result: ImportResult }>(`${API_URL}/import/orders`, {
    method: "POST",
    body: JSON.stringify({ branchId, items })
  });
  return payload.result;
}

/* ─── Auth ─── */
export async function loginWithPin(pin: string) {
  const payload = await fetchJson<{ user: User; token: string }>(`${API_URL}/auth/pin`, {
    method: "POST",
    body: JSON.stringify({ pin })
  });
  return payload;
}

/* ─── Shifts ─── */
export async function getCurrentShift(branchId: number) {
  const payload = await fetchJson<{ shift: Shift | null }>(`${API_URL}/shifts/current?branchId=${branchId}`);
  return payload.shift;
}

export async function openShift(input: { branchId: number; userId?: number; openingCash: number }) {
  const payload = await fetchJson<{ shift: Shift }>(`${API_URL}/shifts/open`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.shift;
}

export async function closeShift(shiftId: number, closingCash: number, details?: { cashCounts?: Record<string, number>; note?: string }) {
  const payload = await fetchJson<ShiftCloseResult>(`${API_URL}/shifts/${shiftId}/close`, {
    method: "POST",
    body: JSON.stringify({ closingCash, ...details })
  });
  return payload;
}

export async function getShiftSummary(shiftId: number) {
  const payload = await fetchJson<{ summary: ShiftSummary }>(`${API_URL}/shifts/${shiftId}/summary`);
  return payload.summary;
}

export async function getShifts(branchId: number) {
  const payload = await fetchJson<{ items: Shift[] }>(`${API_URL}/shifts?branchId=${branchId}`);
  return payload.items;
}

/* ─── Migration ─── */
export async function syncPosposMigration(branchId: number) {
  return fetchJson<{ success?: boolean; menuItems?: number; ingredients?: number; customers?: number; sales?: number; message?: string }>(`${API_URL}/migration/sync`, {
    method: "POST",
    body: JSON.stringify({ branchId })
  });
}

/* ─── Purchases ─── */
export async function getPurchases(branchId?: number) {
  const query = new URLSearchParams();
  if (branchId) query.set("branchId", String(branchId));
  const payload = await fetchJson<{ items: PurchaseOrder[] }>(`${API_URL}/purchases?${query.toString()}`);
  return payload.items;
}

export async function createPurchase(input: {
  branchId: number;
  supplier: string;
  note: string;
  items: PurchaseOrderItem[];
}) {
  const payload = await fetchJson<{ purchase: PurchaseOrder }>(`${API_URL}/purchases`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.purchase;
}

export async function approvePurchase(id: number) {
  const payload = await fetchJson<{ purchase: PurchaseOrder }>(`${API_URL}/purchases/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return payload.purchase;
}

export async function getTaxInvoices(branchId?: number) {
  const query = new URLSearchParams();
  if (branchId) query.set("branchId", String(branchId));
  const payload = await fetchJson<{ items: TaxInvoice[] }>(`${API_URL}/tax-invoices?${query.toString()}`);
  return payload.items;
}

export async function createTaxInvoice(input: { orderId: number; buyerName: string; buyerTaxId?: string; buyerAddress?: string; buyerBranch?: string }) {
  const payload = await fetchJson<{ invoice: TaxInvoice }>(`${API_URL}/tax-invoices`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.invoice;
}

export async function getStockCounts(branchId?: number) {
  const query = new URLSearchParams();
  if (branchId) query.set("branchId", String(branchId));
  const payload = await fetchJson<{ items: StockCount[] }>(`${API_URL}/stock-counts?${query.toString()}`);
  return payload.items;
}

export async function createStockCount(input: { branchId: number; note?: string; items: { ingredientId: number; countedQty: number }[] }) {
  const payload = await fetchJson<{ stockCount: StockCount }>(`${API_URL}/stock-counts`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.stockCount;
}

export async function postStockCount(id: number) {
  const payload = await fetchJson<{ stockCount: StockCount }>(`${API_URL}/stock-counts/${id}/post`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return payload.stockCount;
}

export async function getStockTransfers(branchId?: number) {
  const query = new URLSearchParams();
  if (branchId) query.set("branchId", String(branchId));
  const payload = await fetchJson<{ items: StockTransfer[] }>(`${API_URL}/stock-transfers?${query.toString()}`);
  return payload.items;
}

export async function createStockTransfer(input: { fromBranchId: number; toBranchId: number; note?: string; items: { ingredientId: number; qty: number }[] }) {
  const payload = await fetchJson<{ transfer: StockTransfer }>(`${API_URL}/stock-transfers`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.transfer;
}

export async function receiveStockTransfer(id: number) {
  const payload = await fetchJson<{ transfer: StockTransfer }>(`${API_URL}/stock-transfers/${id}/receive`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return payload.transfer;
}

export async function getProductUnits(menuItemId?: number) {
  const query = new URLSearchParams();
  if (menuItemId) query.set("menuItemId", String(menuItemId));
  const payload = await fetchJson<{ items: ProductUnit[] }>(`${API_URL}/product-units?${query.toString()}`);
  return payload.items;
}

export async function createProductUnit(input: { menuItemId: number; unitName: string; factor: number; price?: number | null; barcode?: string }) {
  const payload = await fetchJson<{ item: ProductUnit }>(`${API_URL}/product-units`, { method: "POST", body: JSON.stringify(input) });
  return payload.item;
}

export async function getPriceRules() {
  const payload = await fetchJson<{ items: PriceRule[] }>(`${API_URL}/price-rules`);
  return payload.items;
}

export async function createPriceRule(input: { menuItemId?: number | null; customerTier?: string; minQty?: number; price: number }) {
  const payload = await fetchJson<{ item: PriceRule }>(`${API_URL}/price-rules`, { method: "POST", body: JSON.stringify(input) });
  return payload.item;
}

export async function getInventoryLots(branchId?: number, days = 30) {
  const query = new URLSearchParams();
  if (branchId) query.set("branchId", String(branchId));
  query.set("days", String(days));
  const payload = await fetchJson<{ items: InventoryLot[] }>(`${API_URL}/inventory-lots?${query.toString()}`);
  return payload.items;
}

export async function createInventoryLot(input: { branchId: number; ingredientId: number; lotNo?: string; qty: number; expiryDate?: string }) {
  const payload = await fetchJson<{ item: InventoryLot }>(`${API_URL}/inventory-lots`, { method: "POST", body: JSON.stringify(input) });
  return payload.item;
}

export async function getProductVariants(menuItemId?: number) {
  const query = new URLSearchParams();
  if (menuItemId) query.set("menuItemId", String(menuItemId));
  const payload = await fetchJson<{ items: ProductVariant[] }>(`${API_URL}/product-variants?${query.toString()}`);
  return payload.items;
}

export async function createProductVariant(input: { menuItemId: number; optionName: string; optionValue: string; priceDelta?: number; sku?: string; barcode?: string }) {
  const payload = await fetchJson<{ item: ProductVariant }>(`${API_URL}/product-variants`, { method: "POST", body: JSON.stringify(input) });
  return payload.item;
}

export async function getPromotions() {
  const payload = await fetchJson<{ items: Promotion[] }>(`${API_URL}/promotions`);
  return payload.items;
}

export async function createPromotion(input: { name: string; type: string; value: number; category?: string; startAt?: string; endAt?: string; active?: boolean }) {
  const payload = await fetchJson<{ item: Promotion }>(`${API_URL}/promotions`, { method: "POST", body: JSON.stringify(input) });
  return payload.item;
}

export async function getCoupons() {
  const payload = await fetchJson<{ items: Coupon[] }>(`${API_URL}/coupons`);
  return payload.items;
}

export async function createCoupon(input: { code: string; type: string; value: number; maxUses?: number | null; expiresAt?: string; active?: boolean }) {
  const payload = await fetchJson<{ item: Coupon }>(`${API_URL}/coupons`, { method: "POST", body: JSON.stringify(input) });
  return payload.item;
}

export async function getBusinessDocuments(branchId?: number) {
  const query = new URLSearchParams();
  if (branchId) query.set("branchId", String(branchId));
  const payload = await fetchJson<{ items: BusinessDocument[] }>(`${API_URL}/business-documents?${query.toString()}`);
  return payload.items;
}

export async function createBusinessDocument(input: { branchId: number; type: string; customerName?: string; total?: number; payload?: Record<string, unknown> }) {
  const payload = await fetchJson<{ item: BusinessDocument }>(`${API_URL}/business-documents`, { method: "POST", body: JSON.stringify(input) });
  return payload.item;
}

export function getTaxExportUrl(params: { from?: string; to?: string; branchId?: number }) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.branchId) query.set("branchId", String(params.branchId));
  return `${API_URL}/reports/tax-export.xls?${query.toString()}`;
}

export async function getCompareReport(params: { fromA: string; toA: string; fromB: string; toB: string; branchIdA?: number; branchIdB?: number }) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const payload = await fetchJson<{ report: CompareReport }>(`${API_URL}/reports/compare?${query.toString()}`);
  return payload.report;
}

export async function saveDailyEmailSetting(input: { branchId?: number | null; recipients: string; sendTime?: string; enabled?: boolean }) {
  const payload = await fetchJson<{ setting: unknown }>(`${API_URL}/daily-email-setting`, { method: "PUT", body: JSON.stringify(input) });
  return payload.setting;
}

export async function enqueueDailySummaryEmail(input: { date: string; branchId?: number }) {
  const payload = await fetchJson<{ event: IntegrationEvent }>(`${API_URL}/daily-email/enqueue`, { method: "POST", body: JSON.stringify(input) });
  return payload.event;
}

export async function getCustomerDisplay(branchId: number) {
  const payload = await fetchJson<{ display: { orderId: number; total: number; status: string; items: Array<{ name: string; qty: number; lineTotal: number }>; createdAt: string } | null }>(`${API_URL}/customer-display?branchId=${branchId}`);
  return payload.display;
}

export async function getMarketplaces(branchId?: number) {
  const query = new URLSearchParams();
  if (branchId) query.set("branchId", String(branchId));
  const payload = await fetchJson<{ items: MarketplaceConnection[] }>(`${API_URL}/marketplaces?${query.toString()}`);
  return payload.items;
}

export async function saveMarketplace(input: { branchId: number; provider: string; shopName?: string; config?: Record<string, unknown> }) {
  const payload = await fetchJson<{ item: MarketplaceConnection }>(`${API_URL}/marketplaces`, { method: "PUT", body: JSON.stringify(input) });
  return payload.item;
}

export async function syncMarketplace(id: number) {
  const payload = await fetchJson<{ event: IntegrationEvent }>(`${API_URL}/marketplaces/${id}/sync`, { method: "POST", body: JSON.stringify({}) });
  return payload.event;
}

/* ─── Store Settings ─── */
export async function getStoreSetting(branchId: number) {
  const payload = await fetchJson<{ settings: StoreSetting }>(`${API_URL}/settings/store?branchId=${branchId}`);
  return payload.settings;
}

export async function updateStoreSetting(branchId: number, input: Partial<Omit<StoreSetting, "branchId">>) {
  const payload = await fetchJson<{ settings: StoreSetting }>(`${API_URL}/settings/store`, {
    method: "PUT",
    body: JSON.stringify({ branchId, ...input })
  });
  return payload.settings;
}

/* ─── Integrations ─── */
export async function getIntegrationStatus() {
  const payload = await fetchJson<{ items: IntegrationStatus[] }>(`${API_URL}/integrations/status`);
  return payload.items;
}

export async function getIntegrationOutboxSummary() {
  const payload = await fetchJson<{ summary: IntegrationOutboxSummary }>(`${API_URL}/integrations/summary`);
  return payload.summary;
}

export async function getIntegrationEvents(limit = 30) {
  const payload = await fetchJson<{ items: IntegrationEvent[] }>(`${API_URL}/integrations/events?limit=${limit}`);
  return payload.items;
}

export async function retryIntegrationEvent(id: number) {
  const payload = await fetchJson<{ event: IntegrationEvent }>(`${API_URL}/integrations/events/${id}/retry`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return payload.event;
}

export async function processIntegrationOutbox() {
  const payload = await fetchJson<{ result: { processed: number; sent: number; retried: number; skipped: number; failed: number; total: number; remainingPending: number; remainingFailed: number } }>(`${API_URL}/integrations/process`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return payload.result;
}
