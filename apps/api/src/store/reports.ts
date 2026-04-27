import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";

export async function getSalesSummary(input: { from?: string; to?: string; branchId?: number }) {
  const where: Prisma.OrderWhereInput = {};
  if (input.from) where.createdAt = { gte: new Date(input.from) };
  if (input.to) where.createdAt = { ...(where.createdAt as object), lte: new Date(input.to + "T23:59:59Z") };
  if (input.branchId) where.branchId = input.branchId;

  const totalOrders = await prisma.order.count({ where });
  const agg = await prisma.order.aggregate({
    _sum: { total: true },
    where
  });
  const totalRevenue = agg._sum.total || 0;
  const averageTicket = totalOrders ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;

  // Top Items
  const topItemsRaw = await prisma.orderItem.groupBy({
    by: ['menuItemId', 'name'],
    where: { order: where },
    _sum: { qty: true, lineTotal: true },
    orderBy: { _sum: { lineTotal: 'desc' } },
    take: 5
  });

  const topItems = topItemsRaw.map(item => ({
    menuItemId: item.menuItemId,
    name: item.name,
    qty: item._sum.qty || 0,
    revenue: item._sum.lineTotal || 0
  }));

  // Daily
  // Prisma groupBy doesn't support date truncation easily without raw queries in all DBs.
  // We will fetch orders and group them in memory since it's a summary and we expect reasonable row counts for the date range.
  // Alternatively, use raw SQL. I'll group in memory for safety across SQLite/Postgres.
  const orders = await prisma.order.findMany({
    where,
    select: { createdAt: true, total: true },
    orderBy: { createdAt: "asc" }
  });

  const dailyMap = new Map<string, { date: string; orders: number; revenue: number }>();
  for (const o of orders) {
    const date = o.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
    if (!dailyMap.has(date)) dailyMap.set(date, { date, orders: 0, revenue: 0 });
    const stats = dailyMap.get(date)!;
    stats.orders += 1;
    stats.revenue += o.total;
  }

  const daily = Array.from(dailyMap.values());

  return { totalOrders, totalRevenue, averageTicket, topItems, daily };
}

export async function getProfitReport(input: { from?: string; to?: string; branchId?: number }) {
  const where: Prisma.OrderWhereInput = {};
  if (input.from) where.createdAt = { gte: new Date(input.from) };
  if (input.to) where.createdAt = { ...(where.createdAt as object), lte: new Date(input.to + "T23:59:59Z") };
  if (input.branchId) where.branchId = input.branchId;

  // Fetch all order items with menu item cost
  const orderItems = await prisma.orderItem.findMany({
    where: { order: where },
    include: { menuItem: { select: { cost: true } } }
  });

  const itemMap = new Map<number, any>();
  
  for (const oi of orderItems) {
    if (!itemMap.has(oi.menuItemId)) {
      itemMap.set(oi.menuItemId, {
        menuItemId: oi.menuItemId,
        name: oi.name,
        totalQty: 0,
        revenue: 0,
        costPerUnit: oi.menuItem.cost || 0,
        totalCost: 0,
        profit: 0
      });
    }
    const stat = itemMap.get(oi.menuItemId)!;
    stat.totalQty += oi.qty;
    stat.revenue += oi.lineTotal;
    stat.totalCost += (oi.qty * (oi.menuItem.cost || 0));
    stat.profit = stat.revenue - stat.totalCost;
  }

  const items = Array.from(itemMap.values()).sort((a, b) => b.profit - a.profit);

  const totalRevenue = items.reduce((s, i) => s + (i.revenue || 0), 0);
  const totalCost = items.reduce((s, i) => s + (i.totalCost || 0), 0);
  const totalProfit = totalRevenue - totalCost;
  const marginPercent = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 10000) / 100 : 0;

  return { items, totalRevenue, totalCost, totalProfit, marginPercent };
}

export async function getStaffPerformance(input: { from?: string; to?: string; branchId?: number }) {
  const where: Prisma.OrderWhereInput = {};
  if (input.from) where.createdAt = { gte: new Date(input.from) };
  if (input.to) where.createdAt = { ...(where.createdAt as object), lte: new Date(input.to + "T23:59:59Z") };
  if (input.branchId) where.branchId = input.branchId;

  const orders = await prisma.order.findMany({
    where,
    include: { user: { select: { name: true } } }
  });

  const staffMap = new Map<number | null, any>();

  for (const o of orders) {
    if (!staffMap.has(o.userId)) {
      staffMap.set(o.userId, {
        userId: o.userId,
        name: o.user ? o.user.name : "System",
        totalOrders: 0,
        totalRevenue: 0,
        avgTicket: 0
      });
    }
    const stat = staffMap.get(o.userId)!;
    stat.totalOrders += 1;
    stat.totalRevenue += o.total;
    stat.avgTicket = Math.round(stat.totalRevenue / stat.totalOrders);
  }

  const staff = Array.from(staffMap.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);

  return { staff };
}
