import { PrismaClient } from "@prisma/client";

// On Vercel serverless, standard Prisma Client connects to Neon via TCP just fine.
// The Neon serverless adapter is only needed for edge runtimes.
const prisma = new PrismaClient();

export default prisma;
