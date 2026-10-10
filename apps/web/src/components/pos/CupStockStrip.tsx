import { useCallback, useEffect, useState } from "react";
import { CupSoda, Coffee } from "lucide-react";
import { getCupStockSettings } from "../../api";
import type { CupStockSetting } from "../../types";

// Coffee drinks are limited by cups left, not by per-menu stock. These numbers
// are advisory: selling never blocks when cups hit 0 (cups may be on the shelf
// but not yet received into the system) — the strip just turns red as a nudge.

export type CupStatus = "ok" | "low" | "out";
export type CupStockInfo = { label: string; name: string; unit: string; qty: number; reorderLevel: number; status: CupStatus };
/** Keyed by POS cup option value ("แก้วเย็น", "แก้วเดินทาง"). */
export type CupStockMap = Partial<Record<string, CupStockInfo>>;

const SHOWN: Array<{ option: string; label: string }> = [
  { option: "แก้วเย็น", label: "แก้วเย็น" },
  { option: "แก้วเดินทาง", label: "แก้วร้อน" }
];

function toMap(settings: CupStockSetting[]): CupStockMap {
  const map: CupStockMap = {};
  for (const { option, label } of SHOWN) {
    const setting = settings.find((item) => item.cupOption === option);
    const cup = setting?.deductStock ? setting.items[0] : undefined;
    if (!cup) continue;
    const status: CupStatus = cup.stockQty <= 0 ? "out" : cup.reorderLevel > 0 && cup.stockQty <= cup.reorderLevel ? "low" : "ok";
    map[option] = { label, name: cup.ingredientName, unit: cup.unit, qty: cup.stockQty, reorderLevel: cup.reorderLevel, status };
  }
  return map;
}

/** Loads cup stock for the branch; reloads when `refreshKey` changes, on focus, and every minute. */
export function useCupStock(branchId: number | undefined, refreshKey: unknown): CupStockMap {
  const [map, setMap] = useState<CupStockMap>({});
  const load = useCallback(() => {
    if (!branchId) return;
    getCupStockSettings(branchId).then((settings) => setMap(toMap(settings))).catch(() => { /* advisory only */ });
  }, [branchId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [load]);
  return map;
}

const fmt = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 1 });

export function cupStockText(info: CupStockInfo) {
  return info.status === "out" ? `หมดในระบบ (${fmt(info.qty)}) · ยังขายได้` : `เหลือ ${fmt(info.qty)} ${info.unit}`;
}

export default function CupStockStrip({ cups }: { cups: CupStockMap }) {
  const entries = SHOWN.map(({ option }) => cups[option]).filter(Boolean) as CupStockInfo[];
  if (!entries.length) return null;
  return <div className="cup-strip" aria-label="แก้วคงเหลือในระบบ">
    {entries.map((cup) => <span key={cup.label} className={`cup-chip is-${cup.status}`} title={`${cup.name} · แจ้งเตือนเมื่อเหลือ ${fmt(cup.reorderLevel)} ${cup.unit}${cup.status === "out" ? " · ยังขายได้ กรุณารับแก้วเข้าระบบ" : ""}`}>
      {cup.label === "แก้วเย็น" ? <CupSoda size={14} /> : <Coffee size={14} />}
      <span>{cup.label}</span>
      <strong>{cup.status === "out" ? "หมด" : fmt(cup.qty)}</strong>
    </span>)}
  </div>;
}
