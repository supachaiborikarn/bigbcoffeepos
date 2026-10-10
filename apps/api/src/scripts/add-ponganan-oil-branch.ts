import "../env.js";
import { PrismaClient } from "@prisma/client";

const name = "บ่อถ่ายน้ำมัน พงษ์อนันต์";
const apply = process.argv.includes("--apply");
const connection = new URL(process.env.DATABASE_URL!);
connection.searchParams.set("connect_timeout", "5");
connection.searchParams.set("pool_timeout", "5");
const db = new PrismaClient({ datasourceUrl: connection.toString() });
try {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(51090605)`;
    const existing = await tx.branch.findFirst({ where: { name, branchType: "oil_service" }, select: { id: true, name: true, branchType: true, active: true } });
    if (existing) return { action: "already_exists", branch: existing };
    if (!apply) return { action: "ready_to_create", branch: { name, branchType: "oil_service" } };
    const branch = await tx.branch.create({ data: { name, branchType: "oil_service", active: true }, select: { id: true, name: true, branchType: true, active: true } });
    return { action: "created", branch };
  }, { timeout: 15000 });
  console.log(JSON.stringify(result));
} catch (error: any) {
  console.error(JSON.stringify({ status: "failed", code: error?.code || error?.name }));
  process.exitCode = 1;
} finally { await db.$disconnect(); }
