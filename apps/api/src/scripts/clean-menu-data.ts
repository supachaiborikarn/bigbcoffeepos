import prisma from "../prisma.js";
import { classifyMenuItem, mergeMenuMetadata } from "../utils/menu-data-cleaning.js";

const applyChanges = process.argv.includes("--apply");
const sampleLimit = Number(process.env.CLEAN_MENU_SAMPLE_LIMIT ?? 30);

const items = await prisma.menuItem.findMany({ orderBy: { id: "asc" } });
const now = new Date().toISOString();
const changes: Array<{
  id: number;
  name: string;
  branchType: string;
  fromCategory: string;
  toCategory: string;
  fromActive: boolean;
  toActive: boolean;
  fromOptionGroup: string | null;
  toOptionGroup: string | null;
  fromOptionLabel: string | null;
  toOptionLabel: string | null;
  rawCategory: string | null;
  reasons: string[];
}> = [];

const categoryChanges = new Map<string, number>();
const reasonCounts = new Map<string, number>();

for (const item of items) {
  const classification = classifyMenuItem(item);
  const shouldUpdate =
    item.category !== classification.category ||
    item.active !== classification.active ||
    item.optionGroup !== classification.optionGroup ||
    item.optionLabel !== classification.optionLabel;

  if (!shouldUpdate) continue;

  const fromTo = `${item.category || "(blank)"} -> ${classification.category}`;
  categoryChanges.set(fromTo, (categoryChanges.get(fromTo) ?? 0) + 1);
  for (const reason of classification.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);

  changes.push({
    id: item.id,
    name: item.name,
    branchType: item.branchType,
    fromCategory: item.category,
    toCategory: classification.category,
    fromActive: item.active,
    toActive: classification.active,
    fromOptionGroup: item.optionGroup,
    toOptionGroup: classification.optionGroup,
    fromOptionLabel: item.optionLabel,
    toOptionLabel: classification.optionLabel,
    rawCategory: classification.rawCategory,
    reasons: classification.reasons,
  });

  if (applyChanges) {
    await prisma.menuItem.update({
      where: { id: item.id },
      data: {
        category: classification.category,
        active: classification.active,
        optionGroup: classification.optionGroup,
        optionLabel: classification.optionLabel,
        metadata: mergeMenuMetadata(item.metadata, {
          categoryNormalizedFrom: classification.rawCategory ?? item.category,
          menuDataCleanedAt: now,
          menuDataCleanupReasons: classification.reasons,
        }),
      },
    });
  }
}

const summary = {
  mode: applyChanges ? "apply" : "dry-run",
  scanned: items.length,
  changed: changes.length,
  applied: applyChanges ? changes.length : 0,
  categoryChanges: Object.fromEntries(Array.from(categoryChanges.entries()).sort((a, b) => b[1] - a[1])),
  reasonCounts: Object.fromEntries(Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1])),
  samples: changes.slice(0, sampleLimit),
};

console.log(JSON.stringify(summary, null, 2));
await prisma.$disconnect();
