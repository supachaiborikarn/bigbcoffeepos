import fs from "fs";
import path from "path";
import prisma from "../prisma.js";

type Match = {
  menuItemId: number;
  menuItemName: string;
  ingredientId: number;
  ingredientName: string;
  stockBranches: number[];
};

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const apply = process.env.APPLY_RECIPE_BOOTSTRAP === "1";
  const requireStockRow = process.env.RECIPE_BOOTSTRAP_REQUIRE_STOCK !== "0";
  const qty = parsePositiveNumber(process.env.RECIPE_BOOTSTRAP_QTY, 1);
  const limit = process.env.RECIPE_BOOTSTRAP_LIMIT ? Math.max(0, Math.floor(Number(process.env.RECIPE_BOOTSTRAP_LIMIT))) : null;
  const outFile = process.env.RECIPE_BOOTSTRAP_OUT || path.resolve(process.cwd(), "recipe-bootstrap-report.json");

  if (apply && process.env.ALLOW_RECIPE_BOOTSTRAP !== "1") {
    throw new Error("Set ALLOW_RECIPE_BOOTSTRAP=1 with APPLY_RECIPE_BOOTSTRAP=1 before creating recipes.");
  }

  const [menuItems, ingredients] = await Promise.all([
    prisma.menuItem.findMany({
      where: { active: true, recipes: { none: {} } },
      select: { id: true, name: true, category: true, branchType: true }
    }),
    prisma.ingredient.findMany({
      select: {
        id: true,
        name: true,
        stocks: { select: { branchId: true } }
      }
    })
  ]);

  const ingredientByName = new Map<string, typeof ingredients>();
  for (const ingredient of ingredients) {
    const key = normalizeName(ingredient.name);
    ingredientByName.set(key, [...(ingredientByName.get(key) || []), ingredient]);
  }

  const matches: Match[] = [];
  const skippedNoMatch: string[] = [];
  const skippedAmbiguous: string[] = [];
  const skippedNoStock: string[] = [];

  for (const item of menuItems) {
    const key = normalizeName(item.name);
    const candidates = ingredientByName.get(key) || [];
    if (candidates.length === 0) {
      skippedNoMatch.push(item.name);
      continue;
    }
    if (candidates.length > 1) {
      skippedAmbiguous.push(item.name);
      continue;
    }

    const [ingredient] = candidates;
    const stockBranches = ingredient.stocks.map((stock) => stock.branchId);
    if (requireStockRow && stockBranches.length === 0) {
      skippedNoStock.push(item.name);
      continue;
    }

    matches.push({
      menuItemId: item.id,
      menuItemName: item.name,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      stockBranches
    });
  }

  const selectedMatches = limit === null ? matches : matches.slice(0, limit);
  let created = 0;
  if (apply && selectedMatches.length) {
    const result = await prisma.recipe.createMany({
      data: selectedMatches.map((match) => ({
        menuItemId: match.menuItemId,
        ingredientId: match.ingredientId,
        qty
      })),
      skipDuplicates: true
    });
    created = result.count;
  }

  const report = {
    checkedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    qty,
    requireStockRow,
    scannedMenuItemsWithoutRecipe: menuItems.length,
    exactMatches: matches.length,
    selectedMatches: selectedMatches.length,
    created,
    skipped: {
      noMatch: skippedNoMatch.length,
      ambiguous: skippedAmbiguous.length,
      noStock: skippedNoStock.length
    },
    samples: {
      matches: selectedMatches.slice(0, 20),
      noMatch: skippedNoMatch.slice(0, 20),
      ambiguous: skippedAmbiguous.slice(0, 20),
      noStock: skippedNoStock.slice(0, 20)
    }
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
