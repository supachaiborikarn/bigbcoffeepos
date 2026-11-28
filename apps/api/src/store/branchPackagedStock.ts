// The catalog is shared across coffee shops, but these packaged goods were
// counted and configured only in Big B Watcharakiat. Do not add global recipes
// here: other stores may intentionally carry no stock for these menu items.
// Source: verified branch stock count #9 and the matching paid order lines.
const WATCHARAKIAT_BRANCH_ID = 1;
const WATCHARAKIAT_PACKAGED_STOCK: ReadonlyMap<number, number> = new Map([
  [1212, 1147], // black bean ice cream
  [1213, 1573], // Choco Crush Lava
  [1220, 1567], // Choco Crush Hokkaido cookie
  [1231, 1001], // Splash orange
  [1232, 947],  // 7 Up
  [1233, 1582], // Coke Zero
  [1236, 1596], // Aice vanilla mochi
  [1242, 1591], // blue Fanta
  [1243, 1380], // sunflower seeds
  [1244, 1270], // taro ice cream
  [1250, 988],  // Ready red
  [1251, 1590]  // M-150
]);

export function getBranchPackagedStockRequirements(
  branchId: number,
  branchType: string,
  quantityByMenuId: ReadonlyMap<number, number>,
  recipeMenuIds: ReadonlySet<number>
): Array<{ ingredientId: number; qty: number }> {
  if (branchId !== WATCHARAKIAT_BRANCH_ID || branchType !== "coffee") return [];

  const requirements: Array<{ ingredientId: number; qty: number }> = [];
  for (const [menuItemId, qty] of quantityByMenuId) {
    // An explicit recipe takes precedence; never decrement twice.
    if (recipeMenuIds.has(menuItemId) || !Number.isFinite(qty) || qty <= 0) continue;
    const ingredientId = WATCHARAKIAT_PACKAGED_STOCK.get(menuItemId);
    if (ingredientId !== undefined) requirements.push({ ingredientId, qty });
  }
  return requirements;
}
