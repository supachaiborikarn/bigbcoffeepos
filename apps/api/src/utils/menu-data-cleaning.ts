type BranchType = "coffee" | "oil_service" | string;

export type MenuClassificationInput = {
  name: string;
  category?: string | null;
  branchType?: BranchType | null;
  basePrice?: number | null;
  active?: boolean | null;
  optionGroup?: string | null;
  optionLabel?: string | null;
  metadata?: string | null;
};

export type MenuClassification = {
  category: string;
  active: boolean;
  optionGroup: string | null;
  optionLabel: string | null;
  rawCategory: string | null;
  reasons: string[];
};

const UNKNOWN_CATEGORIES = new Set(["", "uncategory", "ไม่ระบุ"]);
const VARIANT_RAW_CATEGORY_LABELS: Record<string, string> = {
  cold: "เย็น",
  frappe: "ปั่น",
  hot: "ร้อน"
};

const RAW_CATEGORY_MAP = new Map<string, string>([
  ["ตู้แช่เย็น", "เครื่องดื่มพร้อมขาย"],
  ["เครื่องดื่ม", "เครื่องดื่มพร้อมขาย"],
  ["ขนมฝากขาย", "เบเกอรี่/ขนม"],
  ["ขนมปิ๋ม", "เบเกอรี่/ขนม"],
  ["ขนม", "เบเกอรี่/ขนม"],
  ["เค้ก", "เบเกอรี่/ขนม"],
  ["เบเกอรี่", "เบเกอรี่/ขนม"],
  ["ของกิน", "ของกิน"],
  ["ของใช้", "ของใช้"],
  ["ยา", "ยา"],
  ["อาหารสำเร็จรูป", "อาหารสำเร็จรูป"],
  ["หมากฝรั่ง&ลูกอม", "หมากฝรั่ง&ลูกอม"],
  ["ไอติม", "ไอติม"],
  ["กล่องkerry", "กล่องKERRY"],
  ["add on", "ADD ON"],
  ["addon", "ADD ON"],
  ["กาแฟ", "กาแฟ"],
  ["ชา", "ชา"],
  ["นม/โกโก้", "นม/โกโก้"]
]);

const COFFEE_DRINK_PATTERNS = [
  "อเมริกาโน",
  "กาโน",
  "เอส",
  "เอสเปรส",
  "espresso",
  "americano",
  "ลาเต้",
  "latte",
  "คาปู",
  "cappuccino",
  "มอคค่า",
  "mocha",
  "แมคคิอา",
  "macchiato",
  "ออเรนจิโน"
];

const TEA_DRINK_PATTERNS = ["ชาไทย", "ชาเขียว", "ชามะนาว", "ชาดำ", "ชาซีลอน", "มัทฉะ", "matcha"];
const MILK_DRINK_PATTERNS = ["โกโก้", "โก้โก", "cocoa", "นมสด", "นมชมพู", "มิลค์", "milk"];
const BREWED_DRINK_PATTERNS = ["บูลฮาวาย", "ผลไม้โซดา", "โซดามะนาว", "สมูท", "เฟรป", "frappe"];

const READY_DRINK_PATTERNS = [
  "ตู้แช่",
  "น้ำดื่ม",
  "ขวด",
  "กระป๋อง",
  "แคน",
  "มล",
  "ml",
  "เนสกาแฟ",
  "เบอร์ดี้",
  "โออิชิ",
  "อิชิตัน",
  "ลิปตัน",
  "คาราบาว",
  "m 150",
  "m150",
  "lipo",
  "ไวตามิ้ล",
  "แลคตาซอย",
  "ดีน่า",
  "มิรินด้า",
  "โค้ก",
  "เป๊ปซี่",
  "ชเวปส์",
  "เพียวไลฟ์",
  "มองต์ เฟลอ",
  "สปอนเซอร์"
];

const INTERNAL_SUPPLY_PATTERNS = [
  "วัตถุดิบ",
  "เมล็ดกาแฟ",
  "นมสดจืด",
  "ครีมพร่องมันเนย",
  "ครีมเทียม",
  "คอฟฟี่เมต",
  "ใบชา",
  "ผงชา",
  "ผงโกโก้",
  "ไซรัป",
  "ซอส",
  "น้ำหวาน",
  "น้ำตาล",
  "หลอด",
  "กระดาษพันแก้ว",
  "ฟองน้ำใช้ในร้าน",
  "daily whip",
  "frappease",
  "davinci"
];

const SNACK_PATTERNS = [
  "ขนม",
  "คุกกี้",
  "คุ้กกี้",
  "เวเฟอร์",
  "ลูกอม",
  "หมากฝรั่ง",
  "ถั่ว",
  "เค้ก",
  "ครัวซอง",
  "ปัง",
  "มันฝรั่ง",
  "บิสกิต",
  "ไอติม"
];

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function hasAny(text: string, patterns: string[]) {
  const normalized = text.toLowerCase();
  const compacted = compact(text);
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()) || compacted.includes(compact(pattern)));
}

function isUnknownCategory(value: string | null | undefined) {
  return UNKNOWN_CATEGORIES.has((value ?? "").trim().toLowerCase());
}

function parseMetadata(raw: string | null | undefined) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function mergeMenuMetadata(raw: string | null | undefined, patch: Record<string, unknown>) {
  return JSON.stringify({ ...parseMetadata(raw), ...patch });
}

function metadataString(parsed: Record<string, unknown>, path: string[]) {
  let current: unknown = parsed;
  for (const segment of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

export function getRawCategory(input: Pick<MenuClassificationInput, "category" | "metadata">) {
  const parsed = parseMetadata(input.metadata);
  return (
    metadataString(parsed, ["pospos", "categoryName"]) ??
    metadataString(parsed, ["categoryNormalizedFrom"]) ??
    (input.category && !isUnknownCategory(input.category) ? input.category.trim() : null)
  );
}

function isRawInternalSupply(rawCategory: string | null) {
  return Boolean(rawCategory && compact(rawCategory).includes("วัตถุดิบ"));
}

function isInternalSupplyName(name: string) {
  return hasAny(name, INTERNAL_SUPPLY_PATTERNS);
}

function isReadyDrinkName(name: string) {
  return hasAny(name, READY_DRINK_PATTERNS);
}

function isSnackName(name: string) {
  return hasAny(name, SNACK_PATTERNS);
}

function drinkFamily(name: string) {
  if (hasAny(name, COFFEE_DRINK_PATTERNS)) return "กาแฟ";
  if (hasAny(name, TEA_DRINK_PATTERNS)) return "ชา";
  if (hasAny(name, MILK_DRINK_PATTERNS)) return "นม/โกโก้";
  if (hasAny(name, BREWED_DRINK_PATTERNS)) return "เครื่องดื่มชง";
  return null;
}

function rawVariantLabel(rawCategory: string | null) {
  if (!rawCategory) return null;
  return VARIANT_RAW_CATEGORY_LABELS[rawCategory.trim().toLowerCase()] ?? null;
}

function normalizeOilCategory(rawCategory: string, name: string) {
  const text = `${rawCategory} ${name}`;
  const raw = rawCategory.trim();
  if (["กรองเครื่อง", "กรองโซล่า", "กรองอากาศ"].includes(raw)) return raw;
  if (hasAny(text, ["บริการ", "ค่าแรง"])) return "บริการ";
  if (hasAny(text, ["ไส้กรอง", "filter", "กรอง"])) return "อะไหล่/ไส้กรอง";
  if (hasAny(text, ["น้ำมัน", "oil"])) return "น้ำมันเครื่อง";
  return isUnknownCategory(raw) ? "บริการน้ำมัน" : raw;
}

export function normalizeMenuCategory(rawCategory: string | null | undefined, name: string, branchType: BranchType = "coffee") {
  const raw = (rawCategory ?? "").trim();
  if (branchType === "oil_service") return normalizeOilCategory(raw, name);

  const mapped = RAW_CATEGORY_MAP.get(raw.toLowerCase()) ?? RAW_CATEGORY_MAP.get(compact(raw));
  if (mapped === "ADD ON") return "ADD ON";
  if (mapped && !["กาแฟ", "ชา", "นม/โกโก้", "ADD ON"].includes(mapped)) return mapped;
  if (isRawInternalSupply(raw) || (isInternalSupplyName(name) && !mapped)) return "วัตถุดิบ/อุปกรณ์ร้าน";
  if (isReadyDrinkName(name)) return "เครื่องดื่มพร้อมขาย";
  if (rawVariantLabel(raw)) return drinkFamily(name) ?? "เครื่องดื่มชง";

  const family = drinkFamily(name);
  if (family) return family;
  if (isSnackName(name)) return raw === "ขนมฝากขาย" || raw === "เค้ก" ? "เบเกอรี่/ขนม" : "ของกิน";

  if (mapped) return mapped;
  return isUnknownCategory(raw) ? "อื่นๆ" : raw;
}

export function inferVariantInfo(name: string, rawCategory?: string | null, category?: string | null) {
  if (isReadyDrinkName(name) || isSnackName(name) || isInternalSupplyName(name)) {
    return { optionGroup: null, optionLabel: null };
  }

  const family = drinkFamily(name);
  const variantLabel = rawVariantLabel(rawCategory ?? null);
  const labels = ["ร้อน", "เย็น", "ปั่น"].filter((variant) => name.includes(variant));
  if (variantLabel && !labels.includes(variantLabel)) labels.push(variantLabel);

  if (!family && !variantLabel && !["กาแฟ", "ชา", "นม/โกโก้", "เครื่องดื่มชง"].includes(category ?? "")) {
    return { optionGroup: null, optionLabel: null };
  }
  if (labels.length === 0) return { optionGroup: null, optionLabel: null };

  const optionLabel = labels.join(" / ");
  const optionGroup = labels.reduce((current, label) => current.replaceAll(label, ""), name)
    .replace(/\b(HOT|COLD|FRAPPE)\b/gi, " ")
    .replace(/[()（）\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { optionGroup: optionGroup || name, optionLabel };
}

export function classifyMenuItem(input: MenuClassificationInput): MenuClassification {
  const name = input.name.trim();
  const branchType = input.branchType ?? "coffee";
  const rawCategory = getRawCategory(input);
  const category = normalizeMenuCategory(rawCategory ?? input.category ?? "", name, branchType);
  const inferred = inferVariantInfo(name, rawCategory, category);
  const reasons: string[] = [];
  let active = input.active ?? true;

  if (category !== (input.category ?? "").trim()) reasons.push("category");
  if ((inferred.optionGroup ?? null) !== (input.optionGroup ?? null) || (inferred.optionLabel ?? null) !== (input.optionLabel ?? null)) reasons.push("variant");

  if (name === "POSPOS sales-only record") {
    active = false;
    reasons.push("sales-only-record");
  } else if (branchType === "coffee" && (isRawInternalSupply(rawCategory) || category === "วัตถุดิบ/อุปกรณ์ร้าน")) {
    active = false;
    reasons.push("internal-supply");
  } else if (branchType === "coffee" && Number(input.basePrice ?? 0) <= 0) {
    active = false;
    reasons.push("zero-price");
  }

  if (active !== (input.active ?? true)) reasons.push("active");

  return {
    category,
    active,
    optionGroup: inferred.optionGroup,
    optionLabel: inferred.optionLabel,
    rawCategory,
    reasons: Array.from(new Set(reasons))
  };
}
