import { useMemo } from "react";
import type { MenuItem } from "../../types";
import ProductCard from "./ProductCard";

const PRODUCT_RENDER_LIMIT = 120;

interface ProductGridProps {
  menu: MenuItem[];
  category: string;
  search: string;
  branchType?: string;
  onItemClick: (item: MenuItem) => void;
}

export default function ProductGrid({ menu, category, search, branchType, onItemClick }: ProductGridProps) {
  const visibleMenu = useMemo(() => {
    return menu.filter((item) => {
      if (!item.active) return false;
      if (branchType && (item as Record<string, any>).branchType && (item as Record<string, any>).branchType !== branchType) return false;
      if (category !== "ทั้งหมด" && item.category !== category) return false;
      if (search && !item.name.toLowerCase().includes(search.toLowerCase()) && !item.barcode?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [menu, category, search, branchType]);
  const renderedMenu = visibleMenu.slice(0, PRODUCT_RENDER_LIMIT);
  const hiddenCount = Math.max(0, visibleMenu.length - renderedMenu.length);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
      gridAutoRows: "max-content",
      gap: "16px",
      alignContent: "start",
      padding: "20px 24px",
      overflowY: "auto",
      flex: 1,
      minHeight: 0
    }}>
      {visibleMenu.length === 0 ? (
        <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
          ไม่พบสินค้า
        </div>
      ) : (
        <>
          {renderedMenu.map((item) => (
            <ProductCard key={item.id} item={item} onClick={onItemClick} />
          ))}
          {hiddenCount > 0 && (
            <div className="empty" style={{ gridColumn: "1 / -1", padding: "16px" }}>
              แสดง {renderedMenu.length} จาก {visibleMenu.length} รายการ ใช้ช่องค้นหาหรือเลือกหมวดเพื่อกรองสินค้าเพิ่มเติม
            </div>
          )}
        </>
      )}
    </div>
  );
}
