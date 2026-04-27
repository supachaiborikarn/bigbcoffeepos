import prisma from "../prisma.js";

export async function getBranches() {
  return prisma.branch.findMany({ orderBy: { id: "asc" } });
}

export async function getBranch(id: number) {
  return prisma.branch.findUnique({ where: { id } });
}
