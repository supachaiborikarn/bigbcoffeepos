// One rule for every "low stock" number (stock page, branch dashboard, admin dashboard).
// Only items with an alert level set are watched: most catalog rows sit at 0 with no level
// because nobody counts them, and counting those made the stock page say 1,222 while the
// dashboard said 2.
export function needsRestock(item: { stockQty: number; reorderLevel: number }) {
  return item.reorderLevel > 0 && item.stockQty <= item.reorderLevel;
}
