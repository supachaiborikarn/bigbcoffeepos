import type { MenuItem } from "../types";

export type CategoryTone =
  | "oil"
  | "filter"
  | "service"
  | "fluid"
  | "part"
  | "coffee"
  | "tea"
  | "bakery"
  | "drink";

const OIL_FALLBACK_TONES: CategoryTone[] = ["oil", "filter", "service", "fluid", "part"];
const COFFEE_FALLBACK_TONES: CategoryTone[] = ["coffee", "tea", "bakery", "drink"];

function hashIndex(text: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % size;
}

export function getCategoryTone(category: string, branchType?: string): CategoryTone {
  const normalized = (category ?? "").trim().toLowerCase();
  if (branchType === "oil_service") {
    if (/ไส้กรอง|กรอง|filter/.test(normalized)) return "filter";
    if (/บริการ|ค่าแรง|เช็ค|ตรวจ|ซ่อม|service|labor/.test(normalized)) return "service";
    if (/เกียร์|เบรก|เฟือง|น้ำยา|เคมี|หล่อเย็น|จาระบี|fluid|brake|gear|coolant/.test(normalized)) return "fluid";
    if (/น้ำมันเครื่อง|น้ำมัน|oil|4t|5w|10w|ดีเซล|เบนซิน/.test(normalized)) return "oil";
    if (/อะไหล่|หัวเทียน|หลอดไฟ|แบต|ยาง|part/.test(normalized)) return "part";
    return OIL_FALLBACK_TONES[hashIndex(normalized || "oil", OIL_FALLBACK_TONES.length)];
  }

  if (/กาแฟ|coffee|espresso|เอสเปรสโซ/.test(normalized)) return "coffee";
  if (/ชา|มัทฉะ|matcha|tea/.test(normalized)) return "tea";
  if (/เบเกอรี่|ขนม|เค้ก|ครัวซอง|bakery|pastry|food|อาหาร/.test(normalized)) return "bakery";
  if (/เครื่องดื่ม|นม|โกโก้|โซดา|น้ำ|ปั่น|drink|milk|cocoa|soda/.test(normalized)) return "drink";
  return COFFEE_FALLBACK_TONES[hashIndex(normalized || "coffee", COFFEE_FALLBACK_TONES.length)];
}

/**
 * Display code shown on a POS product tile when no photo is uploaded (e.g. C6, D2, OIL001).
 * Prefers `sku`; falls back to a short non-EAN `barcode` (<= 10 chars).
 */
export function getProductDisplayCode(item: Pick<MenuItem, "sku" | "barcode">): string | null {
  const sku = item.sku?.trim();
  if (sku) return sku.toUpperCase();
  const barcode = item.barcode?.trim();
  if (barcode && barcode.length <= 10 && !/^\d{8,}$/.test(barcode)) {
    return barcode.toUpperCase();
  }
  return null;
}
