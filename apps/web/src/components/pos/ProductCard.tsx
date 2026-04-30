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

export default function ProductCard({ item, onClick, variantCount = 0, priceLabel }: Props) {
  const topSeller = isTopSeller(item);
  const hasFeaturedPhoto = topSeller && Boolean(item.imageUrl?.trim());
  const metaLabel = variantCount > 1 ? `${variantCount} ตัวเลือก` : item.optionLabel || item.category;

  return (
    <button
      type="button"
      className="menu-card"
      onClick={() => onClick(item)}
      aria-label={`เพิ่ม ${item.name}`}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "12px",
        gap: "10px",
        position: "relative",
        minHeight: hasFeaturedPhoto ? 220 : 160
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <span className="menu-card__category" style={{
          background: "var(--brand-subtle)",
          color: "var(--brand)",
          padding: "3px 7px",
          borderRadius: "4px",
          fontSize: "11px",
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}>
          {metaLabel}
        </span>
        {topSeller && (
          <span style={{
            background: "var(--warning)",
            color: "white",
            fontSize: "10px",
            fontWeight: 700,
            padding: "3px 7px",
            borderRadius: "4px",
            lineHeight: 1.2,
            flexShrink: 0
          }}>
            ขายดี
          </span>
        )}
      </div>

      {hasFeaturedPhoto && (
        <div style={{
          width: "100%",
          aspectRatio: "4/3",
          backgroundColor: "var(--bg-muted)",
          borderRadius: "8px",
          overflow: "hidden"
        }}>
          <img src={item.imageUrl ?? ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} loading="lazy" />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", width: "100%", alignItems: "flex-start", gap: "10px", flex: 1 }}>
        <span className="menu-card__name" style={{
          fontSize: hasFeaturedPhoto ? "15px" : "19px",
          fontWeight: 700,
          color: "var(--text-primary)",
          textAlign: "left",
          lineHeight: 1.22,
          letterSpacing: 0,
          display: "-webkit-box",
          WebkitLineClamp: hasFeaturedPhoto ? 2 : 4,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          overflowWrap: "anywhere"
        }}>
          {item.name}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", alignItems: "center" }}>
        <span className="menu-card__price" style={{ fontWeight: 800, color: "var(--brand-hover)", fontSize: "16px", letterSpacing: 0 }}>
          {priceLabel ?? formatter.format(item.basePrice)}
        </span>
      </div>
    </button>
  );
}
