import type { MenuItem } from "../../types";

type Props = {
  item: MenuItem;
  onClick: (item: MenuItem) => void;
};

const formatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  maximumFractionDigits: 0,
});

export default function ProductCard({ item, onClick }: Props) {
  const isPopular = item.category === "กาแฟ" && item.basePrice >= 60; // Mock popular logic

  return (
    <button
      type="button"
      className="menu-card"
      onClick={() => onClick(item)}
      aria-label={`เพิ่ม ${item.name}`}
      style={{ display: "flex", flexDirection: "column", padding: "12px", gap: "8px", position: "relative" }}
    >
      {/* Image Placeholder */}
      <div style={{
        width: "100%", aspectRatio: "4/3", backgroundColor: "var(--bg-muted)",
        borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-muted)", fontSize: "12px", overflow: "hidden"
      }}>
        {/* Mock image could go here */}
        <span style={{ opacity: 0.5 }}>☕</span>
      </div>

      {/* Popular Badge */}
      {isPopular && (
        <span style={{
          position: "absolute", top: "16px", right: "16px", background: "var(--warning)",
          color: "white", fontSize: "10px", fontWeight: "bold", padding: "2px 6px", borderRadius: "10px"
        }}>POPULAR</span>
      )}

      <div style={{ display: "flex", flexDirection: "column", width: "100%", alignItems: "flex-start", marginTop: "4px" }}>
        {/* Name */}
        <span className="menu-card__name" style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", textAlign: "left", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.name}</span>

        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center", marginTop: "8px" }}>
          {/* Category Tag */}
          <span className="menu-card__category" style={{ background: "var(--brand-subtle)", color: "var(--brand)", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>{item.category}</span>

          {/* Price */}
          <span className="menu-card__price" style={{ fontWeight: 700, color: "var(--brand-hover)", fontSize: "14px" }}>{formatter.format(item.basePrice)}</span>
        </div>
      </div>
    </button>
  );
}
