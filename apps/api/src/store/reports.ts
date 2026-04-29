import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";

function buildOrderWhere(input: { from?: string; to?: string; branchId?: number }) {
  const where: Prisma.OrderWhereInput = {
    status: { notIn: ["CANCELLED", "REFUNDED"] }
  };
  if (input.from) where.createdAt = { gte: new Date(input.from) };
  if (input.to) where.createdAt = { ...(where.createdAt as object), lte: new Date(input.to + "T23:59:59Z") };
  if (input.branchId) where.branchId = input.branchId;
  return where;
}

export async function getSalesSummary(input: { from?: string; to?: string; branchId?: number }) {
  const where = buildOrderWhere(input);

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

  const dailyRows = await prisma.$queryRaw<Array<{ date: Date; orders: bigint; revenue: number | null }>>`
    SELECT date_trunc('day', created_at) AS date, COUNT(*) AS orders, SUM(total) AS revenue
    FROM orders
    WHERE status NOT IN ('CANCELLED', 'REFUNDED')
      AND (${input.branchId ?? null}::int IS NULL OR branch_id = ${input.branchId ?? null}::int)
      AND (${input.from ?? null}::text IS NULL OR created_at >= ${input.from ? new Date(input.from) : null})
      AND (${input.to ?? null}::text IS NULL OR created_at <= ${input.to ? new Date(input.to + "T23:59:59Z") : null})
    GROUP BY date_trunc('day', created_at)
    ORDER BY date ASC
  `;
  const daily = dailyRows.map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    orders: Number(row.orders),
    revenue: Math.round(Number(row.revenue ?? 0) * 100) / 100
  }));

  return { totalOrders, totalRevenue, averageTicket, topItems, daily };
}

export async function getProfitReport(input: { from?: string; to?: string; branchId?: number }) {
  const where = buildOrderWhere(input);

  const rows = await prisma.$queryRaw<Array<{
    menuItemId: number;
    name: string;
    totalQty: number;
    revenue: number;
    costPerUnit: number | null;
    totalCost: number;
    profit: number;
  }>>`
    SELECT
      oi.menu_item_id AS "menuItemId",
      oi.name,
      SUM(oi.qty) AS "totalQty",
      SUM(oi.line_total) AS revenue,
      COALESCE(mi.cost, 0) AS "costPerUnit",
      SUM(oi.qty * COALESCE(mi.cost, 0)) AS "totalCost",
      SUM(oi.line_total) - SUM(oi.qty * COALESCE(mi.cost, 0)) AS profit
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    INNER JOIN menu_items mi ON mi.id = oi.menu_item_id
    WHERE o.status NOT IN ('CANCELLED', 'REFUNDED')
      AND (${input.branchId ?? null}::int IS NULL OR o.branch_id = ${input.branchId ?? null}::int)
      AND (${input.from ?? null}::text IS NULL OR o.created_at >= ${input.from ? new Date(input.from) : null})
      AND (${input.to ?? null}::text IS NULL OR o.created_at <= ${input.to ? new Date(input.to + "T23:59:59Z") : null})
    GROUP BY oi.menu_item_id, oi.name, mi.cost
    ORDER BY profit DESC
  `;
  const items = rows.map((row) => ({
    menuItemId: Number(row.menuItemId),
    name: row.name,
    totalQty: Number(row.totalQty),
    revenue: Number(row.revenue),
    costPerUnit: Number(row.costPerUnit ?? 0),
    totalCost: Number(row.totalCost),
    profit: Number(row.profit)
  }));

  const totalRevenue = items.reduce((s, i) => s + (i.revenue || 0), 0);
  const totalCost = items.reduce((s, i) => s + (i.totalCost || 0), 0);
  const totalProfit = totalRevenue - totalCost;
  const marginPercent = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 10000) / 100 : 0;

  return { items, totalRevenue, totalCost, totalProfit, marginPercent };
}

export async function getStaffPerformance(input: { from?: string; to?: string; branchId?: number }) {
  const where = buildOrderWhere(input);

  const staffRows = await prisma.order.groupBy({
    by: ["userId"],
    where,
    _count: { _all: true },
    _sum: { total: true },
    orderBy: { _sum: { total: "desc" } }
  });

  const userIds = staffRows.map((row) => row.userId).filter((id): id is number => id !== null);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true }
  });
  const userNameById = new Map(users.map((user) => [user.id, user.name]));

  const staff = staffRows.map((row) => {
    const totalOrders = row._count._all;
    const totalRevenue = row._sum.total ?? 0;
    return {
      userId: row.userId,
      name: row.userId ? userNameById.get(row.userId) ?? "Unknown" : "System",
      totalOrders,
      totalRevenue,
      avgTicket: totalOrders ? Math.round(totalRevenue / totalOrders) : 0
    };
  });

  return { staff };
}
