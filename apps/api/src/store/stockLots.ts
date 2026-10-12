import { Prisma } from "@prisma/client";

const round = (value: number) => Math.round(value * 10000) / 10000;

/** Lot records supplement branch stock; older inventory may have no recorded lot. */
export async function consumeStockLots(tx: Prisma.TransactionClient, branchId: number, ingredientId: number, qty: number) {
  const lots = await tx.$queryRaw<Array<{ id: number; qty: number }>>(Prisma.sql`SELECT id, qty FROM inventory_lots WHERE branch_id = ${branchId} AND ingredient_id = ${ingredientId} AND qty > 0 ORDER BY expiry_date ASC NULLS LAST, created_at ASC, id ASC FOR UPDATE`);
  let remaining = qty;
  const allocations: Array<{ lotId: number; qty: number }> = [];
  for (const lot of lots) {
    const taken = round(Math.min(remaining, lot.qty));
    if (remaining <= 0) break;
    if (taken <= 0) continue;
    await tx.inventoryLot.update({ where: { id: lot.id }, data: { qty: Math.max(0, round(lot.qty - taken)) } });
    allocations.push({ lotId: lot.id, qty: taken });
    remaining = round(remaining - taken);
  }
  return allocations;
}
