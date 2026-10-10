// One-off: remove the "menu → itself" recipes that the POSPOS import created for
// prepared coffee drinks. Those drinks were deducting a fake per-menu stock
// (999.8k in POSPOS) strictly, which blocks checkout once it runs out. Drinks are
// now limited by cups instead. Retail items (bottles, cans, snacks) keep their
// self-recipes because that stock is real.
//
//   npx tsx src/scripts/remove-drink-self-recipes.ts                 # dry run → CSV for review
//   npx tsx src/scripts/remove-drink-self-recipes.ts --apply         # backup JSON, then delete
//   npx tsx src/scripts/remove-drink-self-recipes.ts --restore <backup.json>
//
// Classification reuses the POS rule that decides which menus get the cup /
// sweetness options, so "drink" here means exactly what the cashier sees as one.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import prisma from "../prisma.js";

// Loaded at runtime (tsx) so the API build doesn't compile web sources.
const menuRulesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/src/utils/menuRules.ts");
const { isCupVariantMenuItem, shouldUseModifierModal } = await import(pathToFileURL(menuRulesPath).href) as {
  isCupVariantMenuItem: (item: unknown) => boolean;
  shouldUseModifierModal: (item: unknown) => boolean;
};

const outDir = path.resolve(process.cwd(), "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const restoreIndex = process.argv.indexOf("--restore");

if (restoreIndex > 0) {
  const file = process.argv[restoreIndex + 1];
  const rows = JSON.parse(readFileSync(file, "utf8")) as Array<{ menuItemId: number; ingredientId: number; qty: number }>;
  const result = await prisma.recipe.createMany({ data: rows.map(({ menuItemId, ingredientId, qty }) => ({ menuItemId, ingredientId, qty })), skipDuplicates: true });
  console.log(`Restored ${result.count} of ${rows.length} recipes from ${file}`);
  await prisma.$disconnect();
  process.exit(0);
}

const APPLY = process.argv.includes("--apply");
const recipes = await prisma.recipe.findMany({
  where: { menuItem: { branchType: "coffee" } },
  include: { menuItem: true, ingredient: { select: { name: true } } }
});
const selfRecipes = recipes.filter((r) => r.menuItem.name.trim() === r.ingredient.name.trim());
const isDrink = (r: (typeof selfRecipes)[number]) => {
  const item = r.menuItem as any;
  return shouldUseModifierModal(item) || isCupVariantMenuItem(item);
};
const remove = selfRecipes.filter(isDrink);
const keep = selfRecipes.filter((r) => !isDrink(r));

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const toCsv = (rows: typeof selfRecipes, action: string) => rows.map((r) => [action, r.menuItem.id, r.menuItem.name, r.menuItem.category, r.menuItem.basePrice, r.menuItem.active ? "เปิดขาย" : "ปิดขาย"].map(csvCell).join(","));
mkdirSync(outDir, { recursive: true });
const csvPath = path.join(outDir, `drink-self-recipes-${stamp}.csv`);
writeFileSync(csvPath, "﻿" + ["การทำงาน,รหัสเมนู,ชื่อเมนู,หมวด,ราคา,สถานะ", ...toCsv(remove, "ลบสูตร (เมนูชง ใช้แก้วเป็นตัวจำกัด)"), ...toCsv(keep, "เก็บไว้ (สินค้าขายปลีก)")].join("\n"));

const byCategory = (rows: typeof selfRecipes) => Object.entries(rows.reduce<Record<string, number>>((acc, r) => { acc[r.menuItem.category] = (acc[r.menuItem.category] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
console.log(`Self recipes: ${selfRecipes.length} · remove (drinks): ${remove.length} · keep (retail): ${keep.length}`);
console.log("remove by category:", JSON.stringify(byCategory(remove)));
console.log("keep by category:", JSON.stringify(byCategory(keep)));
console.log(`Review list: ${csvPath}`);

if (APPLY && remove.length) {
  const backupPath = path.join(outDir, `drink-self-recipes-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(remove.map((r) => ({ id: r.id, menuItemId: r.menuItemId, ingredientId: r.ingredientId, qty: r.qty, menuName: r.menuItem.name })), null, 2));
  const deleted = await prisma.recipe.deleteMany({ where: { id: { in: remove.map((r) => r.id) } } });
  console.log(`Deleted ${deleted.count} recipes. Backup: ${backupPath} (restore with --restore <file>)`);
} else if (!APPLY) {
  console.log("Dry run only — nothing deleted.");
}
await prisma.$disconnect();
