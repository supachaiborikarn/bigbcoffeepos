// Pure rules for turning POSPOS stock rows into BB POS stock changes. Kept free
// of I/O so they can be checked without touching the database or POSPOS.
//
// Rules (owner decisions, 2026-10-10):
//  • "unlimited" products (drinks / add-ons; POSPOS shows 999,999 or 999.9k) are
//    not real stock → never written.
//  • POSPOS quantity ≤ 0 → leave BB POS as is (shelf stock POSPOS hasn't counted
//    must stay sellable in BB POS).
//  • Items missing from POSPOS are never zeroed.
//  • Cups are managed in BB POS → never touched here.

export type PosposStockRow = {
  code: string | null;
  name: string;
  stock: number;
  unlimited: boolean;
  unit: string;
  cost: number;
  /** POSPOS topping groups required on this product, e.g. ["แก้วเย็น"]. */
  cupToppings: string[];
};

export const FAKE_STOCK_THRESHOLD = 99_999;

/** "1,500" → 1500 · "999.8k" → 999800 · "2.5k ชิ้น" → 2500 · "-12" → -12 */
export function parsePosposQuantity(raw: string): number {
  const match = String(raw ?? "").replace(/,/g, "").trim().match(/^(-?\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!match) return 0;
  const base = Number(match[1]);
  const scale = match[2] ? (match[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  return Math.round(base * scale * 1000) / 1000;
}

/** Normalise one row of /api/v1/product/pagination/search/v2. */
export function fromPosposJson(p: any): PosposStockRow | null {
  const name = String(p?.name ?? "").trim();
  if (!name || p?.delete) return null;
  return {
    code: p?.code ? String(p.code) : null,
    name,
    stock: Number(p?.stock) || 0,
    unlimited: Boolean(p?.unlimited_stock),
    unit: String(p?.unit?.name ?? p?.unit ?? "ชิ้น") || "ชิ้น",
    cost: Math.round((Number(p?.cost) || 0) * 100) / 100,
    cupToppings: Array.isArray(p?.category_toppings) && p?.enable_topping
      ? p.category_toppings.map((t: any) => String(t?.name ?? "").trim()).filter(Boolean)
      : []
  };
}

export type StockDecision =
  | { action: "skip"; reason: "unlimited" | "zero_or_negative" | "cup" | "unchanged" }
  | { action: "set"; from: number; to: number };

export function decideStock(row: PosposStockRow, current: number | null, isCup: boolean): StockDecision {
  if (isCup) return { action: "skip", reason: "cup" };
  if (row.unlimited || row.stock >= FAKE_STOCK_THRESHOLD) return { action: "skip", reason: "unlimited" };
  if (row.stock <= 0) return { action: "skip", reason: "zero_or_negative" };
  const from = current ?? 0;
  if (Math.abs(from - row.stock) < 1e-9) return { action: "skip", reason: "unchanged" };
  return { action: "set", from, to: row.stock };
}
