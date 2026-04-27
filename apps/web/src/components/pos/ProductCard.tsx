import { motion } from "framer-motion";
import type { MenuItem } from "../../types";
import { Coffee, CupSoda, CakeSlice, ShoppingBag } from "lucide-react";

interface ProductCardProps {
  item: MenuItem;
  onClick: (item: MenuItem) => void;
}

const formatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
function formatMoney(v: number) { return formatter.format(v); }

export default function ProductCard({ item, onClick }: ProductCardProps) {
  // Determine an icon based on category for the placeholder
  const getCategoryIcon = () => {
    const cat = item.category.toLowerCase();
    if (cat.includes("coffee") || cat.includes("กาแฟ")) return <Coffee size={32} strokeWidth={1.5} />;
    if (cat.includes("tea") || cat.includes("ชา")) return <CupSoda size={32} strokeWidth={1.5} />;
    if (cat.includes("bakery") || cat.includes("เบเกอรี่")) return <CakeSlice size={32} strokeWidth={1.5} />;
    return <ShoppingBag size={32} strokeWidth={1.5} />;
  };

  return (
    <motion.button
      whileHover={{ y: -2, boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)" }}
      whileTap={{ scale: 0.96 }}
      onClick={() => onClick(item)}
      className="pos-product-card"
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        cursor: "pointer",
        textAlign: "left",
        position: "relative",
        padding: 0,
        height: "100%",
        transition: "border-color 0.2s"
      }}
    >
      <div 
        className="pos-product-card__image" 
        style={{ 
          height: "120px", 
          background: "var(--canvas-alt)", 
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)"
        }}
      >
        {/* Placeholder image */}
        {getCategoryIcon()}
      </div>
      
      <div className="pos-product-card__content" style={{ padding: "12px", display: "flex", flexDirection: "column", flex: 1, width: "100%" }}>
        <span className="muted" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
          {item.category}
        </span>
        <strong style={{ fontSize: "14px", lineHeight: 1.3, color: "var(--ink)", marginBottom: "8px", flex: 1 }}>
          {item.name}
        </strong>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--accent)" }}>
            {formatMoney(item.basePrice)}
          </span>
          {/* Mock low stock badge for demo if needed */}
          {Math.random() > 0.9 && (
            <span style={{ fontSize: "10px", background: "var(--warning-bg)", color: "var(--warning)", padding: "2px 6px", borderRadius: "10px", fontWeight: 600 }}>
              เหลือ 2
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
