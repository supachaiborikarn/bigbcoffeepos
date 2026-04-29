import { useEffect, useMemo, useState } from "react";
import { X, Check } from "lucide-react";
import type { MenuItem, Modifier } from "../../types";
import { shouldUseModifierModal } from "../../utils/menuRules";

type Props = {
  item: MenuItem;
  onClose: () => void;
  onAdd: (item: MenuItem, qty: number, modifiers: Modifier[]) => void;
};

const SWEETNESS_LEVELS = [
  { value: "0%", label: "ไม่หวาน (0%)" },
  { value: "25%", label: "หวานน้อยมาก (25%)" },
  { value: "50%", label: "หวานน้อย (50%)" },
  { value: "100%", label: "หวานปกติ (100%)", isDefault: true },
  { value: "120%", label: "หวานมาก (120%)" },
];

const ADD_ONS = [
  { value: "Extra Shot", label: "เพิ่มช็อตกาแฟ", price: 15 },
  { value: "Oat Milk", label: "เปลี่ยนเป็นนมโอ๊ต", price: 20 },
  { value: "Almond Milk", label: "เปลี่ยนเป็นนมอัลมอนด์", price: 20 },
  { value: "Vanilla Syrup", label: "เพิ่มไซรัปวานิลลา", price: 15 },
  { value: "Caramel Syrup", label: "เพิ่มไซรัปคาราเมล", price: 15 },
  { value: "Whip Cream", label: "วิปครีม", price: 15 },
];

const COLD_CUP_OPTIONS = [
  { value: "แก้วเย็น", label: "แก้วเย็น", stockNote: "ตัดสต็อกแก้วเย็น" },
  { value: "แก้วทานร้าน", label: "แก้วทานร้าน", stockNote: "ไม่ตัดแก้วใช้แล้วทิ้ง" },
  { value: "แก้วมาเอง", label: "แก้วมาเอง", stockNote: "ไม่ตัดสต็อกแก้ว" },
];

const HOT_CUP_OPTIONS = [
  { value: "แก้วทานร้าน", label: "แก้วทานร้าน", stockNote: "ไม่ตัดแก้วใช้แล้วทิ้ง" },
  { value: "แก้วเดินทาง", label: "แก้วเดินทาง", stockNote: "ตัดสต็อกแก้วร้อน" },
  { value: "แก้วมาเอง", label: "แก้วมาเอง", stockNote: "ไม่ตัดสต็อกแก้ว" },
];

export default function ModifierModal({ item, onClose, onAdd }: Props) {
  const usesModifiers = shouldUseModifierModal(item);

  const [type, setType] = useState(item.name.includes("ร้อน") ? "Hot" : item.name.includes("ปั่น") ? "Frappe" : "Iced");
  const [cup, setCup] = useState(type === "Hot" ? "แก้วทานร้าน" : "แก้วเย็น");
  const [sweetness, setSweetness] = useState("100%");
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const cupOptions = useMemo(() => type === "Hot" ? HOT_CUP_OPTIONS : COLD_CUP_OPTIONS, [type]);

  useEffect(() => {
    if (!cupOptions.some((option) => option.value === cup)) setCup(cupOptions[0]?.value ?? "แก้วเย็น");
  }, [cup, cupOptions]);

  const handleAdd = () => {
    const modifiers: Modifier[] = [];
    
    if (usesModifiers) {
      modifiers.push({ name: "Type", value: type, price: 0 });
      modifiers.push({ name: "Cup", value: cup, price: 0 });
      modifiers.push({ name: "Sweetness", value: sweetness, price: 0 });
      
      selectedAddOns.forEach((addOnVal) => {
        const addonData = ADD_ONS.find(a => a.value === addOnVal);
        if (addonData) {
          modifiers.push({ name: "Add-on", value: addonData.label, price: addonData.price });
        }
      });
    }

    onAdd(item, qty, modifiers);
  };

  const toggleAddOn = (val: string) => {
    setSelectedAddOns(prev => prev.includes(val) ? prev.filter(a => a !== val) : [...prev, val]);
  };

  const addonTotal = selectedAddOns.reduce((sum, val) => sum + (ADD_ONS.find(a => a.value === val)?.price || 0), 0);
  const totalPrice = (item.basePrice + addonTotal) * qty;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(44,30,22,0.4)", backdropFilter: "blur(4px)", padding: "20px"
    }}>
      <div style={{
        background: "var(--bg-surface)", width: "100%", maxWidth: 500, borderRadius: "24px",
        boxShadow: "var(--shadow-modal)", animation: "slideUp 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        display: "flex", flexDirection: "column", maxHeight: "90vh"
      }}>
        <div style={{ padding: "24px 24px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{item.name}</h2>
            <p style={{ color: "var(--brand)", fontWeight: 600, fontSize: 18 }}>฿{item.basePrice}</p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 8, margin: -8 }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ padding: "24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 32 }}>
          
          {usesModifiers && (
            <>
              {/* Type */}
              <section>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--text-secondary)" }}>รูปแบบ</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {["Hot", "Iced", "Frappe"].map((t) => (
                    <button key={t} onClick={() => setType(t)} style={{
                      padding: "12px", borderRadius: 12, border: `2px solid ${type === t ? "var(--brand)" : "var(--border)"}`,
                      background: type === t ? "var(--brand-subtle)" : "transparent", color: type === t ? "var(--brand)" : "var(--text-secondary)",
                      fontWeight: type === t ? 600 : 500, cursor: "pointer", transition: "all 0.15s"
                    }}>
                      {t === "Hot" ? "ร้อน" : t === "Iced" ? "เย็น" : "ปั่น"}
                    </button>
                  ))}
                </div>
              </section>

              {/* Cup */}
              <section>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--text-secondary)" }}>แก้ว</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  {cupOptions.map((option) => (
                    <button key={option.value} onClick={() => setCup(option.value)} style={{
                      minHeight: 72, padding: "12px", borderRadius: 12, border: `2px solid ${cup === option.value ? "var(--brand)" : "var(--border)"}`,
                      background: cup === option.value ? "var(--brand-subtle)" : "transparent", color: cup === option.value ? "var(--brand)" : "var(--text-secondary)",
                      fontWeight: cup === option.value ? 600 : 500, cursor: "pointer", transition: "all 0.15s", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4
                    }}>
                      <span>{option.label}</span>
                      <small style={{ color: "var(--text-muted)", fontWeight: 500, lineHeight: 1.25 }}>{option.stockNote}</small>
                    </button>
                  ))}
                </div>
              </section>

              {/* Sweetness */}
              <section>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--text-secondary)" }}>ความหวาน</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {SWEETNESS_LEVELS.map((s) => (
                    <button key={s.value} onClick={() => setSweetness(s.value)} style={{
                      padding: "10px 16px", borderRadius: 20, border: `1px solid ${sweetness === s.value ? "var(--brand)" : "var(--border)"}`,
                      background: sweetness === s.value ? "var(--brand)" : "transparent", color: sweetness === s.value ? "white" : "var(--text-secondary)",
                      fontWeight: 500, cursor: "pointer", transition: "all 0.15s", fontSize: 14
                    }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Add-ons */}
              <section>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--text-secondary)" }}>เพิ่มเติม (Add-ons)</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {ADD_ONS.map((addon) => {
                    const isSelected = selectedAddOns.includes(addon.value);
                    return (
                      <button key={addon.value} onClick={() => toggleAddOn(addon.value)} style={{
                        padding: "14px 16px", borderRadius: 12, border: `1px solid ${isSelected ? "var(--brand)" : "var(--border)"}`,
                        background: isSelected ? "var(--brand-subtle)" : "transparent", color: "var(--text-primary)",
                        cursor: "pointer", transition: "all 0.15s", display: "flex", justifyContent: "space-between", alignItems: "center"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ 
                            width: 20, height: 20, borderRadius: 6, border: `1px solid ${isSelected ? "var(--brand)" : "var(--border)"}`,
                            background: isSelected ? "var(--brand)" : "white", display: "flex", alignItems: "center", justifyContent: "center"
                          }}>
                            {isSelected && <Check size={14} color="white" />}
                          </div>
                          <span style={{ fontWeight: 500 }}>{addon.label}</span>
                        </div>
                        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>+฿{addon.price}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            </>
          )}

          {!usesModifiers && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>
              สินค้านี้ไม่มีตัวเลือกเพิ่มเติม
            </div>
          )}

        </div>

        <div style={{ padding: "20px 24px", borderTop: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", gap: 16, alignItems: "center", borderRadius: "0 0 24px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ width: 48, height: 48, background: "transparent", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-secondary)" }}>-</button>
            <div style={{ width: 40, textAlign: "center", fontWeight: 600, fontSize: 18 }}>{qty}</div>
            <button onClick={() => setQty(q => q + 1)} style={{ width: 48, height: 48, background: "transparent", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-secondary)" }}>+</button>
          </div>
          <button onClick={handleAdd} style={{
            flex: 1, background: "var(--brand)", color: "white", border: "none", borderRadius: 12, height: 48,
            fontSize: 16, fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 20px"
          }}>
            <span>เพิ่มลงตะกร้า</span>
            <span>฿{totalPrice}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
