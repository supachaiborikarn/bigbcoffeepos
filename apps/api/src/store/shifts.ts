import prisma from "../prisma.js";

export async function openShift(input: { branchId: number; userId?: number; openingCash: number }) {
  const existing = await prisma.shift.findFirst({
    where: { branchId: input.branchId, status: "OPEN" }
  });
  if (existing) throw new Error("สาขานี้มีกะเปิดอยู่แล้ว กรุณาปิดกะก่อน");

  const shift = await prisma.shift.create({
    data: {
      branchId: input.branchId,
      userId: input.userId ?? null,
      openingCash: input.openingCash
    }
  });
  return getShift(shift.id);
}

export async function closeShift(id: number, closingCash: number) {
  const shift = await getShift(id);
  if (!shift) throw new Error("ไม่พบกะที่ระบุ");
  if (shift.status !== "OPEN") throw new Error("กะนี้ปิดไปแล้ว");

  const expectedCash = shift.openingCash + shift.cashSales;
  const difference = closingCash - expectedCash;

  await prisma.shift.update({
    where: { id },
    data: {
      closingCash,
      expectedCash,
      difference,
      status: "CLOSED",
      closedAt: new Date()
    }
  });

  return getShift(id);
}

export async function getCurrentShift(branchId: number) {
  return prisma.shift.findFirst({
    where: { branchId, status: "OPEN" },
    orderBy: { id: "desc" }
  });
}

export async function getShift(id: number) {
  return prisma.shift.findUnique({
    where: { id }
  });
}

export async function getShifts(branchId?: number) {
  return prisma.shift.findMany({
    where: branchId ? { branchId } : undefined,
    orderBy: { id: "desc" }
  });
}
