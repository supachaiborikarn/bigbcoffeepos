import prisma from "../prisma.js";

const PAYMENT_METHODS = ["CASH", "QR", "CARD", "EWALLET"] as const;
type ShiftCloseDetails = { cashCounts?: Record<string, number>; note?: string };
let closeDetailsTableReady = false;

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

async function ensureShiftCloseDetailsTable() {
  if (closeDetailsTableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS shift_close_details (
      shift_id INTEGER PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
      cash_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  closeDetailsTableReady = true;
}

async function saveShiftCloseDetails(shiftId: number, details?: ShiftCloseDetails) {
  if (!details) return;
  const cashCounts = details.cashCounts ?? {};
  const note = typeof details.note === "string" && details.note.trim() ? details.note.trim() : null;
  if (!Object.keys(cashCounts).length && !note) return;
  await ensureShiftCloseDetailsTable();
  await prisma.$executeRaw`
    INSERT INTO shift_close_details (shift_id, cash_counts, note)
    VALUES (${shiftId}, CAST(${JSON.stringify(cashCounts)} AS jsonb), ${note})
    ON CONFLICT (shift_id) DO UPDATE SET
      cash_counts = EXCLUDED.cash_counts,
      note = EXCLUDED.note,
      updated_at = now()
  `;
}

export async function getShiftCloseDetails(shiftId: number) {
  await ensureShiftCloseDetailsTable();
  const rows = await prisma.$queryRaw<Array<{ cash_counts: unknown; note: string | null }>>`
    SELECT cash_counts, note FROM shift_close_details WHERE shift_id = ${shiftId}
  `;
  const row = rows[0];
  return row ? { cashCounts: row.cash_counts ?? {}, note: row.note } : { cashCounts: {}, note: null };
}

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

export async function closeShift(id: number, closingCash: number, details?: ShiftCloseDetails) {
  const shift = await getShift(id);
  if (!shift) throw new Error("ไม่พบกะที่ระบุ");
  if (shift.status !== "OPEN") throw new Error("กะนี้ปิดไปแล้ว");

  const summary = await getShiftSummary(id);
  const expectedCash = shift.openingCash + (summary?.cash.cashSales ?? shift.cashSales);
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
  await saveShiftCloseDetails(id, details);

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

export async function getShiftSummary(id: number) {
  const shift = await prisma.shift.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, name: true, location: true } },
      user: { select: { id: true, name: true, role: true } }
    }
  });
  if (!shift) return null;

  const orders = await prisma.order.findMany({
    where: { shiftId: id },
    include: { items: true },
    orderBy: { createdAt: "asc" }
  });

  const ordersTotal = orders.reduce((sum, order) => sum + order.total, 0);
  const hasOrderRows = orders.length > 0;
  const totalSales = hasOrderRows ? ordersTotal : shift.totalSales;
  const totalOrders = hasOrderRows ? orders.length : shift.totalOrders;
  const subtotal = orders.reduce((sum, order) => sum + order.subtotal, 0);
  const discountAmount = orders.reduce((sum, order) => sum + order.discountAmount, 0);
  const loyaltyPointsUsed = orders.reduce((sum, order) => sum + order.loyaltyPointsUsed, 0);
  const tax = orders.reduce((sum, order) => sum + order.tax, 0);

  const paymentTotals = new Map<string, { method: string; count: number; total: number }>();
  PAYMENT_METHODS.forEach((method) => paymentTotals.set(method, { method, count: 0, total: 0 }));

  orders.forEach((order) => {
    const current = paymentTotals.get(order.paymentMethod) ?? { method: order.paymentMethod, count: 0, total: 0 };
    current.count += 1;
    current.total += order.total;
    paymentTotals.set(order.paymentMethod, current);
  });

  if (!hasOrderRows && totalOrders > 0) {
    paymentTotals.set("CASH", { method: "CASH", count: 0, total: shift.cashSales });
    paymentTotals.set("QR", { method: "QR", count: 0, total: shift.qrSales });
    paymentTotals.set("CARD", { method: "CARD", count: 0, total: shift.cardSales });
  }

  const payments = Array.from(paymentTotals.values()).map((payment) => ({
    ...payment,
    total: Math.round(payment.total * 100) / 100
  }));
  const cashSales = payments.find((payment) => payment.method === "CASH")?.total ?? shift.cashSales;
  const expectedCash = Math.round((shift.openingCash + cashSales) * 100) / 100;
  const difference = shift.closingCash == null ? null : Math.round((shift.closingCash - expectedCash) * 100) / 100;
  const closeDetails = shift.status === "CLOSED"
    ? await getShiftCloseDetails(id).catch(() => ({ cashCounts: {}, note: null }))
    : { cashCounts: {}, note: null };

  const itemMap = new Map<number, { menuItemId: number; name: string; qty: number; revenue: number }>();
  orders.forEach((order) => {
    order.items.forEach((item) => {
      const current = itemMap.get(item.menuItemId) ?? { menuItemId: item.menuItemId, name: item.name, qty: 0, revenue: 0 };
      current.qty += item.qty;
      current.revenue += item.lineTotal;
      itemMap.set(item.menuItemId, current);
    });
  });

  const topItems = Array.from(itemMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((item) => ({ ...item, revenue: Math.round(item.revenue * 100) / 100 }));

  const openedAt = shift.openedAt;
  const closedAt = shift.closedAt ?? new Date();
  const durationMinutes = Math.max(0, Math.round((closedAt.getTime() - openedAt.getTime()) / 60000));

  return {
    shift: {
      id: shift.id,
      branchId: shift.branchId,
      userId: shift.userId,
      openingCash: shift.openingCash,
      closingCash: shift.closingCash,
      expectedCash,
      difference,
      totalSales,
      totalOrders,
      cashSales,
      qrSales: payments.find((payment) => payment.method === "QR")?.total ?? shift.qrSales,
      cardSales: payments.find((payment) => payment.method === "CARD")?.total ?? shift.cardSales,
      status: shift.status,
      openedAt: toIso(shift.openedAt),
      closedAt: toIso(shift.closedAt)
    },
    branch: shift.branch,
    user: shift.user,
    openedAt: toIso(shift.openedAt),
    closedAt: toIso(shift.closedAt),
    durationMinutes,
    totals: {
      totalSales: Math.round(totalSales * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      discountAmount: Math.round(discountAmount * 100) / 100,
      loyaltyPointsUsed,
      tax: Math.round(tax * 100) / 100,
      totalOrders,
      averageTicket: totalOrders ? Math.round((totalSales / totalOrders) * 100) / 100 : 0,
      paidOrders: orders.filter((order) => order.status === "PAID").length,
      readyOrders: orders.filter((order) => order.status === "READY").length
    },
    cash: {
      openingCash: shift.openingCash,
      cashSales,
      expectedCash,
      closingCash: shift.closingCash,
      difference
    },
    closeDetails,
    payments,
    topItems,
    orders: orders.slice(-20).reverse().map((order) => ({
      id: order.id,
      status: order.status,
      total: order.total,
      paymentMethod: order.paymentMethod,
      itemCount: order.items.length,
      createdAt: toIso(order.createdAt)
    }))
  };
}
