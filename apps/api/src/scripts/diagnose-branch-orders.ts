import "../env.js";
import { PrismaClient } from "@prisma/client";

// Incident inspection only: PostgreSQL rejects writes in this transaction.
const db = new PrismaClient();
const day = process.argv[2] ?? "2026-10-12";
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Expected YYYY-MM-DD");
const start = new Date(`${day}T00:00:00+07:00`);
const end = new Date(start.getTime() + 86_400_000);

try {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const branches = await tx.branch.findMany({ where: { name: { contains: "วัชร" } }, select: { id: true, name: true, active: true } });
    const branchIds = branches.map((b) => b.id);
    const orders = await tx.order.findMany({
      where: { branchId: { in: branchIds }, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "asc" },
      select: { id: true, branchId: true, userId: true, shiftId: true, status: true, total: true, paymentMethod: true, idempotencyKey: true, createdAt: true, items: { select: { menuItemId: true, name: true, qty: true, lineTotal: true } }, payments: { select: { status: true, amountDue: true, createdAt: true } }, events: { select: { eventType: true, reason: true, createdAt: true } } }
    });
    const migrations = await tx.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 8`;
    const audits = await tx.$queryRaw`SELECT ts, action, actor_id, request_id, details FROM audit_events WHERE ts >= ${start} AND ts < ${end} AND branch_id = ANY(${branchIds}::int[]) ORDER BY ts DESC LIMIT 40`;
    return { day, branches, orders, migrations, audits };
  }, { timeout: 30_000 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = String(error).replaceAll(process.env.DATABASE_URL ?? "[unset]", "[DATABASE]");
  console.error(message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
