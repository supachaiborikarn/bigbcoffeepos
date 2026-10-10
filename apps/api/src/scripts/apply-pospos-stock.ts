// Set BB POS stock to POSPOS quantities from a reviewed diff file.
// Dry run by default; --apply writes (backup JSON first, COUNT movements logged).
//
//   npx tsx src/scripts/apply-pospos-stock.ts <diffs.json>
//   npx tsx src/scripts/apply-pospos-stock.ts <diffs.json> --apply
//
// diffs.json: { branchId, source, rows: [[name, bbQtyAtCompare, posposQty], ...] }
// Guards: exact single name match only; never creates items; skips rows whose BB
// quantity changed since the comparison (e.g. a sale happened in between).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prisma from "../prisma.js";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");
// --skip-zero: leave items POSPOS reports as 0 (or below) untouched, so shelf stock
// that POSPOS hasn't counted yet doesn't get blocked from sale in BB POS.
const SKIP_ZERO = process.argv.includes("--skip-zero");
if (!file) { console.error("usage: apply-pospos-stock.ts <diffs.json> [--apply]"); process.exit(1); }
const { branchId, rows } = JSON.parse(readFileSync(file, "utf8")) as { branchId: number; rows: Array<[string, number, number]> };

const strictIds = new Set((await prisma.recipe.findMany({ select: { ingredientId: true } })).map((r) => r.ingredientId));
const plan: Array<{ ingredientId: number; name: string; from: number; to: number; strict: boolean }> = [];
const missing: string[] = [], ambiguous: string[] = [], changed: Array<[string, number, number]> = [];

let skippedZero = 0;
for (const [name, bbAtCompare, pospos] of rows) {
  if (SKIP_ZERO && pospos <= 0) { skippedZero += 1; continue; }
  const matches = await prisma.ingredient.findMany({ where: { name: name.trim() }, select: { id: true } });
  if (matches.length === 0) { missing.push(name); continue; }
  if (matches.length > 1) { ambiguous.push(name); continue; }
  const id = matches[0].id;
  const stock = await prisma.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId: id } } });
  const current = stock?.stockQty ?? 0;
  if (Math.abs(current - bbAtCompare) > 1e-9) { changed.push([name, bbAtCompare, current]); continue; }
  if (current === pospos) continue;
  plan.push({ ingredientId: id, name, from: current, to: pospos, strict: strictIds.has(id) });
}

const toZeroStrict = plan.filter((p) => p.to <= 0 && p.strict);
console.log(`rows ${rows.length}${SKIP_ZERO ? ` · skipped POSPOS≤0 ${skippedZero}` : ""} · will update ${plan.length} · not in BB POS ${missing.length} · ambiguous ${ambiguous.length} · changed since compare ${changed.length}`);
console.log(`  up: ${plan.filter((p) => p.to > p.from).length} · down: ${plan.filter((p) => p.to < p.from).length} · become 0 & sold with strict stock (sale blocked until received): ${toZeroStrict.length}`);
if (missing.length) console.log("  not in BB POS:", missing.join(", "));
if (ambiguous.length) console.log("  ambiguous:", ambiguous.join(", "));
if (changed.length) console.log("  changed since compare:", JSON.stringify(changed));
if (toZeroStrict.length) console.log("  → 0 (strict):", toZeroStrict.map((p) => p.name).join(", "));

if (APPLY && plan.length) {
  const dir = path.resolve(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `pospos-stock-backup-branch${branchId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backup, JSON.stringify(plan.map(({ ingredientId, name, from }) => ({ branchId, ingredientId, name, stockQty: from })), null, 2));
  for (const p of plan) {
    await prisma.$transaction(async (tx) => {
      await tx.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId, ingredientId: p.ingredientId } },
        update: { stockQty: p.to },
        create: { branchId, ingredientId: p.ingredientId, stockQty: p.to, reorderLevel: 0 }
      });
      await tx.stockMovement.create({ data: { branchId, ingredientId: p.ingredientId, qty: Math.round((p.to - p.from) * 1000) / 1000, reason: `COUNT: ตามยอด POSPOS ${p.to} (ระบบ ${p.from})` } });
    });
  }
  console.log(`Applied ${plan.length}. Backup of previous quantities: ${backup}`);
} else if (!APPLY) console.log("Dry run only — nothing written.");
await prisma.$disconnect();
