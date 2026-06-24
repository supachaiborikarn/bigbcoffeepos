import { useDeferredValue, useMemo, useState } from "react";
import type { MenuItem } from "../../types";
import ProductCard from "./ProductCard";
import { isCupVariantMenuItem } from "../../utils/menuRules";

const PRODUCT_RENDER_LIMIT = 120;
const priceFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0,
});

interface ProductGridProps {
  menu: MenuItem[];
  category: string;
  search: string;
  branchType?: string;
  onItemClick: (item: MenuItem) => void;
}

export default function ProductGrid({ menu, category, search, branchType, onItemClick }: ProductGridProps) {
  const [variantGroup, setVariantGroup] = useState<{ label: string; variants: MenuItem[] } | null>(null);
  // Defer the search term so heavy grid filtering/re-rendering never blocks the
  // search/scan input — keeps characters appearing instantly on iPad.
  const deferredSearch = useDeferredValue(search);
  const visibleMenu = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return menu.filter((item) => {
      if (!item.active) return false;
      if (isCupVariantMenuItem(item)) return false;
      if (branchType && (item as Record<string, any>).branchType && (item as Record<string, any>).branchType !== branchType) return false;
      if (category !== "ทั้งหมด" && item.category !== category) return false;
      if (q && !`${item.name} ${item.optionGroup ?? ""} ${item.optionLabel ?? ""} ${item.barcode ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [menu, category, deferredSearch, branchType]);

  const productTiles = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    visibleMenu.forEach((item) => {
      const key = item.optionGroup ? `group:${item.optionGroup}:${item.category}` : `item:${item.id}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return Array.from(groups.values()).map((variants) => {
      const sorted = variants.sort((a, b) => {
        const aLabel = a.optionLabel ?? a.name;
        const bLabel = b.optionLabel ?? b.name;
        return a.basePrice - b.basePrice || aLabel.localeCompare(bLabel, "th");
      });
      const primary = sorted[0];
      const prices = sorted.map((item) => item.basePrice);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      return {
        key: primary.optionGroup ? `group:${primary.optionGroup}:${primary.category}` : `item:${primary.id}`,
        label: primary.optionGroup || primary.name,
        primary: primary.optionGroup ? { ...primary, name: primary.optionGroup } : primary,
        variants: sorted,
        priceLabel: sorted.length > 1 && minPrice !== maxPrice
          ? `${priceFormatter.format(minPrice)}-${priceFormatter.format(maxPrice)}`
          : priceFormatter.format(primary.basePrice)
      };
    });
  }, [visibleMenu]);

  const renderedTiles = productTiles.slice(0, PRODUCT_RENDER_LIMIT);
  const hiddenCount = Math.max(0, productTiles.length - renderedTiles.length);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
      gridAutoRows: "max-content",
      gap: "12px",
      alignContent: "start",
      padding: "16px",
      flex: 1,
      minHeight: 0
    }}>
      {productTiles.length === 0 ? (
        <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
          ไม่พบสินค้า
        </div>
      ) : (
        <>
          {renderedTiles.map((tile) => (
            <ProductCard
              key={tile.key}
              item={tile.primary}
              variantCount={tile.variants.length}
              priceLabel={tile.priceLabel}
              onClick={() => {
                if (tile.variants.length > 1) setVariantGroup({ label: tile.label, variants: tile.variants });
                else onItemClick(tile.primary);
              }}
            />
          ))}
          {hiddenCount > 0 && (
            <div className="empty" style={{ gridColumn: "1 / -1", padding: "16px" }}>
              แสดง {renderedTiles.length} จาก {productTiles.length} กลุ่มสินค้า ใช้ช่องค้นหาหรือเลือกหมวดเพื่อกรองสินค้าเพิ่มเติม
            </div>
          )}
        </>
      )}
      {variantGroup && (
        <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(44,30,22,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(440px, 100%)", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-modal)", padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontSize: 18 }}>{variantGroup.label}</h2>
              <button type="button" className="btn btn--ghost" onClick={() => setVariantGroup(null)}>ปิด</button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {variantGroup.variants.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="stock-row"
                  onClick={() => {
                    setVariantGroup(null);
                    onItemClick(item);
                  }}
                >
                  <span>
                    <strong>{item.optionLabel || item.name}</strong>
                    <small>{item.category}{item.unit ? ` · ${item.unit}` : ""}</small>
                  </span>
                  <span className="positive">฿{item.basePrice.toLocaleString("th-TH")}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
