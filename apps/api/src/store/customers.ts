import prisma from "../prisma.js";

export async function getCustomers(search?: string) {
  if (!search) {
    return prisma.customer.findMany({
      orderBy: { id: "desc" }
    });
  }
  return prisma.customer.findMany({
    where: {
      OR: [
        { phone: { contains: search } },
        { name: { contains: search } }
      ]
    },
    orderBy: { id: "desc" }
  });
}

export async function getCustomer(id: number) {
  return prisma.customer.findUnique({ where: { id } });
}

export async function addCustomer(input: { name: string; phone: string }) {
  const existing = await prisma.customer.findUnique({ where: { phone: input.phone } });
  if (existing) throw new Error("เบอร์โทรนี้เป็นสมาชิกอยู่แล้ว");
  return prisma.customer.create({
    data: { name: input.name, phone: input.phone }
  });
}

export async function updateCustomer(id: number, input: Partial<{ name: string; phone: string }>) {
  if (input.phone) {
    const dup = await prisma.customer.findFirst({
      where: { phone: input.phone, id: { not: id } }
    });
    if (dup) throw new Error("เบอร์โทรนี้ถูกใช้งานแล้ว");
  }
  return prisma.customer.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {})
    }
  });
}

export async function updateCustomerPoints(id: number, delta: number) {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return;
  const newPoints = Math.max(0, customer.points + delta);
  return prisma.customer.update({
    where: { id },
    data: { points: newPoints }
  });
}
