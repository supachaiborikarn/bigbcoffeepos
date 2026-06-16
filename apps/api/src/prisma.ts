import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

function isNeonDatabaseUrl(value: string | undefined) {
  if (!value) return false;
  try {
    return new URL(value).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

const prisma = isNeonDatabaseUrl(process.env.DATABASE_URL)
  ? new PrismaClient({
      adapter: new PrismaNeon({
        connectionString: process.env.DATABASE_URL
      })
    })
  : new PrismaClient();

export default prisma;
