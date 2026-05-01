export type PaymentMethod = "CASH" | "QR" | "CARD" | "EWALLET";
export type OrderStatus = "PAID" | "READY" | "CANCELLED" | "REFUNDED";
export type DiscountType = "PERCENT" | "FIXED" | null;
export type DiscountRuleType = "ORDER_PERCENT" | "ORDER_FIXED" | "CATEGORY_PERCENT" | "BUY_X_GET_Y";

export type DiscountRule = {
  id: string;
  label: string;
  type: DiscountRuleType;
  value?: number;
  category?: string;
  buyQty?: number;
  getQty?: number;
  maxDiscount?: number;
};

export type Modifier = {
  name: string;
  value: string;
  price: number;
};

export type Branch = {
  id: number;
  name: string;
  location: string;
  branchType: "coffee" | "oil_service";
  active: boolean;
  createdAt: string;
};

export type User = {
  id: number;
  name: string;
  role: "admin" | "manager" | "cashier";
  branchId?: number | null;
  branch?: { id: number; name: string } | null;
  active?: boolean;
};

export type Shift = {
  id: number;
  branchId: number;
  userId: number | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  totalSales: number;
  totalOrders: number;
  cashSales: number;
  qrSales: number;
  cardSales: number;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
};

export type ShiftPaymentSummary = {
  method: PaymentMethod;
  count: number;
  total: number;
};

export type ShiftSummary = {
  shift: Shift;
  branch: { id: number; name: string; location?: string };
  user: { id: number; name: string; role: string } | null;
  openedAt: string | null;
  closedAt: string | null;
  durationMinutes: number;
  totals: {
    totalSales: number;
    subtotal: number;
    discountAmount: number;
    loyaltyPointsUsed: number;
    tax: number;
    totalOrders: number;
    averageTicket: number;
    paidOrders: number;
    readyOrders: number;
  };
  cash: {
    openingCash: number;
    cashSales: number;
    expectedCash: number;
    closingCash: number | null;
    difference: number | null;
  };
  closeDetails?: {
    cashCounts: Record<string, number>;
    note: string | null;
  };
  payments: ShiftPaymentSummary[];
  topItems: Array<{ menuItemId: number; name: string; qty: number; revenue: number }>;
  orders: Array<{
    id: number;
    status: OrderStatus;
    total: number;
    paymentMethod: PaymentMethod;
    itemCount: number;
    createdAt: string | null;
  }>;
};

export type ShiftCloseResult = {
  shift: Shift;
  summary: ShiftSummary | null;
};

export type Customer = {
  id: number;
  name: string;
  phone: string;
  points: number;
  createdAt: string;
};

export type CustomerInsightItem = Customer & {
  totalOrders: number;
  totalSpend: number;
  recentSpend: number;
  lastOrderAt: string | null;
};

export type CustomerInsights = {
  summary: {
    totalCustomers: number;
    customersWithOrders: number;
    inactiveDays: number;
    inactiveCustomers: number;
    recentSpendTotal: number;
    totalSpend: number;
    averageSpendPerCustomer: number;
  };
  highValueCustomers: CustomerInsightItem[];
  inactiveCustomers: CustomerInsightItem[];
};

export type MenuItem = {
  id: number;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  category: string;
  basePrice: number;
  cost?: number | null;
  imageUrl?: string | null;
  unit?: string | null;
  taxRate?: number | null;
  source?: string | null;
  sourceId?: string | null;
  optionGroup?: string | null;
  optionLabel?: string | null;
  metadata?: string;
  branchType: "coffee" | "oil_service";
  active: boolean;
  createdAt: string;
};

export type Ingredient = {
  id: number;
  name: string;
  unit: string;
  costPerUnit: number;
  createdAt: string;
};

export type InventoryItem = {
  ingredientId: number;
  name: string;
  unit: string;
  costPerUnit: number;
  stockQty: number;
  reorderLevel: number;
};

export type RecipeIngredient = {
  ingredientId: number;
  qty: number;
};

export type Recipe = {
  menuItemId: number;
  ingredients: RecipeIngredient[];
};

export type CupOption = "แก้วเย็น" | "แก้วเดินทาง" | "แก้วทานร้าน" | "แก้วมาเอง";

export type CupStockSettingItem = {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  stockQty: number;
  reorderLevel: number;
  qty: number;
};

export type CupStockSetting = {
  branchId: number;
  cupOption: CupOption;
  deductStock: boolean;
  configured: boolean;
  items: CupStockSettingItem[];
};

export type RecipeCoverageStatus = "has_recipe" | "missing_recipe" | "not_stock_tracked";

export type RecipeCoverageItem = {
  menuItemId: number;
  name: string;
  category: string;
  branchType: MenuItem["branchType"];
  active: boolean;
  status: RecipeCoverageStatus;
  recipeIngredientCount: number;
  soldQty: number;
  soldRevenue: number;
};

export type RecipeCoverageReport = {
  summary: {
    totalMenuItems: number;
    activeMenuItems: number;
    hasRecipe: number;
    missingRecipe: number;
    notStockTracked: number;
    soldMissingRecipe: number;
    soldMissingRecipeQty: number;
    soldMissingRecipeRevenue: number;
  };
  items: RecipeCoverageItem[];
};

export type StockMovement = {
  id: number;
  branchId: number;
  ingredientId: number;
  qty: number;
  reason: string;
  createdAt: string;
};

export type OrderItem = {
  id: number;
  menuItemId: number;
  name: string;
  qty: number;
  basePrice: number;
  modifiers: Modifier[];
  lineTotal: number;
  note?: string;
};

export type Order = {
  id: number;
  branchId: number;
  customerId: number | null;
  userId?: number | null;
  shiftId?: number | null;
  createdAt: string;
  status: OrderStatus;
  subtotal: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  loyaltyPointsUsed: number;
  loyaltyPointsEarned: number;
  tax: number;
  total: number;
  paymentMethod: PaymentMethod;
  items: OrderItem[];
};

export type PurchaseOrderItem = {
  id?: number;
  ingredientId: number;
  ingredientName?: string;
  unit?: string;
  qty: number;
  unitCost: number;
  lineTotal?: number;
};

export type PurchaseOrder = {
  id: number;
  branchId: number;
  branchName?: string;
  supplier: string;
  note: string;
  totalCost: number;
  status: "RECEIVED";
  receivedAt: string;
  createdAt: string;
  itemCount?: number;
  items?: PurchaseOrderItem[];
};

export type IntegrationProvider = "rd_tax" | "line_oa" | "lineman";

export type IntegrationStatus = {
  provider: IntegrationProvider;
  label: string;
  description: string;
  requiredEnv: string[];
  configured: boolean;
  missingEnv: string[];
  pendingEvents: number;
  failedEvents: number;
};

export type IntegrationEvent = {
  id: number;
  provider: IntegrationProvider;
  eventType: string;
  entityType: string;
  entityId: number | null;
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempts: number;
  payload: Record<string, unknown>;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationOutboxSummary = {
  maxAttempts: number;
  byStatus: Array<{ status: IntegrationEvent["status"]; count: number }>;
  byProviderStatus: Array<{ provider: IntegrationProvider; status: IntegrationEvent["status"]; count: number }>;
  oldestPending: IntegrationEvent | null;
  newestFailed: IntegrationEvent | null;
};

export type CartItem = {
  id: string;
  menuItemId: number;
  name: string;
  category: string;
  basePrice: number;
  qty: number;
  modifiers: Modifier[];
  note?: string;
};

export type ReportSource = "system" | "pospos" | "all";

export type SalesSourceBreakdown = {
  system: { orders: number; revenue: number };
  pospos: { orders: number; revenue: number };
  all: { orders: number; revenue: number };
};

export type SalesSummary = {
  source: ReportSource;
  sourceBreakdown: SalesSourceBreakdown;
  importedSalesOnlyOrders: number;
  importedSalesOnlyRevenue: number;
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
  topItems: Array<{ menuItemId: number; name: string; qty: number; revenue: number }>;
  daily: Array<{ date: string; orders: number; revenue: number }>;
};

export type DailyCloseReport = {
  date: string;
  generatedAt: string;
  source: ReportSource;
  sourceBreakdown: SalesSourceBreakdown;
  branch: { id: number; name: string; location: string; branchType: string } | null;
  totals: {
    totalOrders: number;
    subtotal: number;
    discountAmount: number;
    loyaltyPointsUsed: number;
    loyaltyPointsEarned: number;
    tax: number;
    totalRevenue: number;
    averageTicket: number;
    cancelledOrders: number;
    refundedOrders: number;
  };
  payments: Array<{ method: PaymentMethod; count: number; total: number }>;
  cash: {
    cashSales: number;
    expectedCash: number;
    countedCash: number;
    difference: number;
  };
  shifts: Array<{
    id: number;
    branchName: string;
    userName: string;
    status: string;
    openedAt: string;
    closedAt: string | null;
    openingCash: number;
    cashSales: number;
    qrSales: number;
    cardSales: number;
    totalSales: number;
    totalOrders: number;
    expectedCash: number;
    closingCash: number | null;
    difference: number | null;
    cashCounts: Record<string, number>;
    note: string | null;
  }>;
  topItems: Array<{ menuItemId: number; name: string; qty: number; revenue: number }>;
};

export type ProductImportInput = {
  sku?: string;
  barcode?: string;
  name: string;
  category?: string;
  basePrice: number;
  cost?: number;
  stockQty?: number;
  reorderLevel?: number;
  unit?: string;
  imageUrl?: string;
  taxRate?: number;
  source?: string;
  sourceId?: string;
  optionGroup?: string;
  optionLabel?: string;
  metadata?: Record<string, unknown> | string;
};

export type CustomerImportInput = {
  name: string;
  phone: string;
  points?: number;
};

export type HistoricalOrderImportInput = {
  receiptNo?: string;
  createdAt?: string;
  productName: string;
  qty?: number;
  unitPrice?: number;
  total?: number;
  discountAmount?: number;
  paymentMethod?: PaymentMethod;
};

export type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
};
