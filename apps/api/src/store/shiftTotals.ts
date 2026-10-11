type ShiftSales = { id: number; totalSales: number; totalOrders: number; cashSales: number; qrSales: number; cardSales: number };

/** Order rows are authoritative; the cached shift totals may come from an older double reversal. */
export async function getShiftSalesTotals(client: any, shift: ShiftSales) {
  const groups: Array<{ status: string; paymentMethod: string; _sum: { total: number | null }; _count: { _all: number } }> = await client.order.groupBy({
    by: ["status", "paymentMethod"], where: { shiftId: shift.id }, _sum: { total: true }, _count: { _all: true }
  });
  if (!groups.length) return {
    totalSales: Math.max(0, shift.totalSales), totalOrders: Math.max(0, shift.totalOrders),
    cashSales: Math.max(0, shift.cashSales), qrSales: Math.max(0, shift.qrSales), cardSales: Math.max(0, shift.cardSales)
  };
  const totals = { totalSales: 0, totalOrders: 0, cashSales: 0, qrSales: 0, cardSales: 0 };
  for (const group of groups) {
    if (group.status === "CANCELLED" || group.status === "REFUNDED") continue;
    const amount = group._sum.total ?? 0;
    totals.totalOrders += group._count._all;
    totals.totalSales += amount;
    if (group.paymentMethod === "CASH") totals.cashSales += amount;
    else if (group.paymentMethod === "QR") totals.qrSales += amount;
    else totals.cardSales += amount;
  }
  for (const key of ["totalSales", "cashSales", "qrSales", "cardSales"] as const) totals[key] = Math.round(totals[key] * 100) / 100;
  return totals;
}
