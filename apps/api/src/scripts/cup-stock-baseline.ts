// One-off: align cup stock items with POSPOS topping names and set the starting
// count for a branch. Dry run by default; pass --apply to write.
//
//   npx tsx src/scripts/cup-stock-baseline.ts            # preview
//   npx tsx src/scripts/cup-stock-baseline.ts --apply    # write
//
// Guards: each rename only runs if the row still has the expected old name and
// the new name is unused. Counts are logged as COUNT stock movements.
import prisma from "../prisma.js";

const APPLY = process.argv.includes("--apply");
const BRANCH_ID = 1; // Big B Coffee วัชรเกียรติ — counted from POSPOS on 2026-10-10
const REORDER_LEVEL = 100;
const CUPS = [
  { id: 1482, from: "แก้วพลาสติก 16oz", to: "แก้วเย็น cold", count: 161 },
  { id: 329, from: "แก้วร้อนแยก", to: "แก้วร้อน HOT", count: 47 }
];

for (const cup of CUPS) {
  const row = await prisma.ingredient.findUnique({ where: { id: cup.id }, include: { stocks: true } });
  if (!row) { console.log(`#${cup.id}: not found — skipped`); continue; }

  if (row.name === cup.to) console.log(`#${cup.id}: already named "${cup.to}"`);
  else if (row.name !== cup.from) { console.log(`#${cup.id}: name is "${row.name}", expected "${cup.from}" — skipped`); continue; }
  else {
    const clash = await prisma.ingredient.findFirst({ where: { name: cup.to, NOT: { id: cup.id } }, select: { id: true } });
    if (clash) { console.log(`#${cup.id}: "${cup.to}" already used by #${clash.id} — skipped`); continue; }
    console.log(`#${cup.id}: rename "${cup.from}" → "${cup.to}"`);
    if (APPLY) await prisma.ingredient.update({ where: { id: cup.id }, data: { name: cup.to } });
  }

  for (const stock of row.stocks) {
    const isBaseline = stock.branchId === BRANCH_ID;
    const delta = isBaseline ? Math.round((cup.count - stock.stockQty) * 1000) / 1000 : 0;
    console.log(`  branch ${stock.branchId}: qty ${stock.stockQty}${isBaseline ? ` → ${cup.count} (${delta >= 0 ? "+" : ""}${delta})` : " (unchanged)"}, alert ${stock.reorderLevel} → ${REORDER_LEVEL}`);
    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      await tx.ingredientStock.update({
        where: { branchId_ingredientId: { branchId: stock.branchId, ingredientId: cup.id } },
        data: { reorderLevel: REORDER_LEVEL, ...(isBaseline && delta !== 0 ? { stockQty: { increment: delta } } : {}) }
      });
      if (isBaseline && delta !== 0) {
        await tx.stockMovement.create({
          data: { branchId: stock.branchId, ingredientId: cup.id, qty: delta, reason: `COUNT: ตั้งยอดตั้งต้นจาก POSPOS ${cup.count} (ระบบ ${stock.stockQty})` }
        });
      }
    });
  }
}

console.log(APPLY ? "Applied." : "Dry run only — re-run with --apply to write.");
await prisma.$disconnect();
