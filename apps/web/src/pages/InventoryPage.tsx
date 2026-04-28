import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Edit2, PackageCheck, Plus, Save, Search, X } from "lucide-react";
import {
  createIngredient,
  createMenuItem,
  createPurchase,
  createStockAdjustment,
  getIngredients,
  getInventory,
  getMenu,
  getPurchases,
  getRecipe,
  getStockMovements,
  updateInventoryItem,
  updateMenuItem,
  updateRecipe
} from "../api";
import type { Ingredient, InventoryItem, MenuItem, PurchaseOrder, PurchaseOrderItem, RecipeIngredient, StockMovement } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";

const moneyFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0
});

const branchTypeLabels: Record<MenuItem["branchType"], string> = {
  coffee: "ร้านกาแฟ",
  oil_service: "ศูนย์บริการน้ำมัน"
};

const PRODUCT_PAGE_SIZE = 50;

const recipePresets = [
  {
    id: "iced",
    label: "เย็น",
    items: [
      { label: "แก้วเย็น", qty: 1, keywords: ["แก้วเย็น", "แก้วใส", "แก้วพลาสติก"] },
      { label: "ฝาแก้วเย็น", qty: 1, keywords: ["ฝาแบน", "ฝาเย็น", "ฝาแก้ว"] },
      { label: "หลอด", qty: 1, keywords: ["หลอด"] }
    ]
  },
  {
    id: "blended",
    label: "ปั่น",
    items: [
      { label: "แก้วปั่น", qty: 1, keywords: ["แก้วปั่น", "แก้วเย็น", "แก้วใส"] },
      { label: "ฝาโดม", qty: 1, keywords: ["ฝาโดม", "ฝาปั่น", "ฝาแก้ว"] },
      { label: "หลอดปั่น", qty: 1, keywords: ["หลอดปั่น", "หลอดใหญ่", "หลอด"] }
    ]
  },
  {
    id: "hot",
    label: "ร้อน",
    items: [
      { label: "แก้วร้อน", qty: 1, keywords: ["แก้วร้อน", "แก้วกระดาษ"] },
      { label: "ฝาร้อน", qty: 1, keywords: ["ฝาร้อน", "ฝาแก้ว"] }
    ]
  }
];

type ProductFormState = {
  name: string;
  category: string;
  basePrice: string;
  cost: string;
  sku: string;
  barcode: string;
  branchType: MenuItem["branchType"];
  active: boolean;
};

type StockFormState = {
  name: string;
  unit: string;
  costPerUnit: string;
  stockQty: string;
  reorderLevel: string;
};

type RecipeLineForm = {
  ingredientId: string;
  qty: string;
};

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createBlankProductForm(branchType: MenuItem["branchType"]): ProductFormState {
  return {
    name: "",
    category: "",
    basePrice: "",
    cost: "",
    sku: "",
    barcode: "",
    branchType,
    active: true
  };
}

function productToForm(item: MenuItem): ProductFormState {
  return {
    name: item.name,
    category: item.category,
    basePrice: String(item.basePrice ?? ""),
    cost: item.cost === null || item.cost === undefined ? "" : String(item.cost),
    sku: item.sku ?? "",
    barcode: item.barcode ?? "",
    branchType: item.branchType ?? "coffee",
    active: item.active
  };
}

function stockToForm(item: InventoryItem): StockFormState {
  return {
    name: item.name,
    unit: item.unit,
    costPerUnit: String(item.costPerUnit ?? ""),
    stockQty: String(item.stockQty ?? ""),
    reorderLevel: String(item.reorderLevel ?? "")
  };
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

export default function InventoryPage() {
  const { activeBranch } = useBranch();
  const toast = useToast();

  const defaultBranchType = activeBranch?.branchType ?? "coffee";

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);

  const [menuForm, setMenuForm] = useState<ProductFormState>(() => createBlankProductForm(defaultBranchType));
  const [ingredientForm, setIngredientForm] = useState({ name: "", unit: "ชิ้น", costPerUnit: "", stockQty: "", reorderLevel: "" });
  const [adjustForm, setAdjustForm] = useState({ ingredientId: "", qty: "", reason: "ADJUSTMENT" });
  const [purchaseForm, setPurchaseForm] = useState({ supplier: "", note: "", ingredientId: "", qty: "", unitCost: "" });
  const [purchaseItems, setPurchaseItems] = useState<PurchaseOrderItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("ทั้งหมด");
  const [productStatus, setProductStatus] = useState<"all" | "active" | "inactive">("all");
  const [productPage, setProductPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<MenuItem | null>(null);
  const [productEditForm, setProductEditForm] = useState<ProductFormState | null>(null);

  const [stockSearch, setStockSearch] = useState("");
  const [selectedStock, setSelectedStock] = useState<InventoryItem | null>(null);
  const [stockEditForm, setStockEditForm] = useState<StockFormState | null>(null);

  const [recipeProductSearch, setRecipeProductSearch] = useState("");
  const [recipeIngredientSearch, setRecipeIngredientSearch] = useState("");
  const [selectedRecipeProduct, setSelectedRecipeProduct] = useState<MenuItem | null>(null);
  const [recipeLines, setRecipeLines] = useState<RecipeLineForm[]>([]);
  const [isRecipeLoading, setIsRecipeLoading] = useState(false);

  const lowStockItems = useMemo(
    () => inventory.filter((item) => item.stockQty <= item.reorderLevel),
    [inventory]
  );

  const categoryOptions = useMemo(() => {
    const categories = new Set(menu.map((item) => item.category).filter(Boolean));
    return ["ทั้งหมด", ...Array.from(categories).sort((a, b) => a.localeCompare(b, "th"))];
  }, [menu]);

  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return menu.filter((item) => {
      const searchable = `${item.name} ${item.category} ${item.sku ?? ""} ${item.barcode ?? ""}`.toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (productCategory !== "ทั้งหมด" && item.category !== productCategory) return false;
      if (productStatus === "active" && !item.active) return false;
      if (productStatus === "inactive" && item.active) return false;
      return true;
    });
  }, [menu, productCategory, productSearch, productStatus]);

  const productPageCount = Math.max(1, Math.ceil(visibleProducts.length / PRODUCT_PAGE_SIZE));
  const paginatedProducts = useMemo(() => {
    const start = (productPage - 1) * PRODUCT_PAGE_SIZE;
    return visibleProducts.slice(start, start + PRODUCT_PAGE_SIZE);
  }, [productPage, visibleProducts]);
  const productStartIndex = visibleProducts.length === 0 ? 0 : (productPage - 1) * PRODUCT_PAGE_SIZE + 1;
  const productEndIndex = Math.min(productPage * PRODUCT_PAGE_SIZE, visibleProducts.length);

  const visibleStock = useMemo(() => {
    const query = stockSearch.trim().toLowerCase();
    if (!query) return inventory;
    return inventory.filter((item) => `${item.name} ${item.unit}`.toLowerCase().includes(query));
  }, [inventory, stockSearch]);

  const ingredientNameById = useMemo(() => {
    const map = new Map<number, string>();
    ingredients.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [ingredients]);

  const activeProductCount = useMemo(() => menu.filter((item) => item.active).length, [menu]);

  const recipeProducts = useMemo(() => {
    const query = recipeProductSearch.trim().toLowerCase();
    const branchType = activeBranch?.branchType;
    return menu
      .filter((item) => {
        if (branchType && item.branchType !== branchType) return false;
        if (!item.active) return false;
        if (!query) return true;
        return `${item.name} ${item.category} ${item.sku ?? ""}`.toLowerCase().includes(query);
      })
      .slice(0, 30);
  }, [activeBranch, menu, recipeProductSearch]);

  const recipeIngredientMatches = useMemo(() => {
    const query = normalizeText(recipeIngredientSearch.trim());
    return inventory
      .filter((item) => {
        if (!query) return ["แก้ว", "ฝา", "หลอด", "กาแฟ", "นม"].some((keyword) => normalizeText(item.name).includes(keyword));
        return normalizeText(`${item.name} ${item.unit}`).includes(query);
      })
      .slice(0, 10);
  }, [inventory, recipeIngredientSearch]);

  const recipeSummary = useMemo(() => {
    return recipeLines
      .map((line) => {
        const ingredientId = Number(line.ingredientId);
        const qty = toNumber(line.qty);
        const item = inventory.find((stockItem) => stockItem.ingredientId === ingredientId);
        if (!item || qty === null || qty <= 0) return null;
        return { ...item, qty };
      })
      .filter((item): item is InventoryItem & { qty: number } => Boolean(item));
  }, [inventory, recipeLines]);

  const refreshInventory = async () => {
    const [menuItems, ingredientItems] = await Promise.all([getMenu(), getIngredients()]);
    setMenu(menuItems);
    setIngredients(ingredientItems);
    setSelectedProduct((current) => (current ? menuItems.find((item) => item.id === current.id) ?? null : null));
    setSelectedRecipeProduct((current) => (current ? menuItems.find((item) => item.id === current.id) ?? null : null));

    if (!activeBranch) {
      setInventory([]);
      setMovements([]);
      setPurchases([]);
      return;
    }

    const [inventoryItems, movementItems, purchaseItemsFromApi] = await Promise.all([
      getInventory(activeBranch.id),
      getStockMovements(activeBranch.id),
      getPurchases(activeBranch.id)
    ]);
    setInventory(inventoryItems);
    setMovements(movementItems.slice(0, 20));
    setPurchases(purchaseItemsFromApi);
    setSelectedStock((current) => (
      current ? inventoryItems.find((item) => item.ingredientId === current.ingredientId) ?? null : null
    ));
  };

  useEffect(() => {
    setMenuForm((prev) => ({ ...prev, branchType: defaultBranchType }));
  }, [defaultBranchType]);

  useEffect(() => {
    setProductPage(1);
  }, [productCategory, productSearch, productStatus]);

  useEffect(() => {
    setProductPage((current) => Math.min(current, productPageCount));
  }, [productPageCount]);

  useEffect(() => {
    refreshInventory().catch(() => {});
  }, [activeBranch]);

  const handleAddMenu = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const basePrice = toNumber(menuForm.basePrice);
    const cost = menuForm.cost.trim() ? toNumber(menuForm.cost) : undefined;
    if (!menuForm.name.trim() || !menuForm.category.trim() || basePrice === null || basePrice < 0) {
      toast.error("กรุณากรอกข้อมูลสินค้าให้ครบ");
      return;
    }
    if (cost === null || (typeof cost === "number" && cost < 0)) {
      toast.error("ต้นทุนสินค้าไม่ถูกต้อง");
      return;
    }

    setIsSubmitting(true);
    try {
      await createMenuItem({
        name: menuForm.name.trim(),
        category: menuForm.category.trim(),
        basePrice,
        cost,
        sku: menuForm.sku.trim() || undefined,
        barcode: menuForm.barcode.trim() || undefined,
        branchType: menuForm.branchType
      });
      setMenuForm(createBlankProductForm(defaultBranchType));
      await refreshInventory();
      toast.success("เพิ่มสินค้าสำเร็จ");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProductEditStart = (item: MenuItem) => {
    setSelectedProduct(item);
    setProductEditForm(productToForm(item));
  };

  const handleRecipeProductSelect = async (item: MenuItem) => {
    setSelectedRecipeProduct(item);
    setIsRecipeLoading(true);
    try {
      const recipe = await getRecipe(item.id);
      setRecipeLines(recipe.ingredients.map((ingredient) => ({
        ingredientId: String(ingredient.ingredientId),
        qty: String(ingredient.qty)
      })));
    } catch {
      setRecipeLines([]);
    } finally {
      setIsRecipeLoading(false);
    }
  };

  const upsertRecipeLine = (ingredientId: number, qty = 1) => {
    setRecipeLines((prev) => {
      const existing = prev.find((line) => Number(line.ingredientId) === ingredientId);
      if (existing) {
        return prev.map((line) => Number(line.ingredientId) === ingredientId ? { ...line, qty: String(qty) } : line);
      }
      return [...prev, { ingredientId: String(ingredientId), qty: String(qty) }];
    });
  };

  const handleAddRecipeIngredient = (item: InventoryItem) => {
    upsertRecipeLine(item.ingredientId, 1);
    setRecipeIngredientSearch("");
  };

  const handleApplyRecipePreset = (presetId: string) => {
    if (!selectedRecipeProduct) {
      toast.error("เลือกเมนูขายก่อนตั้งสูตร");
      return;
    }

    const preset = recipePresets.find((item) => item.id === presetId);
    if (!preset) return;

    const missing: string[] = [];
    let added = 0;

    preset.items.forEach((presetItem) => {
      const stockItem = inventory.find((item) => {
        const name = normalizeText(item.name);
        return presetItem.keywords.some((keyword) => name.includes(normalizeText(keyword)));
      });
      if (!stockItem) {
        missing.push(presetItem.label);
        return;
      }
      upsertRecipeLine(stockItem.ingredientId, presetItem.qty);
      added += 1;
    });

    if (added > 0) toast.success(`ใส่สูตร${preset.label}แล้ว`);
    if (missing.length > 0) toast.error(`ยังไม่พบในสต็อก: ${missing.join(", ")}`);
  };

  const handleRecipeQtyChange = (ingredientId: number, qty: string) => {
    setRecipeLines((prev) => prev.map((line) => Number(line.ingredientId) === ingredientId ? { ...line, qty } : line));
  };

  const handleRemoveRecipeLine = (ingredientId: number) => {
    setRecipeLines((prev) => prev.filter((line) => Number(line.ingredientId) !== ingredientId));
  };

  const handleSaveRecipe = async () => {
    if (!selectedRecipeProduct) {
      toast.error("เลือกเมนูขายก่อนบันทึกสูตร");
      return;
    }

    const normalized = recipeLines.reduce<RecipeIngredient[]>((acc, line) => {
      const ingredientId = Number(line.ingredientId);
      const qty = toNumber(line.qty);
      if (!ingredientId || qty === null || qty <= 0) return acc;
      const existing = acc.find((item) => item.ingredientId === ingredientId);
      if (existing) existing.qty += qty;
      else acc.push({ ingredientId, qty });
      return acc;
    }, []);

    if (recipeLines.length > 0 && normalized.length !== recipeLines.length) {
      toast.error("ตรวจจำนวนที่ใช้ต่อแก้วให้ถูกต้อง");
      return;
    }

    setIsSubmitting(true);
    try {
      const recipe = await updateRecipe(selectedRecipeProduct.id, normalized);
      setRecipeLines((recipe?.ingredients ?? normalized).map((ingredient) => ({
        ingredientId: String(ingredient.ingredientId),
        qty: String(ingredient.qty)
      })));
      toast.success("บันทึกสูตรตัดสต็อกแล้ว");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProductEditCancel = () => {
    setSelectedProduct(null);
    setProductEditForm(null);
  };

  const handleProductUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct || !productEditForm) return;

    const basePrice = toNumber(productEditForm.basePrice);
    const cost = productEditForm.cost.trim() ? toNumber(productEditForm.cost) : null;
    if (!productEditForm.name.trim() || !productEditForm.category.trim() || basePrice === null || basePrice < 0) {
      toast.error("กรุณากรอกข้อมูลสินค้าให้ครบ");
      return;
    }
    if (cost !== null && cost < 0) {
      toast.error("ต้นทุนสินค้าไม่ถูกต้อง");
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateMenuItem(selectedProduct.id, {
        name: productEditForm.name.trim(),
        category: productEditForm.category.trim(),
        basePrice,
        cost,
        sku: productEditForm.sku.trim(),
        barcode: productEditForm.barcode.trim(),
        branchType: productEditForm.branchType,
        active: productEditForm.active
      });
      setSelectedProduct(updated);
      setProductEditForm(productToForm(updated));
      await refreshInventory();
      toast.success("บันทึกข้อมูลสินค้าสำเร็จ");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddIngredient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeBranch) return toast.error("เลือกสาขาก่อน");
    if (!ingredientForm.name || !ingredientForm.unit || !ingredientForm.costPerUnit) {
      toast.error("กรุณากรอกข้อมูลวัตถุดิบให้ครบ");
      return;
    }

    setIsSubmitting(true);
    try {
      await createIngredient({
        name: ingredientForm.name,
        unit: ingredientForm.unit,
        costPerUnit: Number(ingredientForm.costPerUnit),
        stockQty: Number(ingredientForm.stockQty) || 0,
        reorderLevel: Number(ingredientForm.reorderLevel) || 0,
        branchId: activeBranch.id
      });
      setIngredientForm({ name: "", unit: "ชิ้น", costPerUnit: "", stockQty: "", reorderLevel: "" });
      await refreshInventory();
      toast.success("เพิ่มวัตถุดิบสำเร็จ");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStockEditStart = (item: InventoryItem) => {
    setSelectedStock(item);
    setStockEditForm(stockToForm(item));
  };

  const handleStockEditCancel = () => {
    setSelectedStock(null);
    setStockEditForm(null);
  };

  const handleStockUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeBranch || !selectedStock || !stockEditForm) return;

    const costPerUnit = toNumber(stockEditForm.costPerUnit);
    const stockQty = toNumber(stockEditForm.stockQty);
    const reorderLevel = toNumber(stockEditForm.reorderLevel);
    if (!stockEditForm.name.trim() || !stockEditForm.unit.trim() || costPerUnit === null || costPerUnit < 0) {
      toast.error("กรุณากรอกข้อมูลสต็อกให้ครบ");
      return;
    }
    if (stockQty === null || stockQty < 0 || reorderLevel === null || reorderLevel < 0) {
      toast.error("จำนวนคงเหลือหรือจุดสั่งซื้อไม่ถูกต้อง");
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateInventoryItem(selectedStock.ingredientId, {
        branchId: activeBranch.id,
        name: stockEditForm.name.trim(),
        unit: stockEditForm.unit.trim(),
        costPerUnit,
        stockQty,
        reorderLevel
      });
      await refreshInventory();
      setSelectedStock(updated);
      setStockEditForm(stockToForm(updated));
      toast.success("บันทึกข้อมูลสต็อกสำเร็จ");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStockAdjust = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeBranch) return toast.error("เลือกสาขาก่อน");
    const ingredientId = Number(adjustForm.ingredientId);
    const qty = Number(adjustForm.qty);
    if (!ingredientId || !Number.isFinite(qty) || qty === 0) return toast.error("เลือกวัตถุดิบและจำนวนให้ถูกต้อง");

    setIsSubmitting(true);
    try {
      await createStockAdjustment({ branchId: activeBranch.id, ingredientId, qty, reason: adjustForm.reason || "ADJUSTMENT" });
      setAdjustForm({ ingredientId: "", qty: "", reason: "ADJUSTMENT" });
      await refreshInventory();
      toast.success("ปรับสต็อกสำเร็จ");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddPurchaseLine = () => {
    const ingredientId = Number(purchaseForm.ingredientId);
    const qty = Number(purchaseForm.qty);
    const unitCost = Number(purchaseForm.unitCost);
    const ingredient = ingredients.find((item) => item.id === ingredientId);
    if (!ingredient || !qty || !unitCost) return toast.error("เลือกสินค้าเข้าและกรอกจำนวน/ต้นทุน");

    setPurchaseItems((prev) => [
      ...prev,
      {
        ingredientId,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        qty,
        unitCost,
        lineTotal: qty * unitCost
      }
    ]);
    setPurchaseForm((prev) => ({ ...prev, ingredientId: "", qty: "", unitCost: "" }));
  };

  const handleReceivePurchase = async () => {
    if (!activeBranch) return toast.error("เลือกสาขาก่อน");
    if (!purchaseItems.length) return toast.error("เพิ่มรายการรับเข้าก่อน");

    setIsSubmitting(true);
    try {
      await createPurchase({
        branchId: activeBranch.id,
        supplier: purchaseForm.supplier,
        note: purchaseForm.note,
        items: purchaseItems
      });
      setPurchaseForm({ supplier: "", note: "", ingredientId: "", qty: "", unitCost: "" });
      setPurchaseItems([]);
      await refreshInventory();
      toast.success("รับสินค้าเข้าสต็อกเรียบร้อย");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="inventory-workspace">
      <section className="inventory-summary">
        <div>
          <p className="eyebrow">Inventory Control</p>
          <h1>สต็อกสินค้า</h1>
          <p className="muted">{activeBranch?.name ?? "ยังไม่ได้เลือกสาขา"} · จัดการสินค้าเปิดขายและสต็อกวัตถุดิบของสาขา</p>
        </div>
        <div className="inventory-kpis" style={{ display: "flex", gap: "16px", marginTop: "16px" }}>
          <div style={{ flex: 1, background: "var(--bg-surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>สินค้าเปิดขาย</span>
            <strong style={{ display: "block", fontSize: "28px", color: "var(--text-primary)", marginTop: "4px" }}>{activeProductCount}</strong>
          </div>
          <div style={{ flex: 1, background: "var(--bg-surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>วัตถุดิบ (เมล็ด, นม, แก้ว)</span>
            <strong style={{ display: "block", fontSize: "28px", color: "var(--text-primary)", marginTop: "4px" }}>{inventory.length}</strong>
          </div>
          <div style={{ flex: 1, background: "var(--bg-surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>แจ้งเตือนสต็อกต่ำ</span>
            <strong className={lowStockItems.length ? "negative" : "positive"} style={{ display: "block", fontSize: "28px", color: lowStockItems.length > 0 ? "var(--warning)" : "var(--success)", marginTop: "4px" }}>{lowStockItems.length}</strong>
          </div>
        </div>
      </section>

      <section className="panel inventory-product-panel">
        <div className="panel__header">
          <div>
            <h2>รายการสินค้า</h2>
            <p className="muted">ดู ค้นหา และแก้ไขสินค้าเดิมที่ใช้ขายหน้าร้าน</p>
          </div>
          <span className="badge">{visibleProducts.length} รายการ</span>
        </div>

        <div className="inventory-toolbar">
          <label className="inventory-search">
            <Search size={16} />
            <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด" />
          </label>
          <select className="input" value={productCategory} onChange={(e) => setProductCategory(e.target.value)}>
            {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select className="input" value={productStatus} onChange={(e) => setProductStatus(e.target.value as typeof productStatus)}>
            <option value="all">ทุกสถานะ</option>
            <option value="active">เปิดขาย</option>
            <option value="inactive">ปิดขาย</option>
          </select>
        </div>

        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>สินค้า</th>
                <th>SKU / Barcode</th>
                <th>หมวด</th>
                <th>ราคา</th>
                <th>ต้นทุน</th>
                <th>สาขา</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.map((item) => (
                <tr key={item.id} className={selectedProduct?.id === item.id ? "is-selected" : ""}>
                  <td>
                    <strong>{item.name}</strong>
                    <span className="muted">#{item.id}</span>
                  </td>
                  <td>
                    <span>{item.sku || "-"}</span>
                    <small>{item.barcode || "ไม่มีบาร์โค้ด"}</small>
                  </td>
                  <td>{item.category}</td>
                  <td>{formatMoney(item.basePrice)}</td>
                  <td>{item.cost === null || item.cost === undefined ? "-" : formatMoney(item.cost)}</td>
                  <td>{branchTypeLabels[item.branchType]}</td>
                  <td><span className={`status-badge ${item.active ? "status-badge--active" : "status-badge--inactive"}`}>{item.active ? "เปิดขาย" : "ปิดขาย"}</span></td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-action" onClick={() => handleProductEditStart(item)} aria-label={`แก้ไข ${item.name}`}>
                        <Edit2 size={16} />
                      </button>
                      <button type="button" className="icon-action" onClick={() => handleRecipeProductSelect(item)} aria-label={`ตั้งสูตร ${item.name}`}>
                        <PackageCheck size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleProducts.length === 0 && <div className="empty">ไม่พบสินค้า</div>}
        </div>

        {visibleProducts.length > 0 && (
          <div className="inventory-pagination">
            <span>แสดง {productStartIndex}-{productEndIndex} จาก {visibleProducts.length} รายการ</span>
            <div>
              <button type="button" className="btn btn--ghost" onClick={() => setProductPage((page) => Math.max(1, page - 1))} disabled={productPage === 1}>
                <ChevronLeft size={16} />
                ก่อนหน้า
              </button>
              <strong>หน้า {productPage} / {productPageCount}</strong>
              <button type="button" className="btn btn--ghost" onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))} disabled={productPage === productPageCount}>
                ถัดไป
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {selectedProduct && productEditForm && (
          <form className="inventory-editor" onSubmit={handleProductUpdate}>
            <div className="inventory-editor__header">
              <div>
                <h3>แก้ไขสินค้า</h3>
                <p className="muted">{selectedProduct.name}</p>
              </div>
              <button type="button" className="icon-action" onClick={handleProductEditCancel} aria-label="ปิดฟอร์มแก้ไขสินค้า">
                <X size={16} />
              </button>
            </div>
            <div className="inventory-form-grid">
              <input className="input" value={productEditForm.name} onChange={(e) => setProductEditForm({ ...productEditForm, name: e.target.value })} placeholder="ชื่อสินค้า (เช่น ลาเต้เย็น)" />
              <input className="input" value={productEditForm.category} onChange={(e) => setProductEditForm({ ...productEditForm, category: e.target.value })} placeholder="หมวดหมู่ (เช่น กาแฟ)" />
              <input className="input" type="number" value={productEditForm.basePrice} onChange={(e) => setProductEditForm({ ...productEditForm, basePrice: e.target.value })} placeholder="ราคาขาย" min="0" step="0.01" />
              <input className="input" type="number" value={productEditForm.cost} onChange={(e) => setProductEditForm({ ...productEditForm, cost: e.target.value })} placeholder="ต้นทุนอ้างอิง" min="0" step="0.01" />
              <input className="input" value={productEditForm.sku} onChange={(e) => setProductEditForm({ ...productEditForm, sku: e.target.value })} placeholder="SKU" />
              <input className="input" value={productEditForm.barcode} onChange={(e) => setProductEditForm({ ...productEditForm, barcode: e.target.value })} placeholder="บาร์โค้ด" />
              <select className="input" value={productEditForm.branchType} onChange={(e) => setProductEditForm({ ...productEditForm, branchType: e.target.value as MenuItem["branchType"] })} style={{ display: "none" }}>
                <option value="coffee">ร้านกาแฟ</option>
              </select>
              <label className="toggle-line" style={{ gridColumn: "1 / -1", background: "var(--bg-subtle)", padding: "12px", borderRadius: "8px" }}>
                <input type="checkbox" checked={productEditForm.active} onChange={(e) => setProductEditForm({ ...productEditForm, active: e.target.checked })} />
                <span style={{ fontWeight: 500 }}>เปิดขายหน้าร้าน</span>
              </label>
            </div>
            <div className="inventory-editor__actions">
              <button type="button" className="btn btn--ghost" onClick={handleProductEditCancel}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
                <Save size={16} />
                บันทึกสินค้า
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="panel recipe-builder-panel">
        <div className="panel__header">
          <div>
            <h2>สูตรตัดสต็อกเมนูกาแฟ</h2>
            <p className="muted">กำหนดวัตถุดิบที่จะถูกตัดทุกครั้งที่ขายเมนูนี้</p>
          </div>
          {selectedRecipeProduct && <span className="badge">{recipeSummary.length} รายการในสูตร</span>}
        </div>

        <div className="recipe-builder">
          <div className="recipe-products">
            <label className="inventory-search">
              <Search size={16} />
              <input value={recipeProductSearch} onChange={(e) => setRecipeProductSearch(e.target.value)} placeholder="ค้นหาเมนูขาย" />
            </label>
            <div className="recipe-product-list">
              {recipeProducts.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`recipe-product-row ${selectedRecipeProduct?.id === item.id ? "is-selected" : ""}`}
                  onClick={() => handleRecipeProductSelect(item)}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.category} · {formatMoney(item.basePrice)}</small>
                  </span>
                  <PackageCheck size={16} />
                </button>
              ))}
              {recipeProducts.length === 0 && <div className="empty">ไม่พบเมนูขาย</div>}
            </div>
          </div>

          <div className="recipe-editor">
            {selectedRecipeProduct ? (
              <>
                <div className="recipe-editor__head">
                  <div>
                    <h3>{selectedRecipeProduct.name}</h3>
                    <p className="muted">{isRecipeLoading ? "กำลังโหลดสูตร" : "จำนวนด้านล่างคือวัตถุดิบที่ใช้ต่อการขาย 1 แก้ว/1 รายการ"}</p>
                  </div>
                  <div className="recipe-preset-row">
                    {recipePresets.map((preset) => (
                      <button type="button" key={preset.id} className="btn btn--ghost" onClick={() => handleApplyRecipePreset(preset.id)}>
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="recipe-add-box">
                  <label className="inventory-search">
                    <Search size={16} />
                    <input value={recipeIngredientSearch} onChange={(e) => setRecipeIngredientSearch(e.target.value)} placeholder="ค้นหาวัตถุดิบ เช่น แก้วเย็น" />
                  </label>
                  <div className="recipe-ingredient-picks">
                    {recipeIngredientMatches.map((item) => (
                      <button type="button" key={item.ingredientId} className="recipe-ingredient-chip" onClick={() => handleAddRecipeIngredient(item)}>
                        <Plus size={14} />
                        <span>{item.name}</span>
                        <small>{item.stockQty} {item.unit}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="recipe-lines">
                  {recipeSummary.map((item) => (
                    <div key={item.ingredientId} className="recipe-line">
                      <div>
                        <strong>{item.name}</strong>
                        <small>คงเหลือ {item.stockQty} {item.unit} · จุดสั่งซื้อ {item.reorderLevel}</small>
                      </div>
                      <div className="recipe-line__qty">
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.001"
                          value={recipeLines.find((line) => Number(line.ingredientId) === item.ingredientId)?.qty ?? ""}
                          onChange={(e) => handleRecipeQtyChange(item.ingredientId, e.target.value)}
                        />
                        <span>{item.unit}/รายการ</span>
                        <button type="button" className="icon-action" onClick={() => handleRemoveRecipeLine(item.ingredientId)} aria-label={`ลบ ${item.name} ออกจากสูตร`}>
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {recipeSummary.length === 0 && <div className="stock-editor-empty">ยังไม่มีวัตถุดิบในสูตร</div>}
                </div>

                <div className="inventory-editor__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setRecipeLines([])} disabled={isSubmitting || recipeLines.length === 0}>ล้างสูตร</button>
                  <button type="button" className="btn btn--primary" onClick={handleSaveRecipe} disabled={isSubmitting}>
                    <Save size={16} />
                    บันทึกสูตร
                  </button>
                </div>
              </>
            ) : (
              <div className="stock-editor-empty">เลือกเมนูขายเพื่อเริ่มตั้งสูตรตัดสต็อก</div>
            )}
          </div>
        </div>
      </section>

      <section className="inventory-layout">
        <form onSubmit={handleAddMenu} className="panel">
          <div className="panel__header">
            <div>
              <h2>เพิ่มสินค้าใหม่</h2>
              <p className="muted">สร้างสินค้าเพื่อขายในหน้า POS</p>
            </div>
            <Plus size={18} />
          </div>
          <div className="inventory-form-grid inventory-form-grid--compact">
            <input className="input" value={menuForm.name} onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })} placeholder="ชื่อสินค้า" />
            <input className="input" value={menuForm.category} onChange={(e) => setMenuForm({ ...menuForm, category: e.target.value })} placeholder="หมวดหมู่" />
            <input className="input" type="number" value={menuForm.basePrice} onChange={(e) => setMenuForm({ ...menuForm, basePrice: e.target.value })} placeholder="ราคาขาย" min="0" step="0.01" />
            <input className="input" type="number" value={menuForm.cost} onChange={(e) => setMenuForm({ ...menuForm, cost: e.target.value })} placeholder="ต้นทุน" min="0" step="0.01" />
            <input className="input" value={menuForm.sku} onChange={(e) => setMenuForm({ ...menuForm, sku: e.target.value })} placeholder="SKU" />
            <input className="input" value={menuForm.barcode} onChange={(e) => setMenuForm({ ...menuForm, barcode: e.target.value })} placeholder="บาร์โค้ด" />
            <select className="input" value={menuForm.branchType} onChange={(e) => setMenuForm({ ...menuForm, branchType: e.target.value as MenuItem["branchType"] })}>
              <option value="coffee">ร้านกาแฟ</option>
              <option value="oil_service">ศูนย์บริการน้ำมัน</option>
            </select>
          </div>
          <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
            <PackageCheck size={16} />
            บันทึกสินค้า
          </button>
        </form>

        <form onSubmit={handleAddIngredient} className="panel">
          <div className="panel__header">
            <div>
              <h2>เพิ่มวัตถุดิบ</h2>
              <p className="muted">ตั้งต้นสินค้าในสต็อกของสาขา</p>
            </div>
            <Plus size={18} />
          </div>
          <div className="inventory-form-grid inventory-form-grid--compact">
            <input className="input" value={ingredientForm.name} onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })} placeholder="ชื่อวัตถุดิบ" />
            <input className="input" value={ingredientForm.unit} onChange={(e) => setIngredientForm({ ...ingredientForm, unit: e.target.value })} placeholder="หน่วย" />
            <input className="input" type="number" value={ingredientForm.costPerUnit} onChange={(e) => setIngredientForm({ ...ingredientForm, costPerUnit: e.target.value })} placeholder="ต้นทุน/หน่วย" min="0" step="0.01" />
            <input className="input" type="number" value={ingredientForm.stockQty} onChange={(e) => setIngredientForm({ ...ingredientForm, stockQty: e.target.value })} placeholder="จำนวนตั้งต้น" min="0" step="0.001" />
            <input className="input" type="number" value={ingredientForm.reorderLevel} onChange={(e) => setIngredientForm({ ...ingredientForm, reorderLevel: e.target.value })} placeholder="จุดสั่งซื้อ" min="0" step="0.001" />
          </div>
          <button type="submit" className="btn btn--ghost" disabled={isSubmitting}>บันทึกวัตถุดิบ</button>
        </form>
      </section>

      <section className="panel inventory-stock-panel">
        <div className="panel__header">
          <div>
            <h2>สต็อกสาขา</h2>
            <p className="muted">{activeBranch?.name} · ต่ำกว่าเกณฑ์ {lowStockItems.length} รายการ</p>
          </div>
          <label className="inventory-search inventory-search--small">
            <Search size={16} />
            <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder="ค้นหาสต็อก" />
          </label>
        </div>

        <div className="stock-manager">
          <div className="stock-list">
            {visibleStock.map((item) => (
              <button type="button" key={item.ingredientId} className={`stock-row ${selectedStock?.ingredientId === item.ingredientId ? "is-selected" : ""}`} onClick={() => handleStockEditStart(item)}>
                <span>
                  <strong>{item.name}</strong>
                  <small>จุดสั่งซื้อ {item.reorderLevel} {item.unit} · ต้นทุน {formatMoney(item.costPerUnit)}</small>
                </span>
                <span className={item.stockQty <= item.reorderLevel ? "negative" : "positive"}>
                  {item.stockQty} {item.unit}
                </span>
              </button>
            ))}
            {visibleStock.length === 0 && <div className="empty">ไม่มีข้อมูลสต็อก</div>}
          </div>

          {selectedStock && stockEditForm ? (
            <form className="inventory-editor inventory-editor--stock" onSubmit={handleStockUpdate}>
              <div className="inventory-editor__header">
                <div>
                  <h3>แก้ไขสต็อก</h3>
                  <p className="muted">{selectedStock.name}</p>
                </div>
                <button type="button" className="icon-action" onClick={handleStockEditCancel} aria-label="ปิดฟอร์มแก้ไขสต็อก">
                  <X size={16} />
                </button>
              </div>
              <div className="inventory-form-grid inventory-form-grid--compact">
                <input className="input" value={stockEditForm.name} onChange={(e) => setStockEditForm({ ...stockEditForm, name: e.target.value })} placeholder="ชื่อวัตถุดิบ" />
                <input className="input" value={stockEditForm.unit} onChange={(e) => setStockEditForm({ ...stockEditForm, unit: e.target.value })} placeholder="หน่วย" />
                <input className="input" type="number" value={stockEditForm.costPerUnit} onChange={(e) => setStockEditForm({ ...stockEditForm, costPerUnit: e.target.value })} placeholder="ต้นทุน/หน่วย" min="0" step="0.01" />
                <input className="input" type="number" value={stockEditForm.stockQty} onChange={(e) => setStockEditForm({ ...stockEditForm, stockQty: e.target.value })} placeholder="จำนวนคงเหลือ" min="0" step="0.001" />
                <input className="input" type="number" value={stockEditForm.reorderLevel} onChange={(e) => setStockEditForm({ ...stockEditForm, reorderLevel: e.target.value })} placeholder="จุดสั่งซื้อ" min="0" step="0.001" />
              </div>
              <div className="inventory-editor__actions">
                <button type="button" className="btn btn--ghost" onClick={handleStockEditCancel}>ยกเลิก</button>
                <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
                  <Save size={16} />
                  บันทึกสต็อก
                </button>
              </div>
            </form>
          ) : (
            <div className="stock-editor-empty">เลือกสต็อกหนึ่งรายการเพื่อแก้ไขชื่อ หน่วย ต้นทุน จุดสั่งซื้อ หรือยอดคงเหลือ</div>
          )}
        </div>
      </section>

      <section className="inventory-layout">
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>ปรับสต็อก</h2>
              <p className="muted">รับเข้า/ตัดออกแบบ manual พร้อม movement log</p>
            </div>
          </div>
          <form onSubmit={handleStockAdjust} className="inventory-form-grid inventory-form-grid--compact">
            <select className="input" value={adjustForm.ingredientId} onChange={(e) => setAdjustForm({ ...adjustForm, ingredientId: e.target.value })}>
              <option value="">เลือกวัตถุดิบ</option>
              {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <input className="input" type="number" value={adjustForm.qty} onChange={(e) => setAdjustForm({ ...adjustForm, qty: e.target.value })} placeholder="+ รับเข้า / - ตัดออก" step="0.001" />
            <input className="input" value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} placeholder="เหตุผล" />
            <button className="btn btn--primary" disabled={isSubmitting}>บันทึกการปรับสต็อก</button>
          </form>
          <div className="movement-list">
            <strong>Movement ล่าสุด</strong>
            {movements.slice(0, 8).map((movement) => (
              <div key={movement.id} className="movement-row">
                <span>
                  {ingredientNameById.get(movement.ingredientId) ?? `สินค้า #${movement.ingredientId}`}
                  <small>{movement.reason}</small>
                </span>
                <strong className={movement.qty >= 0 ? "positive" : "negative"}>{movement.qty >= 0 ? "+" : ""}{movement.qty}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>รับสินค้าเข้า</h2>
              <p className="muted">ทำรายการซื้อและเพิ่มสต็อกทันที</p>
            </div>
          </div>
          <div className="inventory-form-grid inventory-form-grid--compact">
            <input className="input" value={purchaseForm.supplier} onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier: e.target.value })} placeholder="ผู้ขาย/ซัพพลายเออร์" />
            <input className="input" value={purchaseForm.note} onChange={(e) => setPurchaseForm({ ...purchaseForm, note: e.target.value })} placeholder="หมายเหตุ" />
            <select className="input" value={purchaseForm.ingredientId} onChange={(e) => setPurchaseForm({ ...purchaseForm, ingredientId: e.target.value })}>
              <option value="">เลือกวัตถุดิบ</option>
              {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <input className="input" type="number" value={purchaseForm.qty} onChange={(e) => setPurchaseForm({ ...purchaseForm, qty: e.target.value })} placeholder="จำนวน" min="0" step="0.001" />
            <input className="input" type="number" value={purchaseForm.unitCost} onChange={(e) => setPurchaseForm({ ...purchaseForm, unitCost: e.target.value })} placeholder="ต้นทุน" min="0" step="0.01" />
            <button type="button" className="btn btn--ghost" onClick={handleAddPurchaseLine}>เพิ่มรายการ</button>
          </div>
          <div className="purchase-lines">
            {purchaseItems.map((item, index) => (
              <div key={`${item.ingredientId}-${index}`} className="purchase-line">
                <span>{item.ingredientName} · {item.qty} {item.unit}</span>
                <strong>{formatMoney(item.lineTotal ?? item.qty * item.unitCost)}</strong>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--primary" disabled={isSubmitting || !purchaseItems.length} onClick={handleReceivePurchase}>รับสินค้าเข้า</button>
          <div className="movement-list">
            <strong>ประวัติรับเข้า</strong>
            {purchases.slice(0, 5).map((purchase) => (
              <div key={purchase.id} className="movement-row">
                <span>{purchase.supplier || "ไม่ระบุผู้ขาย"}<small>{purchase.itemCount} รายการ</small></span>
                <strong>{formatMoney(purchase.totalCost)}</strong>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
