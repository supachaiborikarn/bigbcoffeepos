import { Coffee, Wrench, Plus, Package, CupSoda, Croissant } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { MenuItem } from "../../types";
import productIllustrations from "../../assets/product-illustrations.jpg";
import { displayCategoryLabel } from "../../utils/categoryLabel";
import { getCategoryTone, getProductDisplayCode } from "../../utils/categoryTone";
import { resolveMenuImageUrl } from "../../utils/menuImage";

type Props = {
  item: MenuItem;
  onClick: (item: MenuItem) => void;
  variantCount?: number;
  priceLabel?: string;
  cartQty?: number;
};

const formatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0, maximumFractionDigits: 2,
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

function ProductCard({ item, onClick, variantCount = 0, priceLabel, cartQty = 0 }: Props) {
  const imageSrc = resolveMenuImageUrl(item.imageUrl);
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [imageSrc]);

  const topSeller = isTopSeller(item);
  const hasPhoto = Boolean(imageSrc) && !imgError;
  const isOilService = item.branchType === "oil_service";
  // Only oil-service products show SKU/short-code tiles (e.g. C6, D2); coffee shops show the menu name instead.
  const code = isOilService ? getProductDisplayCode(item) : null;
  const tone = getCategoryTone(item.category, item.branchType);
  const useCodeTile = !hasPhoto && Boolean(code);
  const illustration = hasPhoto || useCodeTile ? null : illustrationIndex(item);
  const useNameTile = !hasPhoto && !useCodeTile && illustration === null && !isOilService;
  const Icon = isOilService ? (/บริการ|ค่าแรง/.test(item.category) ? Wrench : Package) : /เบเกอรี่|ขนม/.test(item.category) ? Croissant : /กาแฟ/.test(item.category) ? Coffee : CupSoda;
  const metaLabel = variantCount > 1 ? `${variantCount} ตัวเลือก` : item.optionLabel || displayCategoryLabel(item.category);
  const isStandIn = !hasPhoto && illustration === null;

  return (
    <button
      type="button"
      className={`menu-card menu-card--pos${cartQty > 0 ? " is-in-cart" : ""}${useNameTile ? " menu-card--name-tile" : ""}`}
      data-tone={tone}
      onClick={() => onClick(item)}
      aria-label={`เพิ่ม ${item.name}`}
    >
      <div className={`menu-card__thumb${hasPhoto ? "" : " menu-card__thumb--text"}${isStandIn ? " menu-card__thumb--stand-in" : ""}${useCodeTile ? " menu-card__thumb--code" : ""}${useNameTile ? " menu-card__thumb--name" : ""}`}>
        {hasPhoto ? (
          <img src={imageSrc ?? ""} alt="" loading="lazy" onError={() => setImgError(true)} />
        ) : useCodeTile && code ? (
          <span className="studio-product-code-tile" aria-hidden="true">
            <Icon className="studio-product-code-tile__icon" size={18} strokeWidth={1.8} />
            <strong className={`studio-product-code-tile__code${code.length > 6 ? " is-long" : ""}`}>{code}</strong>
            <small>{displayCategoryLabel(item.category)}</small>
          </span>
        ) : useNameTile ? (
          <span className="studio-product-name-tile">
            <Icon className="studio-product-code-tile__icon" size={17} strokeWidth={1.8} aria-hidden="true" />
            <strong className={`studio-product-name-tile__text${item.name.length > 16 ? " is-long" : ""}`}>{item.name}</strong>
          </span>
        ) : illustration !== null ? (
          <div className="studio-product-art" aria-hidden="true">
            <span style={{ backgroundImage: `url(${productIllustrations})`, backgroundPosition: `${(illustration % 4) * 100 / 3}% ${illustration < 4 ? 0 : 100}%` }} />
            <small>ภาพประกอบ</small>
          </div>
        ) : (
          <span className="studio-product-placeholder"><Icon size={40} strokeWidth={1.35} /><span>{displayCategoryLabel(item.category)}</span></span>
        )}
        {code && !useCodeTile && <span className="menu-card__code-pill" aria-hidden="true">{code}</span>}
        {topSeller && <span className="menu-card__flag">ขายดี</span>}
        {cartQty > 0 && <span className="menu-card__qty-badge" aria-hidden="true">×{cartQty}</span>}
      </div>

      <span className="studio-product-category">
        <span className="studio-product-category__tag">{metaLabel}</span>
        {code && <span className="studio-product-code-inline">{code}</span>}
      </span>
      <span className="menu-card__name menu-card__name--pos">{item.name}</span>

      <span className="studio-product-bottom">
        <span className="menu-card__price menu-card__price--pos">{priceLabel ?? formatter.format(item.basePrice)}</span>
        <span className="studio-add-product" aria-hidden="true"><Plus size={18} strokeWidth={2.4} /></span>
      </span>
    </button>
  );
}

// Memoized so the product grid does not re-render every card on each keystroke
// while scanning a barcode / typing in the search box (keeps iPad input snappy).
export default memo(ProductCard);
