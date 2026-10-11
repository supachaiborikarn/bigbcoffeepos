/** Keep imported category keys intact for filters and promotions; tidy their display names. */
export function displayCategoryLabel(category: string): string {
  return category.replace(/POSPOS/gi, "").replace(/^[\s·:_/-]+|[\s·:_/-]+$/g, "").replace(/\s+/g, " ").trim() || "สินค้านำเข้า";
}
