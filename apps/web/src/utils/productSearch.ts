import type { MenuItem } from "../types";

/** POSPOS-style short codes are case-insensitive; spaces around the code are ignored. */
export function normalizeProductCode(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isExactProductCodeMatch(item: MenuItem, search: string): boolean {
  const code = normalizeProductCode(search);
  return Boolean(code) && (normalizeProductCode(item.sku) === code || normalizeProductCode(item.barcode) === code);
}

/** Find only saleable products in the selected branch; never silently choose an ambiguous code. */
export function findExactProductCodeMatches(menu: MenuItem[], search: string, branchType?: string): MenuItem[] {
  return menu.filter((item) =>
    item.active &&
    (!branchType || item.branchType === branchType) &&
    isExactProductCodeMatch(item, search)
  );
}

export function filterPosMenuProducts(
  menu: MenuItem[],
  {
    search,
    category,
    branchType,
    isHiddenByDefault,
  }: {
    search: string;
    category: string;
    branchType?: string;
    isHiddenByDefault: (item: MenuItem) => boolean;
  }
): MenuItem[] {
  const query = normalizeProductCode(search);
  const available = menu.filter((item) => item.active && (!branchType || item.branchType === branchType));

  if (!query) {
    return available.filter((item) =>
      !isHiddenByDefault(item) && (category === "ทั้งหมด" || item.category === category)
    );
  }

  // Code lookup searches all categories, and may select a normally hidden cup variant.
  // Exact matches take precedence over a name/partial-SKU match (e.g. C1 before C12).
  const exact = available.filter((item) => isExactProductCodeMatch(item, query));
  if (exact.length > 0) return exact;

  return available.filter((item) => {
    const matchesCode = [item.sku, item.barcode]
      .some((value) => normalizeProductCode(value).includes(query));
    if (matchesCode) return true;

    return !isHiddenByDefault(item) &&
      [item.name, item.optionGroup, item.optionLabel].some((value) => normalizeProductCode(value).includes(query));
  });
}
