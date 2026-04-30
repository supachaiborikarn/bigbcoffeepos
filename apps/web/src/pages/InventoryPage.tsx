import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Edit2, EyeOff, PackageCheck, Plus, RotateCcw, Save, Search, X } from "lucide-react";
import {
  createIngredient,
  createMenuItem,
  createPurchase,
  createStockAdjustment,
  deactivateMenuItem,
  getIngredients,
  getInventory,
  getMenu,
  getPurchases,
  getRecipe,
  getRecipeCoverage,
  getStockMovements,
  restoreMenuItem,
  setMenuGroupActive,
  updateInventoryItem,
  updateMenuItem,
  updateRecipe
} from "../api";
import type { Ingredient, InventoryItem, MenuItem, PurchaseOrder, PurchaseOrderItem, RecipeCoverageReport, RecipeCoverageStatus, RecipeIngredient, StockMovement } from "../types";
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

const recipeStatusLabels: Record<RecipeCoverageStatus, string> = {
  has_recipe: "มีสูตร",
  missing_recipe: "ยังไม่มีสูตร",
  not_stock_tracked: "ไม่ตัดสต็อก"
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
  },
  {
    id: "oil-change",
    label: "เปลี่ยนน้ำมัน",
    items: [
      { label: "น้ำมันเครื่อง", qty: 1, keywords: ["น้ำมันเครื่อง", "engine oil", "น้ำมัน"] },
      { label: "ไส้กรองน้ำมันเครื่อง", qty: 1, keywords: ["ไส้กรองน้ำมันเครื่อง", "oil filter", "ไส้กรอง"] }
    ]
  },
  {
    id: "filter-service",
    label: "ไส้กรอง",
    items: [
      { label: "ไส้กรองอากาศ", qty: 1, keywords: ["ไส้กรองอากาศ", "air filter"] },
      { label: "ไส้กรองแอร์", qty: 1, keywords: ["ไส้กรองแอร์", "cabin filter"] }
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
  imageUrl: string;
  unit: string;
  taxRate: string;
  optionGroup: string;
  optionLabel: string;
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

type TabType = "products" | "recipes" | "ingredients" | "movements";

type MenuCardGroup = {
  key: string;
  label: string;
  category: string;
  branchType: MenuItem["branchType"];
  items: MenuItem[];
  hasGroupedVariants: boolean;
  activeCount: number;
  inactiveCount: number;
  minPrice: number;
  maxPrice: number;
};

type MenuCardFormState = {
  label: string;
  category: string;
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
    imageUrl: "",
    unit: "",
    taxRate: "",
    optionGroup: "",
    optionLabel: "",
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
    imageUrl: item.imageUrl ?? "",
    unit: item.unit ?? "",
    taxRate: item.taxRate === null || item.taxRate === undefined ? "" : String(item.taxRate),
    optionGroup: item.optionGroup ?? "",
    optionLabel: item.optionLabel ?? "",
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

function parseInventoryTab(value: string | null): TabType {
  return value === "recipes" || value === "ingredients" || value === "movements" ? value : "products";
}

function getMenuCardKey(item: MenuItem) {
  return item.optionGroup
    ? `group:${item.branchType}:${item.category}:${item.optionGroup}`
    : `item:${item.id}`;
}

function groupMenuCards(items: MenuItem[]) {
  const groups = new Map<string, MenuItem[]>();
  items.forEach((item) => {
    const key = getMenuCardKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return Array.from(groups.entries()).map(([key, variants]) => {
    const sorted = [...variants].sort((a, b) => {
      const aLabel = a.optionLabel ?? a.name;
      const bLabel = b.optionLabel ?? b.name;
      return a.basePrice - b.basePrice || aLabel.localeCompare(bLabel, "th");
    });
    const primary = sorted[0];
    const prices = sorted.map((item) => item.basePrice);
    return {
      key,
      label: primary.optionGroup || primary.name,
      category: primary.category,
      branchType: primary.branchType,
      items: sorted,
      hasGroupedVariants: Boolean(primary.optionGroup),
      activeCount: sorted.filter((item) => item.active).length,
      inactiveCount: sorted.filter((item) => !item.active).length,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices)
    } satisfies MenuCardGroup;
  }).sort((a, b) => a.category.localeCompare(b.category, "th") || a.label.localeCompare(b.label, "th"));
}

function menuCardToForm(group: MenuCardGroup): MenuCardFormState {
  return {
    label: group.label,
    category: group.category
  };
}

function formatPriceRange(group: MenuCardGroup) {
  if (group.minPrice !== group.maxPrice) return `${formatMoney(group.minPrice)}-${formatMoney(group.maxPrice)}`;
  return formatMoney(group.minPrice);
}

export default function InventoryPage() {
  const { activeBranch } = useBranch();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const defaultBranchType = activeBranch?.branchType ?? "coffee";

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
  const [recipeCoverage, setRecipeCoverage] = useState<RecipeCoverageReport | null>(null);

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
  const [selectedMenuCardKey, setSelectedMenuCardKey] = useState<string | null>(null);
  const [menuCardEditForm, setMenuCardEditForm] = useState<MenuCardFormState | null>(null);
  const [variantSourceCardKey, setVariantSourceCardKey] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<MenuItem | null>(null);
  const [productEditForm, setProductEditForm] = useState<ProductFormState | null>(null);

  const [stockSearch, setStockSearch] = useState("");
  const [selectedStock, setSelectedStock] = useState<InventoryItem | null>(null);
  const [stockEditForm, setStockEditForm] = useState<StockFormState | null>(null);

  const [recipeProductSearch, setRecipeProductSearch] = useState("");
  const [recipeIngredientSearch, setRecipeIngredientSearch] = useState("");
  const [recipeStatusFilter, setRecipeStatusFilter] = useState<"all" | RecipeCoverageStatus | "sold_missing">("all");
  const [selectedRecipeProduct, setSelectedRecipeProduct] = useState<MenuItem | null>(null);
  const [recipeLines, setRecipeLines] = useState<RecipeLineForm[]>([]);
  const [isRecipeLoading, setIsRecipeLoading] = useState(false);

  const [activeTab, setActiveTabState] = useState<TabType>(() => parseInventoryTab(searchParams.get("tab")));

  const setActiveTab = (tab: TabType) => {
    setActiveTabState(tab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  const lowStockItems = useMemo(
    () => inventory.filter((item) => item.stockQty <= item.reorderLevel),
    [inventory]
  );

  const branchProducts = useMemo(() => {
    const branchType = activeBranch?.branchType;
    return menu.filter((item) => !branchType || item.branchType === branchType);
  }, [activeBranch?.branchType, menu]);

  const categoryOptions = useMemo(() => {
    const categories = new Set(branchProducts.map((item) => item.category).filter(Boolean));
    return ["ทั้งหมด", ...Array.from(categories).sort((a, b) => a.localeCompare(b, "th"))];
  }, [branchProducts]);

  const menuCardGroups = useMemo(() => groupMenuCards(branchProducts), [branchProducts]);

  const visibleMenuCards = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return menuCardGroups.filter((group) => {
      const searchable = [
        group.label,
        group.category,
        branchTypeLabels[group.branchType],
        ...group.items.flatMap((item) => [item.name, item.optionLabel ?? "", item.sku ?? "", item.barcode ?? ""])
      ].join(" ").toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (productCategory !== "ทั้งหมด" && group.category !== productCategory) return false;
      if (productStatus === "active" && group.activeCount === 0) return false;
      if (productStatus === "inactive" && group.inactiveCount === 0) return false;
      return true;
    });
  }, [menuCardGroups, productCategory, productSearch, productStatus]);

  const productPageCount = Math.max(1, Math.ceil(visibleMenuCards.length / PRODUCT_PAGE_SIZE));
  const paginatedMenuCards = useMemo(() => {
    const start = (productPage - 1) * PRODUCT_PAGE_SIZE;
    return visibleMenuCards.slice(start, start + PRODUCT_PAGE_SIZE);
  }, [productPage, visibleMenuCards]);
  const productStartIndex = visibleMenuCards.length === 0 ? 0 : (productPage - 1) * PRODUCT_PAGE_SIZE + 1;
  const productEndIndex = Math.min(productPage * PRODUCT_PAGE_SIZE, visibleMenuCards.length);
  const selectedMenuCard = useMemo(
    () => selectedMenuCardKey ? menuCardGroups.find((group) => group.key === selectedMenuCardKey) ?? null : null,
    [menuCardGroups, selectedMenuCardKey]
  );
  const variantSourceCard = useMemo(
    () => variantSourceCardKey ? menuCardGroups.find((group) => group.key === variantSourceCardKey) ?? null : null,
    [menuCardGroups, variantSourceCardKey]
  );

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

  const activeProductCount = useMemo(() => branchProducts.filter((item) => item.active).length, [branchProducts]);
  const activeMenuCardCount = useMemo(() => menuCardGroups.filter((group) => group.activeCount > 0).length, [menuCardGroups]);

  const recipeCoverageByMenuId = useMemo(() => {
    const map = new Map<number, RecipeCoverageReport["items"][number]>();
    recipeCoverage?.items.forEach((item) => map.set(item.menuItemId, item));
    return map;
  }, [recipeCoverage]);

  const soldMissingRecipeItems = useMemo(
    () => (recipeCoverage?.items ?? [])
      .filter((item) => item.status === "missing_recipe" && item.soldQty > 0)
      .sort((a, b) => b.soldRevenue - a.soldRevenue)
      .slice(0, 12),
    [recipeCoverage]
  );

  const recipeProducts = useMemo(() => {
    const query = recipeProductSearch.trim().toLowerCase();
    const branchType = activeBranch?.branchType;
    return menu
      .filter((item) => {
        const coverage = recipeCoverageByMenuId.get(item.id);
        if (branchType && item.branchType !== branchType) return false;
        if (!item.active) return false;
        if (recipeStatusFilter === "sold_missing" && !(coverage?.status === "missing_recipe" && (coverage.soldQty ?? 0) > 0)) return false;
        if (recipeStatusFilter !== "all" && recipeStatusFilter !== "sold_missing" && coverage?.status !== recipeStatusFilter) return false;
        if (!query) return true;
        return `${item.name} ${item.category} ${item.sku ?? ""}`.toLowerCase().includes(query);
      })
      .slice(0, 30);
  }, [activeBranch, menu, recipeCoverageByMenuId, recipeProductSearch, recipeStatusFilter]);

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
    const branchType = activeBranch?.branchType;
    const matchesActiveBranch = (item: MenuItem) => !branchType || item.branchType === branchType;
    setMenu(menuItems);
    setIngredients(ingredientItems);
    setSelectedProduct((current) => (current ? menuItems.find((item) => item.id === current.id && matchesActiveBranch(item)) ?? null : null));
    setSelectedRecipeProduct((current) => (current ? menuItems.find((item) => item.id === current.id && matchesActiveBranch(item)) ?? null : null));

    if (!activeBranch) {
      setInventory([]);
      setMovements([]);
      setPurchases([]);
      setRecipeCoverage(null);
      return;
    }

    const [inventoryItems, movementItems, purchaseItemsFromApi, coverageReport] = await Promise.all([
      getInventory(activeBranch.id),
      getStockMovements(activeBranch.id),
      getPurchases(activeBranch.id),
      getRecipeCoverage({ branchId: activeBranch.id })
    ]);
    setInventory(inventoryItems);
    setMovements(movementItems.slice(0, 20));
    setPurchases(purchaseItemsFromApi);
    setRecipeCoverage(coverageReport);
    setSelectedStock((current) => (
      current ? inventoryItems.find((item) => item.ingredientId === current.ingredientId) ?? null : null
    ));
  };

  useEffect(() => {
    setMenuForm((prev) => ({ ...prev, branchType: defaultBranchType }));
  }, [defaultBranchType]);

  useEffect(() => {
    setActiveTabState(parseInventoryTab(searchParams.get("tab")));
  }, [searchParams]);

  useEffect(() => {
    setProductPage(1);
  }, [productCategory, productSearch, productStatus]);

  useEffect(() => {
    setProductPage((current) => Math.min(current, productPageCount));
  }, [productPageCount]);

  useEffect(() => {
    if (selectedMenuCardKey && !menuCardGroups.some((group) => group.key === selectedMenuCardKey)) {
      setSelectedMenuCardKey(null);
      setMenuCardEditForm(null);
      return;
    }
    if (visibleMenuCards.length === 0) {
      setSelectedMenuCardKey(null);
      setMenuCardEditForm(null);
      return;
    }
    if (!selectedMenuCardKey || !visibleMenuCards.some((group) => group.key === selectedMenuCardKey)) {
      setSelectedMenuCardKey(visibleMenuCards[0].key);
    }
  }, [menuCardGroups, selectedMenuCardKey, visibleMenuCards]);

  useEffect(() => {
    setMenuCardEditForm(selectedMenuCard ? menuCardToForm(selectedMenuCard) : null);
  }, [selectedMenuCard?.key]);

  useEffect(() => {
    refreshInventory().catch(() => {});
  }, [activeBranch]);

  const handleAddMenu = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const basePrice = toNumber(menuForm.basePrice);
    const cost = menuForm.cost.trim() ? toNumber(menuForm.cost) : undefined;
    const taxRate = menuForm.taxRate.trim() ? toNumber(menuForm.taxRate) : undefined;
    if (!menuForm.name.trim() || !menuForm.category.trim() || basePrice === null || basePrice < 0) {
      toast.error("กรุณากรอกข้อมูลสินค้าให้ครบ");
      return;
    }
    if (cost === null || (typeof cost === "number" && cost < 0) || taxRate === null || (typeof taxRate === "number" && taxRate < 0)) {
      toast.error("ต้นทุนสินค้าไม่ถูกต้อง");
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createMenuItem({
        name: menuForm.name.trim(),
        category: menuForm.category.trim(),
        basePrice,
        cost,
        sku: menuForm.sku.trim() || undefined,
        barcode: menuForm.barcode.trim() || undefined,
        imageUrl: menuForm.imageUrl.trim() || undefined,
        unit: menuForm.unit.trim() || undefined,
        taxRate,
        optionGroup: menuForm.optionGroup.trim() || undefined,
        optionLabel: menuForm.optionLabel.trim() || undefined,
        branchType: menuForm.branchType
      });
      const variantSourceGroup = variantSourceCardKey ? menuCardGroups.find((group) => group.key === variantSourceCardKey) : null;
      if (
        variantSourceGroup
        && !variantSourceGroup.hasGroupedVariants
        && variantSourceGroup.items.length === 1
        && menuForm.optionGroup.trim()
      ) {
        const sourceItem = variantSourceGroup.items[0];
        await updateMenuItem(sourceItem.id, {
          category: menuForm.category.trim(),
          optionGroup: menuForm.optionGroup.trim(),
          optionLabel: sourceItem.optionLabel || "เดิม"
        });
      }
      setMenuForm(createBlankProductForm(defaultBranchType));
      setVariantSourceCardKey(null);
      setSelectedMenuCardKey(getMenuCardKey(created));
      await refreshInventory();
      toast.success("เพิ่มเมนูสำเร็จ");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProductEditStart = (item: MenuItem) => {
    setSelectedMenuCardKey(getMenuCardKey(item));
    setSelectedProduct(item);
    setProductEditForm(productToForm(item));
  };

  const handleMenuCardSelect = (group: MenuCardGroup) => {
    setSelectedMenuCardKey(group.key);
    setMenuCardEditForm(menuCardToForm(group));
    setSelectedProduct(null);
    setProductEditForm(null);
  };

  const handlePrepareNewMenu = () => {
    setVariantSourceCardKey(null);
    setMenuForm(createBlankProductForm(defaultBranchType));
  };

  const handlePrepareNewVariant = (group: MenuCardGroup) => {
    setVariantSourceCardKey(group.key);
    setMenuForm({
      ...createBlankProductForm(group.branchType),
      name: "",
      category: group.category,
      optionGroup: group.label,
      optionLabel: "",
      branchType: group.branchType,
      active: true
    });
  };

  const handleMenuCardUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedMenuCard || !menuCardEditForm) return;
    const label = menuCardEditForm.label.trim();
    const category = menuCardEditForm.category.trim();
    if (!label || !category) {
      toast.error("กรอกชื่อการ์ดและหมวดหมู่ให้ครบ");
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedItems = await Promise.all(selectedMenuCard.items.map((item) => updateMenuItem(item.id, selectedMenuCard.hasGroupedVariants
        ? { optionGroup: label, category }
        : { name: label, category }
      )));
      setSelectedMenuCardKey(getMenuCardKey(updatedItems[0]));
      await refreshInventory();
      toast.success("บันทึกการ์ดเมนูแล้ว");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetMenuCardActive = async (group: MenuCardGroup, active: boolean) => {
    setIsSubmitting(true);
    try {
      if (group.hasGroupedVariants) {
        await setMenuGroupActive({
          optionGroup: group.label,
          category: group.category,
          branchType: group.branchType,
          active
        });
      } else {
        const item = group.items[0];
        if (active) await restoreMenuItem(item.id);
        else await deactivateMenuItem(item.id);
      }
      await refreshInventory();
      toast.success(active ? "กู้คืนการ์ดเมนูแล้ว" : "ปิดขายการ์ดเมนูแล้ว");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetProductActive = async (item: MenuItem, active: boolean) => {
    setIsSubmitting(true);
    try {
      const updated = active ? await restoreMenuItem(item.id) : await deactivateMenuItem(item.id);
      setSelectedProduct((current) => current?.id === item.id ? updated : current);
      setProductEditForm((current) => selectedProduct?.id === item.id && current ? productToForm(updated) : current);
      await refreshInventory();
      toast.success(active ? "กู้คืนตัวเลือกแล้ว" : "ปิดขายตัวเลือกแล้ว");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
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
      await refreshInventory();
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
    const taxRate = productEditForm.taxRate.trim() ? toNumber(productEditForm.taxRate) : null;
    if (!productEditForm.name.trim() || !productEditForm.category.trim() || basePrice === null || basePrice < 0) {
      toast.error("กรุณากรอกข้อมูลสินค้าให้ครบ");
      return;
    }
    if ((cost !== null && cost < 0) || (taxRate !== null && taxRate < 0)) {
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
        imageUrl: productEditForm.imageUrl.trim() || null,
        unit: productEditForm.unit.trim() || null,
        taxRate,
        optionGroup: productEditForm.optionGroup.trim() || null,
        optionLabel: productEditForm.optionLabel.trim() || null,
        branchType: productEditForm.branchType,
        active: productEditForm.active
      });
      setSelectedProduct(updated);
      setProductEditForm(productToForm(updated));
      setSelectedMenuCardKey(getMenuCardKey(updated));
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
          <h1>เมนูขาย/สต็อก</h1>
          <p className="muted">{activeBranch?.name ?? "ยังไม่ได้เลือกสาขา"} · จัดการการ์ดเมนู ตัวเลือก ราคา และสต็อกวัตถุดิบของสาขา</p>
        </div>
        <div className="inventory-kpis" style={{ display: "flex", gap: "16px", marginTop: "16px" }}>
          <div style={{ flex: 1, background: "var(--bg-surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>การ์ดเมนูเปิดขาย</span>
            <strong style={{ display: "block", fontSize: "28px", color: "var(--text-primary)", marginTop: "4px" }}>{activeMenuCardCount}</strong>
          </div>
          <div style={{ flex: 1, background: "var(--bg-surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>ตัวเลือกเปิดขาย</span>
            <strong style={{ display: "block", fontSize: "28px", color: "var(--text-primary)", marginTop: "4px" }}>{activeProductCount}</strong>
          </div>
          <div style={{ flex: 1, background: "var(--bg-surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>แจ้งเตือนสต็อกต่ำ</span>
            <strong className={lowStockItems.length ? "negative" : "positive"} style={{ display: "block", fontSize: "28px", color: lowStockItems.length > 0 ? "var(--warning)" : "var(--success)", marginTop: "4px" }}>{lowStockItems.length}</strong>
          </div>
        </div>
      </section>

      {/* TABS */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", borderBottom: "1px solid var(--border)", paddingBottom: "16px" }}>
        <button 
          className={`btn ${activeTab === "products" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setActiveTab("products")}
          style={{ borderRadius: "20px", padding: "8px 16px" }}
        >
          สินค้า & เมนูขาย
        </button>
        <button 
          className={`btn ${activeTab === "recipes" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setActiveTab("recipes")}
          style={{ borderRadius: "20px", padding: "8px 16px" }}
        >
          สูตรส่วนผสม
        </button>
        <button 
          className={`btn ${activeTab === "ingredients" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setActiveTab("ingredients")}
          style={{ borderRadius: "20px", padding: "8px 16px" }}
        >
          สต็อกวัตถุดิบ
        </button>
        <button 
          className={`btn ${activeTab === "movements" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setActiveTab("movements")}
          style={{ borderRadius: "20px", padding: "8px 16px" }}
        >
          เข้า/ออกสต็อก
        </button>
      </div>

      {/* PRODUCTS TAB */}
      {activeTab === "products" && (
        <section className="inventory-layout" style={{ animation: "slideUp 0.2s ease-out" }}>
          <section className="panel inventory-product-panel" style={{ flex: 2, minWidth: 0 }}>
            <div className="panel__header">
              <div>
                <h2>การ์ดเมนูขาย</h2>
                <p className="muted">จัดการการ์ดที่แสดงบนหน้า POS และตัวเลือกภายในแต่ละการ์ด</p>
              </div>
              <div className="row-actions" style={{ alignItems: "center", gap: 8 }}>
                <button type="button" className="btn btn--ghost" onClick={handlePrepareNewMenu}>
                  <Plus size={16} />
                  เพิ่มเมนู
                </button>
                <span className="badge">{visibleMenuCards.length} การ์ด</span>
              </div>
            </div>

            <div className="inventory-toolbar">
              <label className="inventory-search">
                <Search size={16} />
                <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="ค้นหาการ์ด / ตัวเลือก / SKU / บาร์โค้ด" />
              </label>
              <select className="input" value={productCategory} onChange={(e) => setProductCategory(e.target.value)}>
                {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <select className="input" value={productStatus} onChange={(e) => setProductStatus(e.target.value as typeof productStatus)}>
                <option value="all">ทุกสถานะ</option>
                <option value="active">เปิดขาย</option>
                <option value="inactive">มีรายการปิดขาย</option>
              </select>
            </div>

            <div className="menu-card-manager">
              {paginatedMenuCards.map((group) => {
                const isInactive = group.activeCount === 0;
                const isSelected = selectedMenuCardKey === group.key;
                const statusText = isInactive ? "ปิดขาย" : group.inactiveCount > 0 ? "เปิดบางส่วน" : "เปิดขาย";
                return (
                  <div key={group.key} className={`menu-manager-card ${isSelected ? "is-selected" : ""} ${isInactive ? "is-inactive" : ""}`}>
                    <button type="button" className="menu-manager-card__main" onClick={() => handleMenuCardSelect(group)}>
                      <span className="menu-manager-card__top">
                        <strong>{group.label}</strong>
                        <span className={`status-badge ${isInactive ? "status-badge--inactive" : "status-badge--active"}`}>{statusText}</span>
                      </span>
                      <small>{group.category} · {branchTypeLabels[group.branchType]} · {group.items.length} ตัวเลือก</small>
                      <span className="menu-manager-card__price">{formatPriceRange(group)}</span>
                    </button>
                    <div className="menu-manager-card__actions">
                      <button type="button" className="icon-action" onClick={() => handlePrepareNewVariant(group)} aria-label={`เพิ่มตัวเลือก ${group.label}`}>
                        <Plus size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action"
                        onClick={() => handleSetMenuCardActive(group, isInactive)}
                        disabled={isSubmitting}
                        aria-label={isInactive ? `กู้คืน ${group.label}` : `ปิดขาย ${group.label}`}
                      >
                        {isInactive ? <RotateCcw size={16} /> : <EyeOff size={16} />}
                      </button>
                    </div>
                  </div>
                );
              })}
              {visibleMenuCards.length === 0 && <div className="empty">ไม่พบการ์ดเมนู</div>}
            </div>

            {visibleMenuCards.length > 0 && (
              <div className="inventory-pagination">
                <span>แสดง {productStartIndex}-{productEndIndex} จาก {visibleMenuCards.length} การ์ด</span>
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

            {selectedMenuCard && menuCardEditForm && (
              <div className="menu-card-detail">
                <form className="inventory-editor menu-card-editor" onSubmit={handleMenuCardUpdate}>
                  <div className="inventory-editor__header">
                    <div>
                      <h3>แก้ไขการ์ดเมนู</h3>
                      <p className="muted">{selectedMenuCard.label} · {selectedMenuCard.items.length} ตัวเลือก</p>
                    </div>
                    <button type="button" className="btn btn--ghost" onClick={() => handlePrepareNewVariant(selectedMenuCard)}>
                      <Plus size={16} />
                      เพิ่มตัวเลือก
                    </button>
                  </div>
                  <div className="inventory-form-grid">
                    <input className="input" value={menuCardEditForm.label} onChange={(e) => setMenuCardEditForm({ ...menuCardEditForm, label: e.target.value })} placeholder="ชื่อการ์ดเมนู" />
                    <input className="input" value={menuCardEditForm.category} onChange={(e) => setMenuCardEditForm({ ...menuCardEditForm, category: e.target.value })} placeholder="หมวดหมู่" />
                    <div className="menu-card-preview" aria-label="ตัวอย่างการ์ดเมนู">
                      <span>{selectedMenuCard.items.length} ตัวเลือก</span>
                      <strong>{menuCardEditForm.label || selectedMenuCard.label}</strong>
                      <b>{formatPriceRange(selectedMenuCard)}</b>
                    </div>
                  </div>
                  <div className="inventory-editor__actions">
                    <button
                      type="button"
                      className={`btn ${selectedMenuCard.activeCount === 0 ? "btn--ghost" : "btn--danger"}`}
                      onClick={() => handleSetMenuCardActive(selectedMenuCard, selectedMenuCard.activeCount === 0)}
                      disabled={isSubmitting}
                    >
                      {selectedMenuCard.activeCount === 0 ? <RotateCcw size={16} /> : <EyeOff size={16} />}
                      {selectedMenuCard.activeCount === 0 ? "กู้คืนการ์ด" : "ปิดขายการ์ด"}
                    </button>
                    <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
                      <Save size={16} />
                      บันทึกการ์ด
                    </button>
                  </div>
                </form>

                <div className="inventory-table-wrap menu-variant-table">
                  <table className="inventory-table">
                    <thead>
                      <tr>
                        <th>ตัวเลือก</th>
                        <th>SKU / Barcode</th>
                        <th>ราคา</th>
                        <th>ต้นทุน</th>
                        <th>สถานะ</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedMenuCard.items.map((item) => (
                        <tr key={item.id} className={selectedProduct?.id === item.id ? "is-selected" : ""}>
                          <td>
                            <strong>{item.optionLabel || item.name}</strong>
                            <small>#{item.id} · {item.name}</small>
                          </td>
                          <td>
                            <span>{item.sku || "-"}</span>
                            <small>{item.barcode || "ไม่มีบาร์โค้ด"}</small>
                          </td>
                          <td>{formatMoney(item.basePrice)}</td>
                          <td>{item.cost === null || item.cost === undefined ? "-" : formatMoney(item.cost)}</td>
                          <td><span className={`status-badge ${item.active ? "status-badge--active" : "status-badge--inactive"}`}>{item.active ? "เปิดขาย" : "ปิดขาย"}</span></td>
                          <td>
                            <div className="row-actions">
                              <button type="button" className="icon-action" onClick={() => handleProductEditStart(item)} aria-label={`แก้ไข ${item.name}`}>
                                <Edit2 size={16} />
                              </button>
                              <button type="button" className="icon-action" onClick={() => { void handleRecipeProductSelect(item); setActiveTab("recipes"); }} aria-label={`ตั้งสูตร ${item.name}`}>
                                <PackageCheck size={16} />
                              </button>
                              <button
                                type="button"
                                className="icon-action"
                                onClick={() => handleSetProductActive(item, !item.active)}
                                disabled={isSubmitting}
                                aria-label={item.active ? `ปิดขาย ${item.name}` : `กู้คืน ${item.name}`}
                              >
                                {item.active ? <EyeOff size={16} /> : <RotateCcw size={16} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedProduct && productEditForm && (
              <div
                className="modal-backdrop inventory-edit-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget && !isSubmitting) handleProductEditCancel();
                }}
              >
                <form
                  className="modal inventory-edit-modal"
                  onSubmit={handleProductUpdate}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="product-edit-title"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="inventory-editor__header">
                    <div>
                      <h3 id="product-edit-title">แก้ไขตัวเลือก</h3>
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
                    <input className="input" value={productEditForm.imageUrl} onChange={(e) => setProductEditForm({ ...productEditForm, imageUrl: e.target.value })} placeholder="URL รูปสินค้า" />
                    <input className="input" value={productEditForm.unit} onChange={(e) => setProductEditForm({ ...productEditForm, unit: e.target.value })} placeholder="หน่วยขาย เช่น แก้ว / ชิ้น" />
                    <input className="input" type="number" value={productEditForm.taxRate} onChange={(e) => setProductEditForm({ ...productEditForm, taxRate: e.target.value })} placeholder="ภาษี %" min="0" step="0.01" />
                    <input className="input" value={productEditForm.optionGroup} onChange={(e) => setProductEditForm({ ...productEditForm, optionGroup: e.target.value })} placeholder="ชื่อการ์ด เช่น ลาเต้" />
                    <input className="input" value={productEditForm.optionLabel} onChange={(e) => setProductEditForm({ ...productEditForm, optionLabel: e.target.value })} placeholder="ชื่อตัวเลือก เช่น เย็น / ปั่น" />
                    <select className="input" value={productEditForm.branchType} onChange={(e) => setProductEditForm({ ...productEditForm, branchType: e.target.value as MenuItem["branchType"] })} style={{ display: "none" }}>
                      <option value="coffee">ร้านกาแฟ</option>
                      <option value="oil_service">ศูนย์บริการน้ำมัน</option>
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
                      บันทึกตัวเลือก
                    </button>
                  </div>
                </form>
              </div>
            )}
          </section>

          <form onSubmit={handleAddMenu} className="panel" style={{ flex: 1, height: "fit-content" }}>
            <div className="panel__header">
              <div>
                <h2>{variantSourceCard ? "เพิ่มตัวเลือก" : "เพิ่มเมนูใหม่"}</h2>
                <p className="muted">{variantSourceCard ? `เพิ่มตัวเลือกใน ${variantSourceCard.label}` : "สร้างการ์ดใหม่หรือสินค้าเดี่ยวเพื่อขายในหน้า POS"}</p>
              </div>
              <div className="row-actions">
                {variantSourceCard && (
                  <button type="button" className="icon-action" onClick={handlePrepareNewMenu} aria-label="กลับไปเพิ่มเมนูใหม่">
                    <X size={16} />
                  </button>
                )}
                <Plus size={18} />
              </div>
            </div>
            <div className="inventory-form-grid inventory-form-grid--compact">
              <input className="input" value={menuForm.name} onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })} placeholder="ชื่อสินค้า (เช่น ลาเต้เย็น)" />
              <input className="input" value={menuForm.category} onChange={(e) => setMenuForm({ ...menuForm, category: e.target.value })} placeholder="หมวดหมู่ (เช่น กาแฟ)" />
              <input className="input" type="number" value={menuForm.basePrice} onChange={(e) => setMenuForm({ ...menuForm, basePrice: e.target.value })} placeholder="ราคาขาย" min="0" step="0.01" />
              <input className="input" type="number" value={menuForm.cost} onChange={(e) => setMenuForm({ ...menuForm, cost: e.target.value })} placeholder="ต้นทุนอ้างอิง" min="0" step="0.01" />
              <input className="input" value={menuForm.optionGroup} onChange={(e) => setMenuForm({ ...menuForm, optionGroup: e.target.value })} placeholder="ชื่อการ์ดเมนู" />
              <input className="input" value={menuForm.optionLabel} onChange={(e) => setMenuForm({ ...menuForm, optionLabel: e.target.value })} placeholder="ชื่อตัวเลือก เช่น เย็น / ปั่น" />
              <input className="input" value={menuForm.sku} onChange={(e) => setMenuForm({ ...menuForm, sku: e.target.value })} placeholder="SKU" />
              <input className="input" value={menuForm.barcode} onChange={(e) => setMenuForm({ ...menuForm, barcode: e.target.value })} placeholder="บาร์โค้ด" />
              <input className="input" value={menuForm.imageUrl} onChange={(e) => setMenuForm({ ...menuForm, imageUrl: e.target.value })} placeholder="URL รูปสินค้า" />
              <input className="input" value={menuForm.unit} onChange={(e) => setMenuForm({ ...menuForm, unit: e.target.value })} placeholder="หน่วยขาย เช่น แก้ว / ชิ้น" />
              <input className="input" type="number" value={menuForm.taxRate} onChange={(e) => setMenuForm({ ...menuForm, taxRate: e.target.value })} placeholder="ภาษี %" min="0" step="0.01" />
              <select className="input" value={menuForm.branchType} onChange={(e) => setMenuForm({ ...menuForm, branchType: e.target.value as MenuItem["branchType"] })} style={{ display: "none" }}>
                <option value="coffee">ร้านกาแฟ</option>
                <option value="oil_service">ศูนย์บริการน้ำมัน</option>
              </select>
            </div>
            <button type="submit" className="btn btn--primary" disabled={isSubmitting} style={{ marginTop: 16, width: "100%" }}>
              <PackageCheck size={16} />
              บันทึกเมนู
            </button>
          </form>
        </section>
      )}

      {/* RECIPES TAB */}
      {activeTab === "recipes" && (
        <section className="panel recipe-builder-panel" style={{ animation: "slideUp 0.2s ease-out" }}>
        <div className="panel__header">
          <div>
            <h2>สูตรตัดสต็อกเมนูกาแฟ</h2>
            <p className="muted">กำหนดวัตถุดิบที่จะถูกตัดทุกครั้งที่ขายเมนูนี้</p>
          </div>
          {selectedRecipeProduct && <span className="badge">{recipeSummary.length} รายการในสูตร</span>}
        </div>

        {recipeCoverage && (
          <div style={{ padding: "0 24px 20px", display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: "var(--bg-surface)" }}>
                <span className="muted">มีสูตรแล้ว</span>
                <strong style={{ display: "block", fontSize: 24, marginTop: 4 }}>{recipeCoverage.summary.hasRecipe}</strong>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: "var(--bg-surface)" }}>
                <span className="muted">ยังไม่มีสูตร</span>
                <strong style={{ display: "block", fontSize: 24, marginTop: 4 }}>{recipeCoverage.summary.missingRecipe}</strong>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: "var(--bg-surface)" }}>
                <span className="muted">ขายแล้วแต่ยังไม่มีสูตร</span>
                <strong className={recipeCoverage.summary.soldMissingRecipe ? "negative" : "positive"} style={{ display: "block", fontSize: 24, marginTop: 4 }}>{recipeCoverage.summary.soldMissingRecipe}</strong>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 14, background: "var(--bg-surface)" }}>
                <span className="muted">ยอดที่ยังไม่ตัดสต็อก</span>
                <strong style={{ display: "block", fontSize: 24, marginTop: 4 }}>{formatMoney(recipeCoverage.summary.soldMissingRecipeRevenue)}</strong>
              </div>
            </div>

            {soldMissingRecipeItems.length > 0 && (
              <div style={{ border: "1px solid var(--warning-bg)", borderRadius: 8, background: "var(--warning-bg)", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <AlertTriangle size={16} />
                  <strong>เมนูที่ขายแล้วแต่ยังตัดสต็อกไม่ได้</strong>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {soldMissingRecipeItems.map((item) => (
                    <button
                      type="button"
                      key={item.menuItemId}
                      className="stock-row"
                      onClick={() => {
                        const menuItem = menu.find((candidate) => candidate.id === item.menuItemId);
                        if (menuItem) handleRecipeProductSelect(menuItem);
                      }}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.category} · ขาย {item.soldQty.toLocaleString("th-TH")} รายการ</small>
                      </span>
                      <span className="negative">{formatMoney(item.soldRevenue)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="recipe-builder">
          <div className="recipe-products">
            <label className="inventory-search">
              <Search size={16} />
              <input value={recipeProductSearch} onChange={(e) => setRecipeProductSearch(e.target.value)} placeholder="ค้นหาเมนูขาย" />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {([
                ["all", "ทั้งหมด"],
                ["missing_recipe", "ยังไม่มีสูตร"],
                ["sold_missing", "ขายแล้วแต่ไม่มีสูตร"],
                ["has_recipe", "มีสูตรแล้ว"]
              ] as [typeof recipeStatusFilter, string][]).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`btn ${recipeStatusFilter === value ? "btn--primary" : "btn--ghost"}`}
                  onClick={() => setRecipeStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="recipe-product-list">
              {recipeProducts.map((item) => {
                const coverage = recipeCoverageByMenuId.get(item.id);
                const status = coverage?.status ?? "missing_recipe";
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`recipe-product-row ${selectedRecipeProduct?.id === item.id ? "is-selected" : ""}`}
                    onClick={() => handleRecipeProductSelect(item)}
                  >
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.category} · {formatMoney(item.basePrice)} · {recipeStatusLabels[status]}</small>
                    </span>
                    <span className={`status-badge ${status === "has_recipe" ? "status-badge--active" : "status-badge--inactive"}`}>
                      {coverage?.recipeIngredientCount ?? 0}
                    </span>
                  </button>
                );
              })}
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
      )}

      {/* INGREDIENTS TAB */}
      {activeTab === "ingredients" && (
        <section className="inventory-layout" style={{ animation: "slideUp 0.2s ease-out" }}>
          <section className="panel inventory-stock-panel" style={{ flex: 2 }}>
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

          <form onSubmit={handleAddIngredient} className="panel" style={{ flex: 1, height: "fit-content" }}>
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
            <button type="submit" className="btn btn--primary" disabled={isSubmitting} style={{ marginTop: 16, width: "100%" }}>บันทึกวัตถุดิบ</button>
          </form>
        </section>
      )}

      {/* MOVEMENTS TAB */}
      {activeTab === "movements" && (
        <section className="inventory-layout" style={{ animation: "slideUp 0.2s ease-out" }}>
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>ปรับสต็อก</h2>
                <p className="muted">รับเข้า/ตัดออกแบบ manual พร้อม movement log</p>
              </div>
            </div>
            <div className="panel__body">
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
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>รับสินค้าเข้า</h2>
                <p className="muted">ทำรายการซื้อและเพิ่มสต็อกทันที</p>
              </div>
            </div>
            <div className="panel__body">
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
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
