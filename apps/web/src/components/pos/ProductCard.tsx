import { memo, useState } from "react";
import type { MenuItem } from "../../types";

type Props = {
  item: MenuItem;
  onClick: (item: MenuItem) => void;
  variantCount?: number;
  priceLabel?: string;
};

const formatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0,
});

const TOP_SELLER_FLAGS = ["popular", "topSeller", "top_seller", "bestSeller", "best_seller", "featured", "recommended"];
const TOP_SELLER_LABELS = ["ขายดี", "popular", "top seller", "bestseller", "best seller", "featured", "recommended"];

function parseMetadata(metadata: MenuItem["metadata"]) {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTopSeller(item: MenuItem) {
  const metadata = parseMetadata(item.metadata);
  if (metadata) {
    if (TOP_SELLER_FLAGS.some((flag) => metadata[flag] === true || metadata[flag] === "true")) return true;
    const labels = [metadata.label, metadata.badge, metadata.tag, metadata.tags]
      .flat()
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (TOP_SELLER_LABELS.some((label) => labels.includes(label))) return true;
  }

  return TOP_SELLER_LABELS.some((label) => `${item.name} ${item.optionGroup ?? ""} ${item.optionLabel ?? ""}`.toLowerCase().includes(label));
}

function ProductCard({ item, onClick, variantCount = 0, priceLabel }: Props) {
  const [imgError, setImgError] = useState(false);
  const topSeller = isTopSeller(item);
  const hasPhoto = Boolean(item.imageUrl?.trim()) && !imgError;
  const metaLabel = variantCount > 1 ? `${variantCount} ตัวเลือก` : item.optionLabel || item.category;

  return (
    <button
      type="button"
      className="menu-card menu-card--pos"
      onClick={() => onClick(item)}
      aria-label={`เพิ่ม ${item.name}`}
    >
      <div className={`menu-card__thumb${hasPhoto ? "" : " menu-card__thumb--text"}`}>
        {hasPhoto ? (
          <img src={item.imageUrl ?? ""} alt="" loading="lazy" onError={() => setImgError(true)} />
        ) : (
          <span className="menu-card__thumb-name">{item.name}</span>
        )}
        {topSeller && <span className="menu-card__flag">ขายดี</span>}
        {metaLabel && <span className="menu-card__meta menu-card__meta--corner">{metaLabel}</span>}
      </div>

      {hasPhoto && <span className="menu-card__name menu-card__name--pos">{item.name}</span>}

      <span className="menu-card__price menu-card__price--pos">{priceLabel ?? formatter.format(item.basePrice)}</span>
    </button>
  );
}

// Memoized so the product grid does not re-render every card on each keystroke
// while scanning a barcode / typing in the search box (keeps iPad input snappy).
export default memo(ProductCard);
