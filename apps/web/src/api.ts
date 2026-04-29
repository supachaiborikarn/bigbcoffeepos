import type {
  Branch,
  CartItem,
  Customer,
  CustomerImportInput,
  DailyCloseReport,
  Ingredient,
  HistoricalOrderImportInput,
  IntegrationEvent,
  IntegrationStatus,
  ImportResult,
  InventoryItem,
  MenuItem,
  Order,
  OrderStatus,
  PaymentMethod,
  ProductImportInput,
  PurchaseOrder,
  PurchaseOrderItem,
  Recipe,
  SalesSummary,
  Shift,
  ShiftCloseResult,
  ShiftSummary,
  StockMovement,
  User,
  DiscountRule,
  DiscountType
} from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5175/api";

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("bb_pos_token");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(input, {
    ...init,
    headers: { ...headers, ...init?.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "Request failed";
    throw new Error(message);
  }
  return payload as T;
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

export async function createCustomer(input: { name: string; phone: string }) {
  const payload = await fetchJson<{ customer: Customer }>(`${API_URL}/customers`, {
    method: "POST",
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

export async function getOrders(branchId: number) {
  const payload = await fetchJson<{ items: Order[] }>(`${API_URL}/orders?branchId=${branchId}`);
  return payload.items;
}

export async function createOrder(input: {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  paymentDetails?: {
    cashReceived?: number;
    paymentConfirmed?: boolean;
  };
  discountType: DiscountType;
  discountValue: number;
  discounts?: DiscountRule[];
  branchId: number;
  customerId: number | null;
  loyaltyPointsToUse: number;
  userId?: number;
  shiftId?: number;
}) {
  const payload = await fetchJson<{ order: Order }>(`${API_URL}/orders`, {
    method: "POST",
    body: JSON.stringify({
      items: input.items.map((item) => ({
        menuItemId: item.menuItemId,
        qty: item.qty,
        modifiers: item.modifiers,
        note: item.note
      })),
      paymentMethod: input.paymentMethod,
      paymentDetails: input.paymentDetails,
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

export async function updateOrderStatus(id: number, status: OrderStatus) {
  const payload = await fetchJson<{ order: Order }>(`${API_URL}/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  return payload.order;
}

export async function getSalesSummary(params: { from?: string; to?: string; branchId?: number }) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.branchId) query.set("branchId", String(params.branchId));
  const payload = await fetchJson<{ summary: SalesSummary }>(`${API_URL}/reports/summary?${query.toString()}`);
  return payload.summary;
}

export async function getDailyCloseReport(params: { date?: string; branchId?: number }) {
  const query = new URLSearchParams();
  if (params.date) query.set("date", params.date);
  if (params.branchId) query.set("branchId", String(params.branchId));
  const payload = await fetchJson<{ report: DailyCloseReport }>(`${API_URL}/reports/day-close?${query.toString()}`);
  return payload.report;
}

export function getOrdersCsvUrl(params: { from?: string; to?: string; branchId?: number }) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.branchId) query.set("branchId", String(params.branchId));
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

/* ─── Integrations ─── */
export async function getIntegrationStatus() {
  const payload = await fetchJson<{ items: IntegrationStatus[] }>(`${API_URL}/integrations/status`);
  return payload.items;
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
  const payload = await fetchJson<{ result: { processed: number; total: number } }>(`${API_URL}/integrations/process`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return payload.result;
}
