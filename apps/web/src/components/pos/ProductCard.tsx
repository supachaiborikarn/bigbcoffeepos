import { Coffee, Wrench, Plus, Package, CupSoda, Croissant } from "lucide-react";
import { memo, useState } from "react";
import type { MenuItem } from "../../types";
import productIllustrations from "../../assets/product-illustrations.jpg";

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

// Generic artwork is labeled separately from the shop's own product photos.
function illustrationIndex(item: MenuItem): number | null {
  const name = `${item.name} ${item.optionLabel ?? ""}`.toLowerCase();
  if (item.branchType === "oil_service") {
    if (/5w[ -]?30/.test(name)) return 4;
    if (/ไส้กรองน้ำมันเครื่อง|oil filter/.test(name)) return 5;
    if (/10w[ -]?40/.test(name)) return 6;
    if (/น้ำมันเบรก|brake fluid/.test(name)) return 7;
    return null;
  }
  if (/ครัวซอง|croissant/.test(name)) return 3;
  if (/ร้อน|hot|ปั่น|frappe/.test(name)) return null;
  if (/มัทฉะ|matcha/.test(name)) return 2;
  if (/ลาเต้|latte|คาปูชิโน|cappuccino/.test(name)) return 1;
  if (/อเมริกาโน|americano|เอสเปรสโซ|espresso/.test(name)) return 0;
  return null;
}

function ProductCard({ item, onClick, variantCount = 0, priceLabel }: Props) {
  const [imgError, setImgError] = useState(false);
  const topSeller = isTopSeller(item);
  const hasPhoto = Boolean(item.imageUrl?.trim()) && !imgError;
  const illustration = hasPhoto ? null : illustrationIndex(item);
  const Icon = item.branchType === "oil_service" ? (/บริการ|ค่าแรง/.test(item.category) ? Wrench : Package) : /เบเกอรี่|ขนม/.test(item.category) ? Croissant : /กาแฟ/.test(item.category) ? Coffee : CupSoda;
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
        ) : illustration !== null ? (
          <div className="studio-product-art" aria-hidden="true">
            <span style={{ backgroundImage: `url(${productIllustrations})`, backgroundPosition: `${(illustration % 4) * 100 / 3}% ${illustration < 4 ? 0 : 100}%` }} />
            <small>ภาพประกอบ</small>
          </div>
        ) : (
          <span className="studio-product-placeholder"><Icon size={48} strokeWidth={1.15} /><span>{item.category}</span></span>
        )}
        {topSeller && <span className="menu-card__flag">ขายดี</span>}

      </div>

      <span className="studio-product-category">{metaLabel}</span>
      <span className="menu-card__name menu-card__name--pos">{item.name}</span>

      <span className="studio-product-bottom"><span className="menu-card__price menu-card__price--pos">{priceLabel ?? formatter.format(item.basePrice)}</span><span className="studio-add-product"><Plus size={18} /></span></span>
    </button>
  );
}

// Memoized so the product grid does not re-render every card on each keystroke
// while scanning a barcode / typing in the search box (keeps iPad input snappy).
export default memo(ProductCard);
