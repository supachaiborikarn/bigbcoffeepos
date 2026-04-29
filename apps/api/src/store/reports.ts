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

function buildDayRange(date?: string) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date! : new Date().toISOString().slice(0, 10);
  return {
    date: day,
    from: new Date(`${day}T00:00:00.000+07:00`),
    to: new Date(`${day}T23:59:59.999+07:00`)
  };
}

function roundMoney(value: number | null | undefined) {
  return Math.round(Number(value ?? 0) * 100) / 100;
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

export async function getOrdersCsvRows(input: { from?: string; to?: string; branchId?: number }) {
  const orders = await prisma.order.findMany({
    where: buildOrderWhere(input),
    include: {
      branch: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
      user: { select: { name: true } },
      items: { select: { name: true, qty: true, lineTotal: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  return orders.map((order) => ({
    id: order.id,
    createdAt: order.createdAt.toISOString(),
    branch: order.branch.name,
    customer: order.customer ? `${order.customer.name} (${order.customer.phone})` : "",
    staff: order.user?.name ?? "",
    status: order.status,
    paymentMethod: order.paymentMethod,
    itemCount: order.items.length,
    items: order.items.map((item) => `${item.qty}x ${item.name}`).join(" | "),
    subtotal: roundMoney(order.subtotal),
    discountAmount: roundMoney(order.discountAmount),
    loyaltyPointsUsed: order.loyaltyPointsUsed,
    tax: roundMoney(order.tax),
    total: roundMoney(order.total)
  }));
}

export async function getDailyCloseReport(input: { date?: string; branchId?: number }) {
  const range = buildDayRange(input.date);
  const branch = input.branchId
    ? await prisma.branch.findUnique({ where: { id: input.branchId }, select: { id: true, name: true, location: true, branchType: true } })
    : null;

  const paidWhere: Prisma.OrderWhereInput = {
    status: { notIn: ["CANCELLED", "REFUNDED"] },
    createdAt: { gte: range.from, lte: range.to },
    ...(input.branchId ? { branchId: input.branchId } : {})
  };
  const allWhere: Prisma.OrderWhereInput = {
    createdAt: { gte: range.from, lte: range.to },
    ...(input.branchId ? { branchId: input.branchId } : {})
  };

  const [orderCount, totals, statusRows, paymentRows, topItemsRaw, shifts] = await Promise.all([
    prisma.order.count({ where: paidWhere }),
    prisma.order.aggregate({
      where: paidWhere,
      _sum: {
        subtotal: true,
        discountAmount: true,
        loyaltyPointsUsed: true,
        loyaltyPointsEarned: true,
        tax: true,
        total: true
      }
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: allWhere,
      _count: { _all: true },
      _sum: { total: true }
    }),
    prisma.order.groupBy({
      by: ["paymentMethod"],
      where: paidWhere,
      _count: { _all: true },
      _sum: { total: true }
    }),
    prisma.orderItem.groupBy({
      by: ["menuItemId", "name"],
      where: { order: paidWhere },
      _sum: { qty: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 10
    }),
    prisma.shift.findMany({
      where: {
        ...(input.branchId ? { branchId: input.branchId } : {}),
        OR: [
          { openedAt: { gte: range.from, lte: range.to } },
          { closedAt: { gte: range.from, lte: range.to } }
        ]
      },
      include: {
        branch: { select: { name: true } },
        user: { select: { name: true } }
      },
      orderBy: { openedAt: "asc" }
    })
  ]);

  const shiftIds = shifts.map((shift) => shift.id);
  const detailRows = shiftIds.length
    ? await prisma.$queryRaw<Array<{ shift_id: number; cash_counts: unknown; note: string | null }>>`
        SELECT shift_id, cash_counts, note
        FROM shift_close_details
        WHERE shift_id IN (${Prisma.join(shiftIds)})
      `.catch(() => [])
    : [];
  const detailByShift = new Map(detailRows.map((row) => [row.shift_id, row]));

  const paymentMethods = ["CASH", "QR", "CARD", "EWALLET"];
  const payments = paymentMethods.map((method) => {
    const row = paymentRows.find((item) => item.paymentMethod === method);
    return {
      method,
      count: row?._count._all ?? 0,
      total: roundMoney(row?._sum.total)
    };
  });

  const shiftSummaries = shifts.map((shift) => {
    const detail = detailByShift.get(shift.id);
    const cashSales = roundMoney(shift.cashSales);
    const expectedCash = roundMoney(shift.expectedCash ?? shift.openingCash + cashSales);
    return {
      id: shift.id,
      branchName: shift.branch.name,
      userName: shift.user?.name ?? "-",
      status: shift.status,
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString() ?? null,
      openingCash: roundMoney(shift.openingCash),
      cashSales,
      qrSales: roundMoney(shift.qrSales),
      cardSales: roundMoney(shift.cardSales),
      totalSales: roundMoney(shift.totalSales),
      totalOrders: shift.totalOrders,
      expectedCash,
      closingCash: shift.closingCash == null ? null : roundMoney(shift.closingCash),
      difference: shift.difference == null ? null : roundMoney(shift.difference),
      cashCounts: detail?.cash_counts ?? {},
      note: detail?.note ?? null
    };
  });

  const cashExpected = roundMoney(shiftSummaries.reduce((sum, shift) => sum + shift.expectedCash, 0));
  const cashCounted = roundMoney(shiftSummaries.reduce((sum, shift) => sum + (shift.closingCash ?? 0), 0));

  return {
    date: range.date,
    branch,
    generatedAt: new Date().toISOString(),
    totals: {
      totalOrders: orderCount,
      subtotal: roundMoney(totals._sum.subtotal),
      discountAmount: roundMoney(totals._sum.discountAmount),
      loyaltyPointsUsed: Number(totals._sum.loyaltyPointsUsed ?? 0),
      loyaltyPointsEarned: Number(totals._sum.loyaltyPointsEarned ?? 0),
      tax: roundMoney(totals._sum.tax),
      totalRevenue: roundMoney(totals._sum.total),
      averageTicket: orderCount ? roundMoney(Number(totals._sum.total ?? 0) / orderCount) : 0,
      cancelledOrders: statusRows.find((row) => row.status === "CANCELLED")?._count._all ?? 0,
      refundedOrders: statusRows.find((row) => row.status === "REFUNDED")?._count._all ?? 0
    },
    payments,
    cash: {
      cashSales: payments.find((payment) => payment.method === "CASH")?.total ?? 0,
      expectedCash: cashExpected,
      countedCash: cashCounted,
      difference: roundMoney(cashCounted - cashExpected)
    },
    shifts: shiftSummaries,
    topItems: topItemsRaw.map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      qty: Number(item._sum.qty ?? 0),
      revenue: roundMoney(item._sum.lineTotal)
    }))
  };
}
