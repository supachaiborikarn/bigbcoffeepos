import type { MenuItem } from "../types";

const PREPARED_MENU_CATEGORIES = new Set(["กาแฟ", "ชา", "นม/โกโก้", "เครื่องดื่มชง", "COLD", "FRAPPE", "Hot"]);
const PREPARED_OPTION_LABELS = new Set(["ร้อน", "เย็น", "ปั่น"]);

const PREPARED_NAME_PATTERNS = [
  "อเมริกาโน",
  "เอส",
  "กาโน",
  "ลาเต้",
  "คาปู",
  "มอคค่า",
  "แมคคิอา",
  "กาแฟ",
  "ชา",
  "โกโก้",
  "นมสด",
  "บูลฮาวาย",
  "ผลไม้โซดา",
  "มิลค์",
  "เฟรป",
  "สมูท"
];

const RETAIL_NAME_PATTERNS = [
  "sale ",
  "ขวด",
  "กระป๋อง",
  "แคน",
  "มล",
  "ml",
  "เมล็ด",
  "วัตถุดิบ",
  "panda",
  "แก้วกาแฟป่าว",
  "แก้วเฉาก๊วยป่าว",
  "เนสกาแฟ",
  "เบอร์ดี้",
  "โออิชิ",
  "ลิปตัน",
  "คาราบาว",
  "ไวตามิ้ล",
  "แลคตาซอย",
  "ดีน่า",
  "มิรินด้า",
  "โค้ก",
  "เป๊ปซี่",
  "ชเวปส์",
  "น้ำดื่ม",
  "เพียวไลฟ์",
  "สิงห์",
  "วันเวย์",
  "lipo",
  "m 150"
];

export function shouldUseModifierModal(item: MenuItem) {
  if (item.basePrice <= 0) return false;

  const nameText = `${item.name} ${item.optionGroup ?? ""}`.toLowerCase();
  const category = item.category.trim();
  const optionLabel = item.optionLabel?.trim() ?? "";

  if (RETAIL_NAME_PATTERNS.some((pattern) => nameText.includes(pattern))) return false;

  const isPreparedCategory = PREPARED_MENU_CATEGORIES.has(category);
  const isPreparedVariant = PREPARED_OPTION_LABELS.has(optionLabel);
  const looksLikePreparedDrink = PREPARED_NAME_PATTERNS.some((pattern) => nameText.includes(pattern.toLowerCase()));

  return (isPreparedCategory && looksLikePreparedDrink) || (isPreparedVariant && looksLikePreparedDrink);
}
