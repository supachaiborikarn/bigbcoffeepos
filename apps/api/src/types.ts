export type PaymentMethod = "CASH" | "QR" | "CARD" | "EWALLET";
export type OrderStatus = "PAID" | "READY";
export type DiscountType = "PERCENT" | "FIXED" | null;

export type Modifier = {
  name: string;
  value: string;
  price: number;
};

export type Branch = {
  id: number;
  name: string;
  location: string;
  active: boolean;
  createdAt: string;
};

export type Customer = {
  id: number;
  name: string;
  phone: string;
  points: number;
  createdAt: string;
};

export type MenuItem = {
  id: number;
  sku?: string;
  barcode?: string;
  name: string;
  category: string;
  basePrice: number;
  cost?: number;
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

export type IngredientStock = {
  id: number;
  branchId: number;
  ingredientId: number;
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

export type Db = {
  nextMenuId: number;
  nextOrderId: number;
  nextBranchId: number;
  nextCustomerId: number;
  nextIngredientId: number;
  nextIngredientStockId: number;
  nextStockMovementId: number;
  menu: MenuItem[];
  branches: Branch[];
  customers: Customer[];
  ingredients: Ingredient[];
  ingredientStocks: IngredientStock[];
  recipes: Recipe[];
  stockMovements: StockMovement[];
  orders: Order[];
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
