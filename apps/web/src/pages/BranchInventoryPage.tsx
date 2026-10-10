import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Package, Search, X, SlidersHorizontal } from "lucide-react";
import { getInventory, getMenu, updateInventoryItem } from "../api";
import type { InventoryItem, MenuItem } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";
import { businessProfile } from "../utils/business";

export default function BranchInventoryPage() {
  const { activeBranch } = useBranch();
  const toast = useToast();
  const profile = businessProfile(activeBranch?.branchType);
  const [stock, setStock] = useState<InventoryItem[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [tab, setTab] = useState<"stock" | "menu">("stock");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reorder, setReorder] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([getInventory(activeBranch!.id), getMenu()]).then(([items, products]) => {
      if (!cancelled) { setStock(items); setMenu(products); }
    }).catch((err) => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeBranch?.id]);
  const low = stock.filter((item) => item.reorderLevel > 0 && item.stockQty <= item.reorderLevel);
  const visible = useMemo(() => stock.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()) && (!lowOnly || low.includes(item))), [stock, search, lowOnly]);
  const products = menu.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  async function save() {
    if (!edit || saving) return;
    const stockQty = Number(quantity), reorderLevel = Number(reorder);
    if (!quantity.trim() || !reorder.trim() || !Number.isFinite(stockQty) || !Number.isFinite(reorderLevel) || stockQty < 0 || reorderLevel < 0) return toast.error("กรอกจำนวนตั้งแต่ 0 ขึ้นไป");
    setSaving(true);
    try {
      const updated = await updateInventoryItem(edit.ingredientId, { branchId: activeBranch!.id, stockQty, reorderLevel });
      setStock((items) => items.map((item) => item.ingredientId === updated.ingredientId ? updated : item));
      setEdit(null);
      toast.success("บันทึกสต็อกของสาขานี้แล้ว");
    } catch (err) { toast.error((err as Error).message); } finally { setSaving(false); }
  }
  return <main className="studio-inventory">
    <div className="studio-page-heading"><div><span className="studio-eyebrow">INVENTORY</span><h1>{profile.catalogTitle}</h1><p>{activeBranch?.name}</p></div><Package size={30} strokeWidth={1.4} /></div>
    <div className="studio-kpi-grid"><div><span>รายการในสต็อก</span><strong>{stock.length}</strong></div><div><span>สินค้าเปิดขาย</span><strong>{menu.filter((item) => item.active).length}</strong></div><button onClick={() => { setTab("stock"); setLowOnly((v) => !v); }} aria-pressed={lowOnly}><span><AlertTriangle size={14} /> ถึงจุดสั่งซื้อ</span><strong>{low.length}</strong></button></div>
    <div className="studio-inventory-toolbar"><div className="studio-tabs"><button className={tab === "stock" ? "is-active" : ""} onClick={() => setTab("stock")}>สต็อกสาขา</button><button className={tab === "menu" ? "is-active" : ""} onClick={() => setTab("menu")}>รายการขาย</button></div><label className="studio-search"><Search size={18} /><input aria-label="ค้นหาในสต็อก" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อสินค้า" /></label></div>
    {error && <p role="alert">{error}</p>}
    {loading ? <div className="empty">กำลังโหลดข้อมูล...</div> : <div className="studio-stock-table">
      {tab === "stock" ? <><div className="studio-stock-row studio-stock-header"><span>สินค้า / วัตถุดิบ</span><span>คงเหลือ</span><span>จุดสั่งซื้อ</span><span /></div>{visible.map((item) => <div className="studio-stock-row" key={item.ingredientId}><span><strong>{item.name}</strong><small>{item.unit}</small></span><strong className={low.includes(item) ? "negative" : ""}>{item.stockQty.toLocaleString("th-TH")}</strong><span>{item.reorderLevel.toLocaleString("th-TH")}</span><button className="studio-icon-button" aria-label={`ปรับสต็อก ${item.name}`} onClick={() => { setEdit(item); setQuantity(String(item.stockQty)); setReorder(String(item.reorderLevel)); }}><SlidersHorizontal size={17} /></button></div>)}{!visible.length && <div className="empty">ไม่มีรายการสต็อกที่ตรงกับเงื่อนไข</div>}</> : <><p className="studio-catalog-help">รายการขายใช้ข้อมูลส่วนกลาง หากต้องการแก้ชื่อหรือราคาให้ติดต่อผู้ดูแลระบบ</p>{products.map((item) => <div className="studio-stock-row" key={item.id}><span><strong>{item.name}</strong><small>{item.category}</small></span><strong>฿{item.basePrice.toLocaleString("th-TH")}</strong><span>{item.active ? "เปิดขาย" : "ปิดขาย"}</span></div>)}</>}
    </div>}
    {edit && <div className="modal-backdrop" onClick={() => !saving && setEdit(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="ปรับสต็อก" onClick={(e) => e.stopPropagation()}><div className="modal__header"><div><h2>{edit.name}</h2><p className="muted">{activeBranch?.name}</p></div><button className="studio-icon-button" onClick={() => setEdit(null)} disabled={saving} aria-label="ปิด"><X size={18} /></button></div><label className="studio-payment-reference">ยอดคงเหลือจริง ({edit.unit})<input autoFocus className="input" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label><label className="studio-payment-reference">แจ้งเตือนเมื่อเหลือ<input className="input" type="number" min="0" step="any" value={reorder} onChange={(e) => setReorder(e.target.value)} /></label><button className="btn btn--primary btn--full" onClick={save} disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึกสต็อก"}</button></div></div>}
  </main>;
}
