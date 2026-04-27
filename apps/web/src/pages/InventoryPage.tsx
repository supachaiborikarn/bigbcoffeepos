import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createIngredient,
  createMenuItem,
  createPurchase,
  createStockAdjustment,
  getIngredients,
  getInventory,
  getMenu,
  getPurchases,
  getStockMovements
} from "../api";
import type { Ingredient, InventoryItem, MenuItem, PurchaseOrder, PurchaseOrderItem, StockMovement } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";

const moneyFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

export default function InventoryPage() {
  const { activeBranch } = useBranch();
  const toast = useToast();

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);

  const [menuForm, setMenuForm] = useState({ name: "", category: "", basePrice: "", sku: "", barcode: "" });
  const [ingredientForm, setIngredientForm] = useState({ name: "", unit: "ชิ้น", costPerUnit: "", stockQty: "", reorderLevel: "" });
  const [adjustForm, setAdjustForm] = useState({ ingredientId: "", qty: "", reason: "ADJUSTMENT" });
  const [purchaseForm, setPurchaseForm] = useState({ supplier: "", note: "", ingredientId: "", qty: "", unitCost: "" });
  const [purchaseItems, setPurchaseItems] = useState<PurchaseOrderItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const lowStockItems = useMemo(
    () => inventory.filter((item) => item.stockQty <= item.reorderLevel),
    [inventory]
  );

  const refreshInventory = async () => {
    const [menuItems, ingredientItems] = await Promise.all([getMenu(), getIngredients()]);
    setMenu(menuItems);
    setIngredients(ingredientItems);

    if (activeBranch) {
      const [inventoryItems, movementItems, purchaseItemsFromApi] = await Promise.all([
        getInventory(activeBranch.id),
        getStockMovements(activeBranch.id),
        getPurchases(activeBranch.id)
      ]);
      setInventory(inventoryItems);
      setMovements(movementItems.slice(0, 20));
      setPurchases(purchaseItemsFromApi);
    }
  };

  useEffect(() => {
    refreshInventory().catch(() => {});
  }, [activeBranch]);

  const handleAddMenu = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!menuForm.name || !menuForm.category || !menuForm.basePrice) {
      toast.error("กรุณากรอกข้อมูลสินค้าให้ครบ");
      return;
    }

    setIsSubmitting(true);
    try {
      await createMenuItem({
        name: menuForm.name,
        category: menuForm.category,
        basePrice: Number(menuForm.basePrice),
        sku: menuForm.sku || undefined,
        barcode: menuForm.barcode || undefined
      });
      setMenuForm({ name: "", category: "", basePrice: "", sku: "", barcode: "" });
      await refreshInventory();
      toast.success("เพิ่มสินค้าสำเร็จ");
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
    <main className="app__grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>สินค้า & วัตถุดิบ</h2>
            <p className="muted">เพิ่มเมนูขายและตั้งต้นวัตถุดิบ</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, padding: "24px" }}>
          <form onSubmit={handleAddMenu} className="panel" style={{ display: "grid", gap: 12, padding: 16 }}>
            <strong>เพิ่มสินค้าใหม่</strong>
            <input className="input" value={menuForm.name} onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })} placeholder="ชื่อสินค้า" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input className="input" value={menuForm.category} onChange={(e) => setMenuForm({ ...menuForm, category: e.target.value })} placeholder="หมวดหมู่" />
              <input className="input" type="number" value={menuForm.basePrice} onChange={(e) => setMenuForm({ ...menuForm, basePrice: e.target.value })} placeholder="ราคาขาย" />
              <input className="input" value={menuForm.sku} onChange={(e) => setMenuForm({ ...menuForm, sku: e.target.value })} placeholder="SKU" />
              <input className="input" value={menuForm.barcode} onChange={(e) => setMenuForm({ ...menuForm, barcode: e.target.value })} placeholder="บาร์โค้ด" />
            </div>
            <button type="submit" className="btn btn--primary" disabled={isSubmitting}>บันทึกสินค้า</button>
          </form>

          <form onSubmit={handleAddIngredient} className="panel" style={{ display: "grid", gap: 12, padding: 16 }}>
            <strong>เพิ่มวัตถุดิบ / สต็อกตั้งต้น</strong>
            <input className="input" value={ingredientForm.name} onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })} placeholder="ชื่อวัตถุดิบ" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input className="input" value={ingredientForm.unit} onChange={(e) => setIngredientForm({ ...ingredientForm, unit: e.target.value })} placeholder="หน่วย" />
              <input className="input" type="number" value={ingredientForm.costPerUnit} onChange={(e) => setIngredientForm({ ...ingredientForm, costPerUnit: e.target.value })} placeholder="ต้นทุน/หน่วย" />
              <input className="input" type="number" value={ingredientForm.stockQty} onChange={(e) => setIngredientForm({ ...ingredientForm, stockQty: e.target.value })} placeholder="จำนวนตั้งต้น" />
              <input className="input" type="number" value={ingredientForm.reorderLevel} onChange={(e) => setIngredientForm({ ...ingredientForm, reorderLevel: e.target.value })} placeholder="จุดสั่งซื้อ" />
            </div>
            <button type="submit" className="btn btn--ghost" disabled={isSubmitting}>บันทึกวัตถุดิบ</button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>สต็อกสาขา</h2>
            <p className="muted">{activeBranch?.name} · ต่ำกว่าเกณฑ์ {lowStockItems.length} รายการ</p>
          </div>
        </div>
        <div style={{ padding: "0 24px 24px" }}>
          {inventory.map((item) => (
            <div key={item.ingredientId} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div>
                <strong>{item.name}</strong>
                <div className="muted" style={{ fontSize: "12px" }}>
                  จุดสั่งซื้อ: {item.reorderLevel} {item.unit} · ต้นทุน {formatMoney(item.costPerUnit)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong style={{ color: item.stockQty <= item.reorderLevel ? "#b5482b" : "inherit" }}>
                  {item.stockQty}
                </strong>
                <span className="muted" style={{ marginLeft: "4px" }}>{item.unit}</span>
              </div>
            </div>
          ))}
          {inventory.length === 0 && <div className="empty">ไม่มีข้อมูลสต็อก</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>ปรับสต็อก</h2>
            <p className="muted">รับเข้า/ตัดออกแบบ manual พร้อม movement log</p>
          </div>
        </div>
        <form onSubmit={handleStockAdjust} style={{ display: "grid", gap: 12, padding: "24px" }}>
          <select className="input" value={adjustForm.ingredientId} onChange={(e) => setAdjustForm({ ...adjustForm, ingredientId: e.target.value })}>
            <option value="">เลือกวัตถุดิบ</option>
            {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <input className="input" type="number" value={adjustForm.qty} onChange={(e) => setAdjustForm({ ...adjustForm, qty: e.target.value })} placeholder="+ รับเข้า / - ตัดออก" />
            <input className="input" value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} placeholder="เหตุผล" />
          </div>
          <button className="btn btn--primary" disabled={isSubmitting}>บันทึกการปรับสต็อก</button>
        </form>
        <div style={{ padding: "0 24px 24px" }}>
          <strong>Movement ล่าสุด</strong>
          {movements.slice(0, 8).map((movement) => (
            <div key={movement.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <span className="muted">{movement.reason}</span>
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
        <div style={{ display: "grid", gap: 12, padding: "24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <input className="input" value={purchaseForm.supplier} onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier: e.target.value })} placeholder="ผู้ขาย/ซัพพลายเออร์" />
            <input className="input" value={purchaseForm.note} onChange={(e) => setPurchaseForm({ ...purchaseForm, note: e.target.value })} placeholder="หมายเหตุ" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 110px auto", gap: 8 }}>
            <select className="input" value={purchaseForm.ingredientId} onChange={(e) => setPurchaseForm({ ...purchaseForm, ingredientId: e.target.value })}>
              <option value="">เลือกวัตถุดิบ</option>
              {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <input className="input" type="number" value={purchaseForm.qty} onChange={(e) => setPurchaseForm({ ...purchaseForm, qty: e.target.value })} placeholder="จำนวน" />
            <input className="input" type="number" value={purchaseForm.unitCost} onChange={(e) => setPurchaseForm({ ...purchaseForm, unitCost: e.target.value })} placeholder="ต้นทุน" />
            <button className="btn btn--ghost" onClick={handleAddPurchaseLine}>เพิ่ม</button>
          </div>
          {purchaseItems.map((item, index) => (
            <div key={`${item.ingredientId}-${index}`} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
              <span>{item.ingredientName} · {item.qty} {item.unit}</span>
              <strong>{formatMoney(item.lineTotal ?? item.qty * item.unitCost)}</strong>
            </div>
          ))}
          <button className="btn btn--primary" disabled={isSubmitting || !purchaseItems.length} onClick={handleReceivePurchase}>รับสินค้าเข้า</button>
        </div>
        <div style={{ padding: "0 24px 24px" }}>
          <strong>ประวัติรับเข้า</strong>
          {purchases.slice(0, 5).map((purchase) => (
            <div key={purchase.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <span>{purchase.supplier || "ไม่ระบุผู้ขาย"} · {purchase.itemCount} รายการ</span>
              <strong>{formatMoney(purchase.totalCost)}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
