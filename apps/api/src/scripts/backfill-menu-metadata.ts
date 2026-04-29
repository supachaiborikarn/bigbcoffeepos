import prisma from "../prisma.js";

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function normalizeCategory(rawCategory: string, name: string, branchType: string) {
  const value = rawCategory.trim();
  const normalized = compact(`${value} ${name}`);
  if (!value || compact(value) === "ไม่ระบุ") return branchType === "oil_service" ? "บริการน้ำมัน" : "อื่นๆ";
  const rules = [
    { category: "กาแฟ", keywords: ["กาแฟ", "coffee", "espresso", "americano", "latte", "mocha", "คาปู", "ลาเต้", "มอคค่า"] },
    { category: "ชา", keywords: ["ชา", "tea", "matcha", "มัทฉะ"] },
    { category: "นม/โกโก้", keywords: ["นม", "โกโก้", "cocoa", "milk"] },
    { category: "เครื่องดื่มพร้อมขาย", keywords: ["ตู้แช่", "น้ำดื่ม", "เครื่องดื่ม", "c-vitt", "drink"] },
    { category: "เบเกอรี่/ขนม", keywords: ["ขนม", "เค้ก", "คุกกี้", "bakery", "cookie", "ครัวซอง"] },
    { category: "ไอติม", keywords: ["ไอติม", "icecream", "ice cream"] },
    { category: "น้ำมันเครื่อง", keywords: ["น้ำมัน", "oil"] },
    { category: "อะไหล่/ไส้กรอง", keywords: ["ไส้กรอง", "filter"] },
    { category: "บริการ", keywords: ["บริการ", "service", "ค่าแรง"] },
  ];
  return rules.find((rule) => rule.keywords.some((keyword) => normalized.includes(compact(keyword))))?.category ?? value;
}

function inferVariantInfo(name: string) {
  const variants = ["ร้อน", "เย็น", "ปั่น", "เล็ก", "กลาง", "ใหญ่", "หวานน้อย", "ไม่หวาน", "เพิ่มช็อต"];
  const labels = variants.filter((variant) => name.includes(variant));
  if (labels.length === 0) return { optionGroup: null, optionLabel: null };
  const optionLabel = labels.join(" / ");
  const optionGroup = labels.reduce((current, label) => current.replaceAll(label, ""), name)
    .replace(/[()（）\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { optionGroup: optionGroup || name, optionLabel };
}

function mergeMetadata(raw: string | null | undefined, patch: Record<string, unknown>) {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return JSON.stringify({ ...parsed, ...patch });
  } catch {
    return JSON.stringify(patch);
  }
}

const items = await prisma.menuItem.findMany();
let updated = 0;

for (const item of items) {
  const category = normalizeCategory(item.category, item.name, item.branchType);
  const inferred = inferVariantInfo(item.name);
  const optionGroup = item.optionGroup || inferred.optionGroup;
  const optionLabel = item.optionLabel || inferred.optionLabel;
  const shouldUpdate =
    item.category !== category ||
    item.optionGroup !== optionGroup ||
    item.optionLabel !== optionLabel;

  if (!shouldUpdate) continue;

  await prisma.menuItem.update({
    where: { id: item.id },
    data: {
      category,
      optionGroup,
      optionLabel,
      metadata: mergeMetadata(item.metadata, {
        categoryNormalizedFrom: item.category,
        metadataBackfilledAt: new Date().toISOString(),
      }),
    },
  });
  updated++;
}

console.log(JSON.stringify({ scanned: items.length, updated }));
await prisma.$disconnect();
