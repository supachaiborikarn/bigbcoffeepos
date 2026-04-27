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
  branchType?: string;
}) {
  return prisma.menuItem.create({
    data: {
      name: input.name,
      category: input.category,
      basePrice: input.basePrice,
      sku: input.sku || null,
      barcode: input.barcode || null,
      cost: input.cost || null,
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
    cost: number;
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
      ...(input.cost !== undefined ? { cost: input.cost } : {})
    }
  });
}
