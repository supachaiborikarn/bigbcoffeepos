import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import prisma from "../prisma.js";

type TableCount = {
  table: string;
  live: number;
  restored: number;
};

const RESTORE_DATABASE_URL = process.env.RESTORE_DATABASE_URL;
const RESTORE_DRILL_OUT = process.env.RESTORE_DRILL_OUT || path.resolve(process.cwd(), "restore-drill-report.json");
const REQUIRED_TABLES = [
  "branch",
  "user",
  "menuItem",
  "ingredient",
  "ingredientStock",
  "order",
  "orderItem",
  "payment",
  "orderEvent",
  "shift",
  "integrationOutbox"
] as const;

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function tableCount(client: PrismaClient, table: typeof REQUIRED_TABLES[number]) {
  const model = (client as any)[table];
  if (!model?.count) throw new Error(`Prisma model not found: ${table}`);
  return Number(await model.count());
}

async function collectCounts(live: PrismaClient, restored: PrismaClient): Promise<TableCount[]> {
  const rows: TableCount[] = [];
  for (const table of REQUIRED_TABLES) {
    rows.push({
      table,
      live: await tableCount(live, table),
      restored: await tableCount(restored, table)
    });
  }
  return rows;
}

async function main() {
  if (!RESTORE_DATABASE_URL) {
    console.log("Backup restore check skipped: set RESTORE_DATABASE_URL to a restored PostgreSQL database.");
    console.log("Required drill: restore provider snapshot/PITR to staging, then run this script and archive the JSON report.");
    await prisma.$disconnect();
    return;
  }

  assert(RESTORE_DATABASE_URL.startsWith("postgresql://") || RESTORE_DATABASE_URL.startsWith("postgres://"), "RESTORE_DATABASE_URL must be PostgreSQL");
  assert(RESTORE_DATABASE_URL !== process.env.DATABASE_URL, "RESTORE_DATABASE_URL must point to a separate restored database");

  const restored = new PrismaClient({
    datasources: { db: { url: RESTORE_DATABASE_URL } }
  } as any);

  try {
    const counts = await collectCounts(prisma, restored);
    const hasCoreData = counts.some((row) => row.table === "branch" && row.restored > 0)
      && counts.some((row) => row.table === "menuItem" && row.restored > 0);
    assert(hasCoreData, "Restored database does not contain core branch/menu data");

    const report = {
      checkedAt: new Date().toISOString(),
      liveDatabaseUrlHash: Buffer.from(String(process.env.DATABASE_URL ?? "")).toString("base64").slice(0, 18),
      restoredDatabaseUrlHash: Buffer.from(RESTORE_DATABASE_URL).toString("base64").slice(0, 18),
      counts,
      rollbackSteps: [
        "Stop new deploy traffic.",
        "Promote restored database or repoint DATABASE_URL after owner approval.",
        "Run npm run db:migrate:status --workspace apps/api.",
        "Run npm run checkout:integration --workspace apps/api.",
        "Run smoke checks for login, branch select, shift, checkout, refund, reports."
      ]
    };

    fs.mkdirSync(path.dirname(RESTORE_DRILL_OUT), { recursive: true });
    fs.writeFileSync(RESTORE_DRILL_OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log("Backup restore check passed");
    console.log(`Report written: ${RESTORE_DRILL_OUT}`);
  } finally {
    await restored.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
