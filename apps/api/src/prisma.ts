import { PrismaClient } from "@prisma/client";
import { Pool } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl || databaseUrl.includes("placeholder") || databaseUrl.startsWith("file:")) {
    console.warn("[DB] Using standard Prisma client (local/SQLite mode)");
    return new PrismaClient();
  }

  // Neon serverless adapter for PostgreSQL
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaNeon(pool as any);
  return new PrismaClient({ adapter } as any);
}

const prisma = createPrismaClient();

export default prisma;
