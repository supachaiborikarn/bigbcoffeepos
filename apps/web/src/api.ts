import type {
  Branch,
  BusinessDocument,
  CartItem,
  CompareReport,
  Coupon,
  Customer,
  CustomerInsights,
  CupStockSetting,
  CashEntry,
  TimeEntry,
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
  PosposBranchSyncStatus,
  PosposSyncJob,
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
  InventoryDocument,
  InventoryDocumentKind,
  StockLedgerMovement,
  StockLedgerKind,
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
  couponCode?: string;
  skipPromotions?: boolean;
  discountApprovalToken?: string;
  branchId: number;
  customerId: number | null;
  loyaltyPointsToUse: number;
  userId?: number;
  shiftId?: number;
};
type OfflineOrderInput = CreateOrderInput & { offlineQueueId?: string; queuedAt?: string; lastSyncError?: string };

function makeOfflineId() { return globalThis.crypto.randomUUID(); }

const OFFLINE_FAILED_KEY = "bb_pos_offline_failed";
type FailedOfflineOrder = { input: OfflineOrderInput; error: string; failedAt: string };
function currentOfflineScope() {
  try {
    const user = JSON.parse(localStorage.getItem("bb_pos_user") || "null");
    return user ? { userId: user.id, branchId: Number(localStorage.getItem(`bb_pos_branch_id:${user.id}`) || user.branchId) } : null;
  } catch { return null; }
}
function belongsToScope(input: OfflineOrderInput, scope = currentOfflineScope()) { return !!scope && input.branchId === scope.branchId && input.userId === scope.userId; }


export function getOfflinePendingCount(): number {
  return getOfflinePendingDetails().length;
}

export function getOfflinePendingDetails(): OfflineOrderInput[] {
  return getOfflineQueue().filter((item) => belongsToScope(item));
}

function getOfflineFailed(): FailedOfflineOrder[] {
  try {
    const raw = localStorage.getItem(OFFLINE_FAILED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setOfflineFailed(items: FailedOfflineOrder[]) {
  localStorage.setItem(OFFLINE_FAILED_KEY, JSON.stringify(items));
}

export function getOfflineFailedCount(): number {
  return getOfflineFailed().filter((item) => belongsToScope(item.input)).length;
}

export function getOfflineFailedDetails(): FailedOfflineOrder[] {
  return getOfflineFailed().filter((item) => belongsToScope(item.input));
}

export function discardFailedOfflineOrders() {
  setOfflineFailed(getOfflineFailed().filter((item) => !belongsToScope(item.input)));
}

/** Move server-rejected offline orders back into the queue to retry (e.g. after reopening a shift). */
export async function retryFailedOfflineOrders() {
  const failed = getOfflineFailedDetails();
  if (!failed.length) return { sent: 0, remaining: getOfflinePendingCount(), failed: 0 };
  setOfflineQueue([...getOfflineQueue(), ...failed.map((f) => f.input)]);
  discardFailedOfflineOrders();
  return flushOfflineOrders();
}

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
  if (error instanceof ApiError || error instanceof RequestTimeoutError || error instanceof OrderConfirmationError ||
      (error instanceof Error && error.name === "AbortError")) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /^(Failed to fetch|fetch failed|NetworkError|Network request failed|Load failed)\b/i.test(message);
}

function canRetryOfflineSync(error: unknown) {
  return isOfflineCheckoutError(error) || error instanceof RequestTimeoutError || error instanceof OrderConfirmationError ||
    (error instanceof ApiError && (error.status === 408 || error.status === 429 || error.status >= 500 ||
      error.code === "ORDER_RETRY_REQUIRED" || error.message.startsWith("ระบบบันทึกใช้เวลานานเกินไป")));
}

function queueOfflineOrder(input: OfflineOrderInput): Order {
  const queue = getOfflineQueue();
  const now = new Date().toISOString();
  queue.push({ ...input, offlineQueueId: makeOfflineId(), queuedAt: now });
  setOfflineQueue(queue);
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

let offlineFlush: Promise<{ sent: number; remaining: number; failed: number }> | null = null;
export function flushOfflineOrders() {
  if (!offlineFlush) offlineFlush = flushScopedOfflineOrders().finally(() => { offlineFlush = null; });
  return offlineFlush;
}
async function flushScopedOfflineOrders() {
  const scope = currentOfflineScope();
  // Give legacy bills stable identities before any request; other users' bills stay untouched.
  const all = getOfflineQueue().map((item) => belongsToScope(item, scope) ? {
    ...item, offlineQueueId: item.offlineQueueId || makeOfflineId(), idempotencyKey: item.idempotencyKey || `offline-${makeOfflineId()}`
  } : item);
  const queue = all.filter((item) => belongsToScope(item, scope));
  if (!queue.length) return { sent: 0, remaining: 0, failed: getOfflineFailedCount() };
  setOfflineQueue(all);
  const remaining: OfflineOrderInput[] = [];
  const newlyFailed: FailedOfflineOrder[] = [];
  let sent = 0;
  for (const item of queue) {
    const current = currentOfflineScope();
    if (current?.userId !== scope?.userId || current?.branchId !== scope?.branchId) { remaining.push(item); continue; }
    try {
      await createOrderOnline(item);
      sent += 1;
    } catch (error) {
      if (canRetryOfflineSync(error)) {
        // An unconfirmed write may already exist on the server; retain its identity.
        remaining.push({ ...item, lastSyncError: error instanceof Error ? error.message : String(error) });
      } else {
        // Server rejected (e.g. stock/shift) — move aside for manual attention, don't retry blindly.
        newlyFailed.push({ input: item, error: error instanceof Error ? error.message : String(error), failedAt: new Date().toISOString() });
      }
    }
  }
  const processed = new Set(queue.map((item) => item.offlineQueueId));
  setOfflineQueue([...getOfflineQueue().filter((item) => !processed.has(item.offlineQueueId)), ...remaining]);
  const failed = [...getOfflineFailed(), ...newlyFailed];
  setOfflineFailed(failed);
  return { sent, remaining: remaining.length, failed: failed.filter((item) => belongsToScope(item.input, scope)).length };
}

type FetchJsonInit = RequestInit & { timeoutMs?: number };

/** An error the server answered with (has an HTTP status), as opposed to a network failure. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = "ApiError"; }
}

/** A write deadline does not prove whether the server committed the request. */
export class RequestTimeoutError extends Error {
  readonly code = "REQUEST_TIMEOUT";
  constructor(message: string) { super(message); this.name = "RequestTimeoutError"; }
}

class OrderConfirmationError extends Error {
  readonly code = "ORDER_NOT_CONFIRMED";
  constructor(message = "ยังยืนยันการบันทึกบิลไม่ได้ ข้อมูลบิลยังเก็บไว้ กรุณาลองตรวจสอบอีกครั้ง") { super(message); this.name = "OrderConfirmationError"; }
}

function confirmedOrder(payload: unknown, expected: { id?: number; branchId?: number; status?: OrderStatus } = {}): Order {
  const order = (payload as { order?: Order } | null)?.order;
  if (!order || !Number.isSafeInteger(order.id) || order.id <= 0 ||
      !Number.isSafeInteger(order.branchId) || order.branchId <= 0 ||
      (expected.id !== undefined && order.id !== expected.id) ||
      (expected.branchId !== undefined && order.branchId !== expected.branchId) ||
      (expected.status !== undefined && order.status !== expected.status) ||
      !["PAID", "READY", "CANCELLED", "REFUNDED"].includes(order.status) ||
      !Array.isArray(order.items) || order.items.length === 0 ||
      !Number.isFinite(order.total) || order.total < 0) {
    throw new OrderConfirmationError();
  }
  return order;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("bb_pos_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const user = JSON.parse(localStorage.getItem("bb_pos_user") || "null");
    const branchId = user && localStorage.getItem(`bb_pos_branch_id:${user.id}`);
    if (branchId) headers["X-Branch-Id"] = branchId;
  } catch { /* No restored session. */ }
  return headers;
}

/**
 * Download a protected file (CSV / Excel export). A plain <a href> can't send
 * the Authorization header, so fetch it and hand the browser a blob instead.
 */
export async function downloadAuthedFile(url: string, filename: string) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload?.error === "string" ? payload.error : "ดาวน์โหลดไฟล์ไม่สำเร็จ");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

const GET_RETRY_DELAYS = [500, 1500];

/**
 * fetchJson, plus: a read (GET) that fails at the network level (Failed to fetch /
 * net::ERR_FAILED, e.g. a cold or overloaded server) is retried a couple of times
 * before the page sees an error. Writes are never retried here: they carry
 * idempotency keys or their own recovery.
 */
async function fetchJson<T>(input: RequestInfo, init?: FetchJsonInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchJsonOnce<T>(input, init);
    } catch (error) {
      const network = error instanceof TypeError && !(error instanceof ApiError);
      if (method !== "GET" || !network || attempt >= GET_RETRY_DELAYS.length) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, GET_RETRY_DELAYS[attempt]));
    }
  }
}

async function fetchJsonOnce<T>(input: RequestInfo, init?: FetchJsonInit): Promise<T> {
  const token = localStorage.getItem("bb_pos_token");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const target = String(input);
  if (!/\/(branches|auth\/(me|pin))$/.test(target)) {
    try {
      const user = JSON.parse(localStorage.getItem("bb_pos_user") || "null");
      const branchId = user && localStorage.getItem(`bb_pos_branch_id:${user.id}`);
      if (branchId) headers["X-Branch-Id"] = branchId;
    } catch { /* No restored session. */ }
  }
  const { timeoutMs, ...fetchInit } = init ?? {};
  const reading = (fetchInit.method ?? "GET").toUpperCase() === "GET";
  const deadline = timeoutMs ?? (reading ? 12_000 : undefined);
  const controller = deadline ? new AbortController() : null;
  let timedOut = false;
  const abortFromCaller = () => controller?.abort(fetchInit.signal?.reason);
  if (controller && fetchInit.signal) {
    if (fetchInit.signal.aborted) abortFromCaller();
    else fetchInit.signal.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeoutId = controller ? window.setTimeout(() => { timedOut = true; controller.abort(); }, deadline) : null;

  try {
    const response = await fetch(input, {
      ...fetchInit,
      headers: { ...headers, ...fetchInit.headers },
      signal: controller?.signal ?? fetchInit.signal
    });
    const payload = await response.json().catch((error) => {
      if (controller?.signal.aborted || fetchInit.signal?.aborted) throw error;
      return {};
    });
    if (!response.ok) {
      const message = typeof payload?.error === "string" ? payload.error : `คำขอไม่สำเร็จ (${response.status})`;
      throw new ApiError(message, response.status, typeof payload?.code === "string" ? payload.code : undefined);
    }
    return payload as T;
  } catch (error) {
    if (timedOut && reading) {
      throw new ApiError("โหลดข้อมูลนานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", 408, "REQUEST_TIMEOUT");
    }
    if (timedOut) {
      throw new RequestTimeoutError("บันทึกออเดอร์นานเกินไป กรุณาตรวจสอบรายการออเดอร์ก่อนกดซ้ำ ระบบจะตรวจหาบิลเดิมให้");
    }
    throw error;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    fetchInit.signal?.removeEventListener("abort", abortFromCaller);
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

export type UnassignedCustomer = Customer & { historicalBranchIds: number[] };
export async function getUnassignedCustomers() {
  const payload = await fetchJson<{ items: UnassignedCustomer[] }>(`${API_URL}/customers/unassigned`);
  return payload.items;
}

export async function assignCustomerBranch(id: number, branchId: number) {
  const payload = await fetchJson<{ customer: Customer }>(`${API_URL}/customers/${id}/branch`, {
    method: "PUT", body: JSON.stringify({ branchId })
  });
  return payload.customer;
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

export async function getIngredients(options: { receivable?: boolean } = {}) {
  const payload = await fetchJson<{ items: Ingredient[] }>(`${API_URL}/ingredients${options.receivable ? "?scope=receivable" : ""}`);
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
    barcode: string | null;
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
  barcode?: string | null;
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
  input: Partial<{ name: string; unit: string; costPerUnit: number; barcode: string | null }>
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

export async function getStockMovements(branchId: number, options: { ingredientId?: number; manualOnly?: boolean; limit?: number } = {}) {
  const query = new URLSearchParams({ branchId: String(branchId) });
  if (options.ingredientId) query.set("ingredientId", String(options.ingredientId));
  if (options.manualOnly) query.set("manual", "1");
  if (options.limit) query.set("limit", String(options.limit));
  const payload = await fetchJson<{ items: StockMovement[] }>(`${API_URL}/stock-movements?${query.toString()}`);
  return payload.items;
}

export async function getStockLedger(branchId: number, options: { ingredientId?: number; kind?: StockLedgerKind | string; from?: string; to?: string; page?: number; limit?: number; snapshotId?: number } = {}) {
  const query = new URLSearchParams({ branchId: String(branchId) });
  for (const [key, value] of Object.entries(options)) if (value !== undefined && value !== "") query.set(key, String(value));
  return fetchJson<{ items: StockLedgerMovement[]; total: number; page: number; limit: number; snapshotId: number }>(`${API_URL}/stock-ledger?${query}`);
}

export async function getInventoryDocuments(branchId: number) {
  return (await fetchJson<{ items: InventoryDocument[] }>(`${API_URL}/inventory-documents?branchId=${branchId}`)).items;
}

export async function createInventoryDocument(input: {
  branchId: number; kind: InventoryDocumentKind; fromLocation?: string; toLocation?: string; reason: string; note?: string;
  items: Array<{ ingredientId: number; qty: number }>; requestKey: string; postImmediately?: boolean;
}) {
  return (await fetchJson<{ document: InventoryDocument }>(`${API_URL}/inventory-documents`, { method: "POST", body: JSON.stringify(input) })).document;
}

export async function postInventoryDocument(id: number) {
  return (await fetchJson<{ document: InventoryDocument }>(`${API_URL}/inventory-documents/${id}/post`, { method: "POST", body: "{}" })).document;
}

export async function voidInventoryDocument(id: number, input: { reason: string }) {
  return (await fetchJson<{ document: InventoryDocument }>(`${API_URL}/inventory-documents/${id}/void`, { method: "POST", body: JSON.stringify(input) })).document;
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

export async function getOrders(branchId: number, limit?: number) {
  const payload = await fetchJson<{ items: Order[] }>(`${API_URL}/orders?branchId=${branchId}${limit ? `&limit=${limit}` : ""}`);
  return payload.items;
}

export async function getOrder(id: number) {
  const payload = await fetchJson<{ order: Order }>(`${API_URL}/orders/${id}`);
  return confirmedOrder(payload, { id });
}

export async function getOrderByIdempotencyKey(idempotencyKey: string) {
  const payload = await fetchJson<{ order: Order }>(
    `${API_URL}/orders/idempotency/${encodeURIComponent(idempotencyKey)}`,
    { timeoutMs: 5_000 }
  );
  return confirmedOrder(payload);
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
      couponCode: input.couponCode,
      skipPromotions: input.skipPromotions,
      discountApprovalToken: input.discountApprovalToken,
      branchId: input.branchId,
      customerId: input.customerId,
      loyaltyPointsToUse: input.loyaltyPointsToUse,
      userId: input.userId,
      shiftId: input.shiftId
    })
  });
  return confirmedOrder(payload, { branchId: input.branchId });
}

/** Manager/admin PIN -> approval token for a large manual discount on this branch's next bill. */
export async function approveDiscount(branchId: number, pin: string, draft: unknown) {
  return fetchJson<{ token: string; approverName: string }>(`${API_URL}/discount-approvals`, { method: "POST", body: JSON.stringify({ branchId, pin, draft }) });
}

export async function createOrder(input: OfflineOrderInput) {
  const request = { ...input, idempotencyKey: input.idempotencyKey || `checkout-${makeOfflineId()}` };
  try {
    return await createOrderOnline(request);
  } catch (error) {
    if (!isOfflineCheckoutError(error)) throw error;
    return queueOfflineOrder(request);
  }
}

export async function updateOrderStatus(id: number, status: OrderStatus, reason?: string) {
  try {
    const payload = await fetchJson<{ order: Order }>(`${API_URL}/orders/${id}`, {
      method: "PATCH",
      timeoutMs: 15_000,
      body: JSON.stringify({ status, reason })
    });
    return confirmedOrder(payload, { id, status });
  } catch (error) {
    const transientStatusError = error instanceof ApiError &&
      (error.status === 408 || error.status === 429 || error.status >= 500 || error.code === "ORDER_RETRY_REQUIRED" || error.message.startsWith("ระบบบันทึกใช้เวลานานเกินไป"));
    if (!(error instanceof RequestTimeoutError) && !(error instanceof OrderConfirmationError) &&
        !isOfflineCheckoutError(error) && !transientStatusError) throw error;
    // Read once after a lost/unclear reply; never repeat the financial mutation here.
    try {
      const payload = await fetchJsonOnce<{ order: Order }>(`${API_URL}/orders/${id}`, { timeoutMs: 5_000 });
      return confirmedOrder(payload, { id, status });
    } catch {
      const action = status === "CANCELLED" ? "ยกเลิกบิล" : status === "REFUNDED" ? "คืนเงิน" : "เปลี่ยนสถานะบิล";
      throw new OrderConfirmationError(`ยังยืนยันการ${action} #${id} ไม่ได้ กรุณารีเฟรชรายการเพื่อตรวจสถานะก่อนลองอีกครั้ง`);
    }
  }
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
  let payload: ShiftCloseResult;
  try {
    payload = await fetchJson<ShiftCloseResult>(`${API_URL}/shifts/${shiftId}/close`, {
      method: "POST",
      body: JSON.stringify({ closingCash, ...details })
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && error.message === "Forbidden: insufficient role") {
      throw new Error("บัญชีนี้ไม่มีสิทธิ์ปิดกะ กรุณาติดต่อผู้ดูแลระบบ");
    }
    throw error;
  }
  const shift = payload?.shift;
  if (!shift || shift.id !== shiftId || shift.status !== "CLOSED" || !Number.isInteger(shift.branchId) || shift.branchId <= 0 ||
      typeof shift.closedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(shift.closedAt) || !Number.isFinite(Date.parse(shift.closedAt))) {
    throw new Error("ยังยืนยันการปิดกะไม่ได้ กรุณาตรวจสอบกะแล้วลองอีกครั้ง");
  }
  return payload;
}

export type AuditEvent = {
  id: number;
  ts: string;
  action: string;
  actor: { id: number; role: string | null; name: string | null } | null;
  branchId: number | null;
  requestId: string | null;
  [detail: string]: unknown;
};

export async function getAuditEvents(params: { limit?: number; action?: string; branchId?: number } = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.action) query.set("action", params.action);
  if (params.branchId) query.set("branchId", String(params.branchId));
  const payload = await fetchJson<{ items: AuditEvent[] }>(`${API_URL}/audit?${query.toString()}`);
  return payload.items;
}

export async function punchTimeClock(branchId: number, pin: string) {
  return fetchJson<{ action: "in" | "out"; entry: TimeEntry; staff: { id: number; name: string } }>(`${API_URL}/time-clock/punch`, { method: "POST", body: JSON.stringify({ branchId, pin }) });
}

export async function getTimeClock(branchId: number, date?: string) {
  const query = new URLSearchParams({ branchId: String(branchId) });
  if (date) query.set("date", date);
  return fetchJson<{ date: string; items: TimeEntry[] }>(`${API_URL}/time-clock?${query.toString()}`);
}

export async function closeTimeEntry(id: number, clockOut: string) {
  const payload = await fetchJson<{ entry: TimeEntry }>(`${API_URL}/time-clock/${id}/close`, { method: "POST", body: JSON.stringify({ clockOut }) });
  return payload.entry;
}

export async function getCashEntries(shiftId: number) {
  const payload = await fetchJson<{ items: CashEntry[] }>(`${API_URL}/shifts/${shiftId}/cash-entries`);
  return payload.items;
}

export async function getCashEntryCategories() {
  return fetchJson<{ out: string[]; in: string[] }>(`${API_URL}/cash-entry-categories`);
}

export async function addCashEntry(shiftId: number, input: { type: "OUT" | "IN"; amount: number; category: string; note?: string }) {
  const payload = await fetchJson<{ entry: CashEntry }>(`${API_URL}/shifts/${shiftId}/cash-entries`, { method: "POST", body: JSON.stringify(input) });
  return payload.entry;
}

export async function voidCashEntry(id: number) {
  await fetchJson<{ ok: boolean }>(`${API_URL}/cash-entries/${id}/void`, { method: "POST" });
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
export async function getPosposMigrationStatuses() {
  const payload = await fetchJson<{ items: PosposBranchSyncStatus[] }>(`${API_URL}/migration/sync/latest`);
  return payload.items;
}

export async function syncPosposMigration(branchId: number) {
  const payload = await fetchJson<{ job: PosposSyncJob }>(`${API_URL}/migration/sync`, {
    method: "POST",
    body: JSON.stringify({ branchId })
  });
  return payload.job;
}

export async function getPosposMigrationJob(id: number) {
  const payload = await fetchJson<{ job: PosposSyncJob }>(`${API_URL}/migration/sync/${id}`);
  return payload.job;
}

/* ─── Purchases ─── */
export async function getPurchases(branchId?: number, options: { query?: string; status?: string } = {}) {
  const query = new URLSearchParams();
  if (branchId) query.set("branchId", String(branchId));
  if (options.query) query.set("query", options.query);
  if (options.status) query.set("status", options.status);
  const payload = await fetchJson<{ items: PurchaseOrder[] }>(`${API_URL}/purchases?${query.toString()}`);
  return payload.items;
}

export async function createPurchase(input: {
  branchId: number;
  supplier: string;
  note: string;
  items: PurchaseOrderItem[];
  /** Admin only (server enforces): set each item's cost to this receipt's price. */
  updateCost?: boolean;
  mode?: "RECEIPT" | "ORDER";
  invoiceNumber?: string;
  documentDate?: string;
  receivedAt?: string;
  dueDate?: string;
  attachmentName?: string;
  attachmentDataUrl?: string | null;
  requestKey?: string;
}) {
  const payload = await fetchJson<{ purchase: PurchaseOrder }>(`${API_URL}/purchases`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.purchase;
}

export async function voidPurchase(id: number, reason: string) {
  return (await fetchJson<{ purchase: PurchaseOrder }>(`${API_URL}/purchases/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) })).purchase;
}

export async function approvePurchase(id: number) {
  const payload = await fetchJson<{ purchase: PurchaseOrder }>(`${API_URL}/purchases/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return payload.purchase;
}

export async function receivePurchase(id: number, input: {
  requestKey: string; items: Array<{ purchaseItemId: number; qty: number; lotNo?: string; expiryDate?: string | null }>;
  receivedAt?: string; note?: string; updateCost?: boolean;
}) {
  return (await fetchJson<{ purchase: PurchaseOrder }>(`${API_URL}/purchases/${id}/receive`, { method: "POST", body: JSON.stringify(input) })).purchase;
}

export async function getPurchaseAttachment(id: number) {
  return fetchJson<{ attachmentName: string; attachmentDataUrl: string | null }>(`${API_URL}/purchases/${id}/attachment`);
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

export async function getActivePromotions() {
  const payload = await fetchJson<{ items: Promotion[] }>(`${API_URL}/promotions/active`);
  return payload.items;
}

export async function updatePromotion(id: number, input: Partial<{ name: string; type: string; value: number; category: string; startAt: string | null; endAt: string | null; active: boolean }>) {
  const payload = await fetchJson<{ item: Promotion }>(`${API_URL}/promotions/${id}`, { method: "PUT", body: JSON.stringify(input) });
  return payload.item;
}

export async function deletePromotion(id: number) {
  await fetchJson<{ ok: boolean }>(`${API_URL}/promotions/${id}`, { method: "DELETE" });
}

export async function getCoupons() {
  const payload = await fetchJson<{ items: Coupon[] }>(`${API_URL}/coupons`);
  return payload.items;
}

export async function createCoupon(input: { code: string; type: string; value: number; maxUses?: number | null; minSpend?: number; expiresAt?: string; active?: boolean }) {
  const payload = await fetchJson<{ item: Coupon }>(`${API_URL}/coupons`, { method: "POST", body: JSON.stringify(input) });
  return payload.item;
}

export async function updateCoupon(id: number, input: Partial<{ type: string; value: number; maxUses: number | null; minSpend: number; expiresAt: string | null; active: boolean }>) {
  const payload = await fetchJson<{ item: Coupon }>(`${API_URL}/coupons/${id}`, { method: "PUT", body: JSON.stringify(input) });
  return payload.item;
}

export async function deleteCoupon(id: number) {
  await fetchJson<{ ok: boolean }>(`${API_URL}/coupons/${id}`, { method: "DELETE" });
}

export async function validateCoupon(code: string) {
  const payload = await fetchJson<{ coupon: { code: string; type: string; value: number; minSpend?: number } }>(`${API_URL}/coupons/validate`, {
    method: "POST",
    body: JSON.stringify({ code })
  });
  return payload.coupon;
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

export async function updateBusinessDocument(id: number, input: { customerName?: string; total?: number; note?: string }) {
  return (await fetchJson<{ item: BusinessDocument }>(`${API_URL}/business-documents/${id}`, { method: "PUT", body: JSON.stringify(input) })).item;
}

export async function setBusinessDocumentStatus(id: number, status: BusinessDocument["status"], reason?: string) {
  return (await fetchJson<{ item: BusinessDocument }>(`${API_URL}/business-documents/${id}/status`, { method: "POST", body: JSON.stringify({ status, reason }) })).item;
}

export async function convertQuotationToInvoice(id: number) {
  return (await fetchJson<{ item: BusinessDocument }>(`${API_URL}/business-documents/${id}/convert`, { method: "POST" })).item;
}

export async function voidTaxInvoice(id: number, reason: string) {
  return (await fetchJson<{ invoice: TaxInvoice }>(`${API_URL}/tax-invoices/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) })).invoice;
}

export async function cancelStockTransfer(id: number) {
  return (await fetchJson<{ transfer: StockTransfer }>(`${API_URL}/stock-transfers/${id}/cancel`, { method: "POST" })).transfer;
}

export async function cancelStockCount(id: number) {
  return (await fetchJson<{ stockCount: StockCount }>(`${API_URL}/stock-counts/${id}/cancel`, { method: "POST" })).stockCount;
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

export async function getCurrentUser() {
  return (await fetchJson<{ user: User }>(`${API_URL}/auth/me`)).user;
}
