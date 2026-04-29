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

export async function getCustomerInsights(input: { inactiveDays?: number; limit?: number } = {}) {
  const inactiveDays = Number.isFinite(input.inactiveDays) && input.inactiveDays! > 0 ? input.inactiveDays! : 60;
  const limit = Number.isFinite(input.limit) && input.limit! > 0 ? Math.min(input.limit!, 50) : 10;
  const inactiveCutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [customers, spendRows, recentRows] = await Promise.all([
    prisma.customer.findMany({
      select: { id: true, name: true, phone: true, points: true, createdAt: true }
    }),
    prisma.order.groupBy({
      by: ["customerId"],
      where: {
        customerId: { not: null },
        status: { notIn: ["CANCELLED", "REFUNDED"] }
      },
      _count: { _all: true },
      _sum: { total: true },
      _max: { createdAt: true }
    }),
    prisma.order.groupBy({
      by: ["customerId"],
      where: {
        customerId: { not: null },
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        createdAt: { gte: recentCutoff }
      },
      _sum: { total: true }
    })
  ]);

  const spendByCustomerId = new Map(spendRows.map((row) => [row.customerId, row]));
  const recentSpendByCustomerId = new Map(recentRows.map((row) => [row.customerId, Number(row._sum.total ?? 0)]));
  const enriched = customers.map((customer) => {
    const spend = spendByCustomerId.get(customer.id);
    const totalSpend = Math.round(Number(spend?._sum.total ?? 0) * 100) / 100;
    const recentSpend = Math.round(Number(recentSpendByCustomerId.get(customer.id) ?? 0) * 100) / 100;
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      points: customer.points,
      createdAt: customer.createdAt.toISOString(),
      totalOrders: spend?._count._all ?? 0,
      totalSpend,
      recentSpend,
      lastOrderAt: spend?._max.createdAt?.toISOString() ?? null
    };
  });

  const highValueCustomers = [...enriched]
    .filter((customer) => customer.totalSpend > 0)
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, limit);
  const inactiveCustomers = [...enriched]
    .filter((customer) => !customer.lastOrderAt || new Date(customer.lastOrderAt) < inactiveCutoff)
    .sort((a, b) => {
      const aTime = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
      const bTime = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
      return aTime - bTime;
    })
    .slice(0, limit);
  const recentSpendTotal = Math.round(enriched.reduce((sum, customer) => sum + customer.recentSpend, 0) * 100) / 100;
  const totalSpend = Math.round(enriched.reduce((sum, customer) => sum + customer.totalSpend, 0) * 100) / 100;
  const customersWithOrders = enriched.filter((customer) => customer.totalOrders > 0).length;

  return {
    summary: {
      totalCustomers: customers.length,
      customersWithOrders,
      inactiveDays,
      inactiveCustomers: enriched.filter((customer) => !customer.lastOrderAt || new Date(customer.lastOrderAt) < inactiveCutoff).length,
      recentSpendTotal,
      totalSpend,
      averageSpendPerCustomer: customersWithOrders ? Math.round((totalSpend / customersWithOrders) * 100) / 100 : 0
    },
    highValueCustomers,
    inactiveCustomers
  };
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
