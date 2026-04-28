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
  return (
    <button
      type="button"
      className="menu-card"
      onClick={() => onClick(item)}
      aria-label={`เพิ่ม ${item.name}`}
    >
      {/* Stock Warning */}
      {item.cost !== null && item.cost !== undefined && item.cost <= 0 && (
        <span className="menu-card__stock-warn">สต็อกต่ำ</span>
      )}

      {/* SKU */}
      {item.sku && <span className="menu-card__sku">{item.sku}</span>}

      {/* Name */}
      <span className="menu-card__name">{item.name}</span>

      {/* Category Tag */}
      <span className="menu-card__category">{item.category}</span>

      {/* Price */}
      <span className="menu-card__price">{formatter.format(item.basePrice)}</span>
    </button>
  );
}
