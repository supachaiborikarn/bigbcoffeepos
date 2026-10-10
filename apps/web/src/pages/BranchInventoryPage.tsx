import { useEffect, useState } from "react";
import { Package, Search } from "lucide-react";
import { getMenu } from "../api";
import type { MenuItem } from "../types";
import { useBranch } from "../contexts/BranchContext";
import { businessProfile } from "../utils/business";
import StockManager from "../components/inventory/StockManager";

export default function BranchInventoryPage() {
  const { activeBranch } = useBranch();
  const profile = businessProfile(activeBranch?.branchType);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [tab, setTab] = useState<"stock" | "menu">("stock");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (tab !== "menu" || menu.length) return;
    let cancelled = false;
    getMenu().then((products) => { if (!cancelled) setMenu(products); }).catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [tab, menu.length]);
  const products = menu.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return <main className="studio-inventory">
    <div className="studio-page-heading"><div><span className="studio-eyebrow">INVENTORY</span><h1>{profile.catalogTitle}</h1><p>{activeBranch?.name}</p></div><Package size={30} strokeWidth={1.4} /></div>
    <div className="studio-inventory-toolbar"><div className="studio-tabs"><button className={tab === "stock" ? "is-active" : ""} onClick={() => setTab("stock")}>สต็อกสาขา</button><button className={tab === "menu" ? "is-active" : ""} onClick={() => setTab("menu")}>รายการขาย</button></div>{tab === "menu" && <label className="studio-search"><Search size={18} /><input aria-label="ค้นหารายการขาย" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อสินค้า" /></label>}</div>
    {tab === "stock" ? <StockManager canEditDetails={false} /> : <>
      {error && <p role="alert">{error}</p>}
      <div className="studio-stock-table"><p className="studio-catalog-help">รายการขายใช้ข้อมูลส่วนกลาง หากต้องการแก้ชื่อหรือราคาให้ติดต่อผู้ดูแลระบบ</p>{products.map((item) => <div className="studio-stock-row" key={item.id}><span><strong>{item.name}</strong><small>{item.category}</small></span><strong>฿{item.basePrice.toLocaleString("th-TH")}</strong><span>{item.active ? "เปิดขาย" : "ปิดขาย"}</span></div>)}</div>
    </>}
  </main>;
}
