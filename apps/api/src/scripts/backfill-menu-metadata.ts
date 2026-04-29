import prisma from "../prisma.js";
import { classifyMenuItem, mergeMenuMetadata } from "../utils/menu-data-cleaning.js";

const items = await prisma.menuItem.findMany();
let updated = 0;

for (const item of items) {
  const classification = classifyMenuItem(item);
  const shouldUpdate =
    item.category !== classification.category ||
    item.optionGroup !== classification.optionGroup ||
    item.optionLabel !== classification.optionLabel ||
    item.active !== classification.active;

  if (!shouldUpdate) continue;

  await prisma.menuItem.update({
    where: { id: item.id },
    data: {
      category: classification.category,
      optionGroup: classification.optionGroup,
      optionLabel: classification.optionLabel,
      active: classification.active,
      metadata: mergeMenuMetadata(item.metadata, {
        categoryNormalizedFrom: classification.rawCategory ?? item.category,
        metadataBackfilledAt: new Date().toISOString(),
        metadataBackfillReasons: classification.reasons,
      }),
    },
  });
  updated++;
}

console.log(JSON.stringify({ scanned: items.length, updated }));
await prisma.$disconnect();
