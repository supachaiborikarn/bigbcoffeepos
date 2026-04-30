import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";

export type ReportSource = "system" | "pospos" | "all";

const SALES_ONLY_ITEM_NAME = "POSPOS sales-only record";

type ReportInput = { from?: string; to?: string; branchId?: number; source?: ReportSource };
type SourceBreakdown = {
  system: { orders: number; revenue: number };
  pospos: { orders: number; revenue: number };
  all: { orders: number; revenue: number };
};

function normalizeReportSource(source?: string): ReportSource {
  return source === "pospos" || source === "all" || source === "system" ? source : "system";
}

function sourceWhere(source: ReportSource): Prisma.OrderWhereInput {
  if (source === "pospos") return { items: { some: { name: SALES_ONLY_ITEM_NAME } } };
  if (source === "system") return { items: { none: { name: SALES_ONLY_ITEM_NAME } } };
  return {};
}

function sourceSql(source: ReportSource, alias: "orders" | "o") {
  const orderId = alias === "o" ? Prisma.sql`o.id` : Prisma.sql`orders.id`;
  return Prisma.sql`
    AND (
      ${source}::text = 'all'
      OR (${source}::text = 'system' AND NOT EXISTS (
        SELECT 1 FROM order_items oi_source
        WHERE oi_source.order_id = ${orderId}
          AND oi_source.name = ${SALES_ONLY_ITEM_NAME}
      ))
      OR (${source}::text = 'pospos' AND EXISTS (
        SELECT 1 FROM order_items oi_source
        WHERE oi_source.order_id = ${orderId}
          AND oi_source.name = ${SALES_ONLY_ITEM_NAME}
      ))
    )
  `;
}

function buildOrderWhere(input: ReportInput) {
  const source = normalizeReportSource(input.source);
  const where: Prisma.OrderWhereInput = {
    status: { notIn: ["CANCELLED", "REFUNDED"] },
    ...sourceWhere(source)
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

async function getSourceBreakdown(baseWhere: Prisma.OrderWhereInput): Promise<SourceBreakdown> {
  const systemWhere: Prisma.OrderWhereInput = { ...baseWhere, ...sourceWhere("system") };
  const posposWhere: Prisma.OrderWhereInput = { ...baseWhere, ...sourceWhere("pospos") };

  const [systemOrders, systemTotals, posposOrders, posposTotals] = await Promise.all([
    prisma.order.count({ where: systemWhere }),
    prisma.order.aggregate({ where: systemWhere, _sum: { total: true } }),
    prisma.order.count({ where: posposWhere }),
    prisma.order.aggregate({ where: posposWhere, _sum: { total: true } })
  ]);

  const systemRevenue = roundMoney(systemTotals._sum.total);
  const posposRevenue = roundMoney(posposTotals._sum.total);
  return {
    system: { orders: systemOrders, revenue: systemRevenue },
    pospos: { orders: posposOrders, revenue: posposRevenue },
    all: { orders: systemOrders + posposOrders, revenue: roundMoney(systemRevenue + posposRevenue) }
  };
}

export async function getSalesSummary(input: ReportInput) {
  const source = normalizeReportSource(input.source);
  const where = buildOrderWhere({ ...input, source });
  const breakdownWhere = buildOrderWhere({ ...input, source: "all" });

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
      ${sourceSql(source, "orders")}
    GROUP BY date_trunc('day', created_at)
    ORDER BY date ASC
  `;
  const daily = dailyRows.map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    orders: Number(row.orders),
    revenue: Math.round(Number(row.revenue ?? 0) * 100) / 100
  }));

  const sourceBreakdown = await getSourceBreakdown(breakdownWhere);

  return {
    source,
    sourceBreakdown,
    importedSalesOnlyOrders: sourceBreakdown.pospos.orders,
    importedSalesOnlyRevenue: sourceBreakdown.pospos.revenue,
    totalOrders,
    totalRevenue,
    averageTicket,
    topItems,
    daily
  };
}

export async function getProfitReport(input: ReportInput) {
  const source = normalizeReportSource(input.source);

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
      ${sourceSql(source, "o")}
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

export async function getStaffPerformance(input: ReportInput) {
  const source = normalizeReportSource(input.source);
  const where = buildOrderWhere({ ...input, source });

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

export async function getOrdersCsvRows(input: ReportInput) {
  const source = normalizeReportSource(input.source);
  const orders = await prisma.order.findMany({
    where: buildOrderWhere({ ...input, source }),
    include: {
      branch: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
      user: { select: { name: true } },
      items: { select: { name: true, qty: true, lineTotal: true, note: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  return orders.map((order) => {
    const isPosposSalesOnly = order.items.some((item) => item.name === SALES_ONLY_ITEM_NAME);
    return {
      id: order.id,
      createdAt: order.createdAt.toISOString(),
      source: isPosposSalesOnly ? "POSPOS sales-only import" : "System POS",
      branch: order.branch.name,
      customer: order.customer ? `${order.customer.name} (${order.customer.phone})` : "",
      staff: order.user?.name ?? "",
      status: order.status,
      paymentMethod: order.paymentMethod,
      itemCount: order.items.length,
      items: order.items.map((item) => `${item.qty}x ${item.name}`).join(" | "),
      itemNotes: order.items.map((item) => item.note).filter(Boolean).join(" | "),
      subtotal: roundMoney(order.subtotal),
      discountAmount: roundMoney(order.discountAmount),
      loyaltyPointsUsed: order.loyaltyPointsUsed,
      tax: roundMoney(order.tax),
      total: roundMoney(order.total)
    };
  });
}

export async function getDailyCloseReport(input: { date?: string; branchId?: number; source?: ReportSource }) {
  const source = normalizeReportSource(input.source);
  const range = buildDayRange(input.date);
  const branch = input.branchId
    ? await prisma.branch.findUnique({ where: { id: input.branchId }, select: { id: true, name: true, location: true, branchType: true } })
    : null;

  const basePaidWhere: Prisma.OrderWhereInput = {
    status: { notIn: ["CANCELLED", "REFUNDED"] },
    createdAt: { gte: range.from, lte: range.to },
    ...(input.branchId ? { branchId: input.branchId } : {})
  };
  const paidWhere: Prisma.OrderWhereInput = { ...basePaidWhere, ...sourceWhere(source) };
  const allWhere: Prisma.OrderWhereInput = {
    createdAt: { gte: range.from, lte: range.to },
    ...(input.branchId ? { branchId: input.branchId } : {}),
    ...sourceWhere(source)
  };

  const [orderCount, totals, statusRows, paymentRows, topItemsRaw, shifts, sourceBreakdown] = await Promise.all([
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
    }),
    getSourceBreakdown(basePaidWhere)
  ]);

  const shiftIds = shifts.map((shift) => shift.id);
  const [detailRows, shiftTotalRows, shiftPaymentRows] = shiftIds.length
    ? await Promise.all([
        prisma.$queryRaw<Array<{ shift_id: number; cash_counts: unknown; note: string | null }>>`
          SELECT shift_id, cash_counts, note
          FROM shift_close_details
          WHERE shift_id IN (${Prisma.join(shiftIds)})
        `.catch(() => []),
        prisma.order.groupBy({
          by: ["shiftId"],
          where: {
            shiftId: { in: shiftIds },
            status: { notIn: ["CANCELLED", "REFUNDED"] },
            ...sourceWhere(source)
          },
          _count: { _all: true },
          _sum: { total: true }
        }),
        prisma.order.groupBy({
          by: ["shiftId", "paymentMethod"],
          where: {
            shiftId: { in: shiftIds },
            status: { notIn: ["CANCELLED", "REFUNDED"] },
            ...sourceWhere(source)
          },
          _sum: { total: true }
        })
      ])
    : [[], [], []] as const;
  const detailByShift = new Map(detailRows.map((row) => [row.shift_id, row]));
  const shiftTotalsById = new Map(
    shiftTotalRows
      .filter((row) => row.shiftId !== null)
      .map((row) => [row.shiftId!, { totalSales: roundMoney(row._sum.total), totalOrders: row._count._all }])
  );
  const shiftPaymentsById = new Map<number, { cashSales: number; qrSales: number; cardSales: number }>();
  shiftPaymentRows.forEach((row) => {
    if (row.shiftId === null) return;
    const current = shiftPaymentsById.get(row.shiftId) ?? { cashSales: 0, qrSales: 0, cardSales: 0 };
    const amount = roundMoney(row._sum.total);
    if (row.paymentMethod === "CASH") current.cashSales = roundMoney(current.cashSales + amount);
    if (row.paymentMethod === "QR") current.qrSales = roundMoney(current.qrSales + amount);
    if (row.paymentMethod === "CARD" || row.paymentMethod === "EWALLET") current.cardSales = roundMoney(current.cardSales + amount);
    shiftPaymentsById.set(row.shiftId, current);
  });

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
    const shiftTotals = shiftTotalsById.get(shift.id) ?? { totalSales: 0, totalOrders: 0 };
    const shiftPayments = shiftPaymentsById.get(shift.id) ?? { cashSales: 0, qrSales: 0, cardSales: 0 };
    const cashSales = roundMoney(shiftPayments.cashSales);
    const expectedCash = roundMoney(shift.openingCash + cashSales);
    const difference = shift.closingCash == null ? null : roundMoney(shift.closingCash - expectedCash);
    return {
      id: shift.id,
      branchName: shift.branch.name,
      userName: shift.user?.name ?? "-",
      status: shift.status,
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString() ?? null,
      openingCash: roundMoney(shift.openingCash),
      cashSales,
      qrSales: roundMoney(shiftPayments.qrSales),
      cardSales: roundMoney(shiftPayments.cardSales),
      totalSales: roundMoney(shiftTotals.totalSales),
      totalOrders: shiftTotals.totalOrders,
      expectedCash,
      closingCash: shift.closingCash == null ? null : roundMoney(shift.closingCash),
      difference,
      cashCounts: detail?.cash_counts ?? {},
      note: detail?.note ?? null
    };
  });

  const cashExpected = roundMoney(shiftSummaries.reduce((sum, shift) => sum + shift.expectedCash, 0));
  const cashCounted = roundMoney(shiftSummaries.reduce((sum, shift) => sum + (shift.closingCash ?? 0), 0));

  return {
    date: range.date,
    branch,
    source,
    sourceBreakdown,
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
