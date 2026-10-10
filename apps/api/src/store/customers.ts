import prisma from "../prisma.js";
import { customerHomeBranch } from "./customerScope.js";

export async function getCustomers(search?: string, branchId?: number) {
  const rows = await prisma.customer.findMany({
    where: search ? { OR: [{ phone: { contains: search } }, { name: { contains: search } }] } : {},
    include: { orders: { select: { branchId: true }, distinct: ["branchId"] } },
    orderBy: { id: "desc" }
  });
  return rows.filter((row) => !branchId || customerHomeBranch(row) === branchId).map(({ orders, ...customer }) => customer);
}

export async function customerHasBranch(id: number, branchId: number) {
  const customer = await prisma.customer.findUnique({ where: { id }, include: { orders: { select: { branchId: true }, distinct: ["branchId"] } } });
  return customer !== null && customerHomeBranch(customer) === branchId;
}

export async function getUnassignedCustomers() {
  const rows = await prisma.customer.findMany({
    include: { orders: { select: { branchId: true }, distinct: ["branchId"] } },
    orderBy: { id: "desc" }
  });
  return rows.filter((row) => customerHomeBranch(row) === null).map(({ orders, ...customer }) => ({
    ...customer, historicalBranchIds: orders.map((order) => order.branchId)
  }));
}

/** Resolve legacy contacts explicitly; historical orders and points stay intact. */
export async function assignCustomerBranch(id: number, branchId: number) {
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({ where: { id: branchId, active: true } });
    if (!branch) throw new Error("สาขานี้ไม่เปิดใช้งาน");
    const customer = await tx.customer.findUnique({ where: { id }, include: { orders: { select: { branchId: true }, distinct: ["branchId"] } } });
    if (!customer) throw new Error("ไม่พบสมาชิก");
    if (customerHomeBranch(customer) !== null) throw new Error("สมาชิกนี้มีสาขาประจำแล้ว กรุณาโหลดรายชื่อใหม่");
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(customer.metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
    } catch { metadata = { legacyMetadata: customer.metadata }; }
    const updated = await tx.customer.updateMany({
      where: { id, metadata: customer.metadata },
      data: { metadata: JSON.stringify({ ...metadata, workspaceBranchId: branchId }) }
    });
    if (updated.count !== 1) throw new Error("ข้อมูลสมาชิกเปลี่ยนแล้ว กรุณาโหลดรายชื่อใหม่");
    return tx.customer.findUniqueOrThrow({ where: { id } });
  });
}

export async function getCustomerInsights(input: { inactiveDays?: number; limit?: number; branchId?: number } = {}) {
  const inactiveDays = Number.isFinite(input.inactiveDays) && input.inactiveDays! > 0 ? input.inactiveDays! : 60;
  const limit = Number.isFinite(input.limit) && input.limit! > 0 ? Math.min(input.limit!, 50) : 10;
  const inactiveCutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [customers, spendRows, recentRows] = await Promise.all([
    getCustomers(undefined, input.branchId),
    prisma.order.groupBy({
      by: ["customerId"],
      where: {
        ...(input.branchId ? { branchId: input.branchId } : {}),
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
        ...(input.branchId ? { branchId: input.branchId } : {}),
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

export async function addCustomer(input: { name: string; phone: string; branchId?: number }) {
  const existing = await prisma.customer.findUnique({ where: { phone: input.phone } });
  if (existing) throw new Error("เบอร์โทรนี้เป็นสมาชิกอยู่แล้ว");
  return prisma.customer.create({
    data: { name: input.name, phone: input.phone, metadata: JSON.stringify(input.branchId ? { workspaceBranchId: input.branchId } : {}) }
  });
}

export async function updateCustomer(id: number, input: Partial<{
  name: string;
  phone: string;
  tier: string;
  memberCode: string | null;
  birthday: string | null;
  notes: string;
  totalSpend: number;
  creditBalance: number;
  tags: string[];
  lineUserId: string | null;
  metadata: Record<string, unknown>;
}>) {
  const current = await prisma.customer.findUnique({ where: { id } });
  if (!current) return null;
  let currentMetadata: Record<string, unknown> = {};
  try { currentMetadata = JSON.parse(current.metadata); } catch {}
  if (input.phone) {
    const dup = await prisma.customer.findFirst({
      where: { phone: input.phone, id: { not: id } }
    });
    if (dup) throw new Error("เบอร์โทรนี้ถูกใช้งานแล้ว");
  }
  const birthday = input.birthday ? new Date(input.birthday) : input.birthday === null ? null : undefined;
  return prisma.customer.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.tier !== undefined ? { tier: input.tier } : {}),
      ...(input.memberCode !== undefined ? { memberCode: input.memberCode || null } : {}),
      ...(birthday !== undefined ? { birthday } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.totalSpend !== undefined ? { totalSpend: input.totalSpend } : {}),
      ...(input.creditBalance !== undefined ? { creditBalance: input.creditBalance } : {}),
      ...(input.tags !== undefined ? { tags: JSON.stringify(input.tags) } : {}),
      ...(input.lineUserId !== undefined ? { lineUserId: input.lineUserId || null } : {}),
      ...(input.metadata !== undefined ? { metadata: JSON.stringify({ ...input.metadata, workspaceBranchId: currentMetadata.workspaceBranchId }) } : {})
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
