import prisma from "../prisma.js";

export async function getMenu() {
  return prisma.menuItem.findMany({ orderBy: { id: "asc" } });
}

export async function getMenuItem(id: number) {
  return prisma.menuItem.findUnique({ where: { id } });
}

export async function addMenuItem(input: {
  name: string;
  category: string;
  basePrice: number;
  sku?: string;
  barcode?: string;
  cost?: number;
  imageUrl?: string | null;
  unit?: string | null;
  taxRate?: number | null;
  source?: string | null;
  sourceId?: string | null;
  optionGroup?: string | null;
  optionLabel?: string | null;
  metadata?: string;
  branchType?: string;
}) {
  return prisma.menuItem.create({
    data: {
      name: input.name,
      category: input.category,
      basePrice: input.basePrice,
      sku: input.sku || null,
      barcode: input.barcode || null,
      cost: input.cost ?? null,
      imageUrl: input.imageUrl || null,
      unit: input.unit || null,
      taxRate: input.taxRate ?? null,
      source: input.source || null,
      sourceId: input.sourceId || null,
      optionGroup: input.optionGroup || null,
      optionLabel: input.optionLabel || null,
      metadata: input.metadata || "{}",
      branchType: input.branchType || "coffee"
    }
  });
}

export async function updateMenuItem(
  id: number,
  input: Partial<{
    name: string;
    category: string;
    basePrice: number;
    active: boolean;
    sku: string;
    barcode: string;
    cost: number | null;
    imageUrl: string | null;
    unit: string | null;
    taxRate: number | null;
    source: string | null;
    sourceId: string | null;
    optionGroup: string | null;
    optionLabel: string | null;
    metadata: string;
    branchType: string;
  }>
) {
  const item = await getMenuItem(id);
  if (!item) return null;

  return prisma.menuItem.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.sku !== undefined ? { sku: input.sku || null } : {}),
      ...(input.barcode !== undefined ? { barcode: input.barcode || null } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl || null } : {}),
      ...(input.unit !== undefined ? { unit: input.unit || null } : {}),
      ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
      ...(input.source !== undefined ? { source: input.source || null } : {}),
      ...(input.sourceId !== undefined ? { sourceId: input.sourceId || null } : {}),
      ...(input.optionGroup !== undefined ? { optionGroup: input.optionGroup || null } : {}),
      ...(input.optionLabel !== undefined ? { optionLabel: input.optionLabel || null } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata || "{}" } : {}),
      ...(input.branchType !== undefined ? { branchType: input.branchType } : {})
    }
  });
}
