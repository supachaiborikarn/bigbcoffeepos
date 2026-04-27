import { useMemo } from "react";
import type { MenuItem } from "../../types";
import ProductCard from "./ProductCard";

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

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
      gap: "16px",
      alignContent: "start",
      padding: "20px 24px",
      overflowY: "auto",
      flex: 1
    }}>
      {visibleMenu.length === 0 ? (
        <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--muted)" }}>
          ไม่พบสินค้า
        </div>
      ) : (
        visibleMenu.map((item) => (
          <ProductCard key={item.id} item={item} onClick={onItemClick} />
        ))
      )}
    </div>
  );
}
