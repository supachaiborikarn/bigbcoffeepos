import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";

// Cash paid out of / put into the drawer during a shift (ice, deliveries, petty
// purchases, topping up change). Expected drawer cash at close becomes
//   opening + cash sales + cash in − cash out
// so paying a supplier from the drawer no longer shows up as a shortage.
// Stored in a raw table created on demand (same pattern as shift_close_details)
// so deploying needs no migration step.

export type CashEntryType = "OUT" | "IN";
export const CASH_OUT_CATEGORIES = ["ซื้อของเข้าร้าน", "ค่าน้ำแข็ง", "ค่าขนส่ง", "ค่าแรง/เบิกเงิน", "ฝากธนาคาร", "อื่นๆ"];
export const CASH_IN_CATEGORIES = ["เติมเงินทอน", "อื่นๆ"];

type Row = {
  id: number; branch_id: number; shift_id: number; entry_type: CashEntryType; amount: unknown; category: string;
  note: string | null; user_id: number | null; user_name: string | null; created_at: Date; voided_at: Date | null;
};

let tableReady = false;
export async function ensureCashDrawerTable() {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cash_drawer_entries (
      id SERIAL PRIMARY KEY,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('OUT', 'IN')),
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      category TEXT NOT NULL,
      note TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_at TIMESTAMPTZ,
      voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS cash_drawer_entries_shift_idx ON cash_drawer_entries (shift_id)`);
  tableReady = true;
}

const toEntry = (row: Row) => ({
  id: row.id,
  branchId: row.branch_id,
  shiftId: row.shift_id,
  type: row.entry_type,
  amount: Math.round(Number(row.amount) * 100) / 100,
  category: row.category,
  note: row.note,
  userName: row.user_name,
  createdAt: row.created_at.toISOString(),
  voided: row.voided_at !== null
});
export type CashEntry = ReturnType<typeof toEntry>;

export async function listCashEntries(shiftIds: number[], options: { includeVoided?: boolean } = {}): Promise<CashEntry[]> {
  if (!shiftIds.length) return [];
  await ensureCashDrawerTable();
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT e.*, u.name AS user_name
    FROM cash_drawer_entries e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.shift_id IN (${Prisma.join(shiftIds)})
    ${options.includeVoided ? Prisma.empty : Prisma.sql`AND e.voided_at IS NULL`}
    ORDER BY e.created_at ASC
  `;
  return rows.map(toEntry);
}

/** Net drawer movements per shift (voided entries excluded). */
export async function cashTotalsByShift(shiftIds: number[]) {
  const totals = new Map<number, { paidOut: number; paidIn: number }>();
  for (const entry of await listCashEntries(shiftIds)) {
    const current = totals.get(entry.shiftId) ?? { paidOut: 0, paidIn: 0 };
    if (entry.type === "OUT") current.paidOut = Math.round((current.paidOut + entry.amount) * 100) / 100;
    else current.paidIn = Math.round((current.paidIn + entry.amount) * 100) / 100;
    totals.set(entry.shiftId, current);
  }
  return totals;
}

export async function addCashEntry(input: { shiftId: number; type: CashEntryType; amount: number; category: string; note?: string; userId?: number }) {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (input.type !== "OUT" && input.type !== "IN") throw new Error("ประเภทรายการไม่ถูกต้อง");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("จำนวนเงินต้องมากกว่า 0");
  const category = String(input.category ?? "").trim().slice(0, 60);
  if (!category) throw new Error("เลือกหมวดรายการ");
  const shift = await prisma.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, branchId: true, status: true } });
  if (!shift) throw new Error("ไม่พบกะที่ระบุ");
  if (shift.status !== "OPEN") throw new Error("กะนี้ปิดแล้ว บันทึกเงินเข้า/ออกไม่ได้");
  await ensureCashDrawerTable();
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 200) : null;
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO cash_drawer_entries (branch_id, shift_id, entry_type, amount, category, note, user_id)
    VALUES (${shift.branchId}, ${shift.id}, ${input.type}, ${amount}, ${category}, ${note}, ${input.userId ?? null})
    RETURNING id
  `;
  return (await listCashEntries([shift.id], { includeVoided: true })).find((entry) => entry.id === rows[0].id)!;
}

export async function getCashEntryBranch(id: number) {
  await ensureCashDrawerTable();
  const rows = await prisma.$queryRaw<Array<{ branch_id: number }>>`SELECT branch_id FROM cash_drawer_entries WHERE id = ${id}`;
  return rows[0] ? { branchId: rows[0].branch_id } : null;
}

/** Void a mistaken entry while its shift is still open (kept for the audit trail). */
export async function voidCashEntry(id: number, userId?: number) {
  await ensureCashDrawerTable();
  const rows = await prisma.$queryRaw<Array<{ shift_id: number; status: string; voided_at: Date | null }>>`
    SELECT e.shift_id, s.status, e.voided_at FROM cash_drawer_entries e JOIN shifts s ON s.id = e.shift_id WHERE e.id = ${id}
  `;
  const row = rows[0];
  if (!row) throw new Error("ไม่พบรายการ");
  if (row.status !== "OPEN") throw new Error("กะนี้ปิดแล้ว ยกเลิกรายการไม่ได้");
  if (row.voided_at) return;
  await prisma.$executeRaw`UPDATE cash_drawer_entries SET voided_at = now(), voided_by = ${userId ?? null} WHERE id = ${id}`;
}
