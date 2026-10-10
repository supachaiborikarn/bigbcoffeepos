import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";

// Staff clock in / out with their existing PIN. Punching again toggles: the
// first punch opens an entry, the next one closes it. Raw table created on
// demand (same pattern as shift_close_details) so no migration step is needed.

type Row = { id: number; user_id: number; user_name: string | null; branch_id: number; clock_in: Date; clock_out: Date | null; note: string | null };
const toEntry = (r: Row) => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name ?? `#${r.user_id}`,
  branchId: r.branch_id,
  clockIn: r.clock_in.toISOString(),
  clockOut: r.clock_out?.toISOString() ?? null,
  minutes: r.clock_out ? Math.max(0, Math.round((r.clock_out.getTime() - r.clock_in.getTime()) / 60000)) : null,
  note: r.note
});
export type TimeEntry = ReturnType<typeof toEntry>;

let ready: Promise<void> | null = null;
export function ensureTimeClockTable() {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS staff_time_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        clock_in TIMESTAMPTZ NOT NULL DEFAULT now(),
        clock_out TIMESTAMPTZ,
        closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        note TEXT
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS staff_time_entries_branch_in_idx ON staff_time_entries (branch_id, clock_in)`);
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

async function selectEntries(where: Prisma.Sql) {
  await ensureTimeClockTable();
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT t.id, t.user_id, u.name AS user_name, t.branch_id, t.clock_in, t.clock_out, t.note
    FROM staff_time_entries t LEFT JOIN users u ON u.id = t.user_id
    WHERE ${where}
    ORDER BY t.clock_in ASC
  `;
  return rows.map(toEntry);
}

/** Toggle clock in/out for a staff member at a branch. */
export async function punch(input: { userId: number; branchId: number }) {
  await ensureTimeClockTable();
  const open = (await selectEntries(Prisma.sql`t.user_id = ${input.userId} AND t.clock_out IS NULL`)).at(-1);
  if (open) {
    if (Date.now() - new Date(open.clockIn).getTime() < 60_000) throw new Error("เพิ่งลงเวลาเข้างานไปเมื่อสักครู่ ถ้าจะลงเวลาออกให้รออย่างน้อย 1 นาที");
    await prisma.$executeRaw`UPDATE staff_time_entries SET clock_out = now() WHERE id = ${open.id}`;
    const [closed] = await selectEntries(Prisma.sql`t.id = ${open.id}`);
    return { action: "out" as const, entry: closed };
  }
  const recent = (await selectEntries(Prisma.sql`t.user_id = ${input.userId} AND t.clock_out > now() - interval '1 minute'`)).at(-1);
  if (recent) throw new Error("เพิ่งลงเวลาออกไปเมื่อสักครู่");
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO staff_time_entries (user_id, branch_id) VALUES (${input.userId}, ${input.branchId}) RETURNING id
  `;
  const [entry] = await selectEntries(Prisma.sql`t.id = ${rows[0].id}`);
  return { action: "in" as const, entry };
}

/** Entries that started within [from, to] at the branch, plus anyone still clocked in there. */
export async function listTimeEntries(branchId: number, from: Date, to: Date) {
  return selectEntries(Prisma.sql`t.branch_id = ${branchId} AND ((t.clock_in BETWEEN ${from} AND ${to}) OR t.clock_out IS NULL)`);
}

export async function getTimeEntryBranch(id: number) {
  const [entry] = await selectEntries(Prisma.sql`t.id = ${id}`);
  return entry ? { branchId: entry.branchId } : null;
}

/** Manager fix for a forgotten clock-out. */
export async function closeTimeEntry(id: number, clockOut: Date, closedBy?: number) {
  const [entry] = await selectEntries(Prisma.sql`t.id = ${id}`);
  if (!entry) throw new Error("ไม่พบรายการลงเวลา");
  if (entry.clockOut) throw new Error("รายการนี้ลงเวลาออกแล้ว");
  if (!(clockOut.getTime() > new Date(entry.clockIn).getTime()) || clockOut.getTime() > Date.now() + 60_000) throw new Error("เวลาออกต้องอยู่หลังเวลาเข้าและไม่เกินเวลาปัจจุบัน");
  await prisma.$executeRaw`UPDATE staff_time_entries SET clock_out = ${clockOut}, closed_by = ${closedBy ?? null}, note = 'ปิดโดยผู้จัดการ' WHERE id = ${id}`;
  return (await selectEntries(Prisma.sql`t.id = ${id}`))[0];
}

/** Per-person hours for a day report: completed minutes + whether still clocked in. */
export function summarizeHours(entries: TimeEntry[]) {
  const byUser = new Map<number, { userName: string; minutes: number; entries: TimeEntry[]; open: boolean }>();
  for (const entry of entries) {
    const current = byUser.get(entry.userId) ?? { userName: entry.userName, minutes: 0, entries: [], open: false };
    current.entries.push(entry);
    if (entry.minutes !== null) current.minutes += entry.minutes;
    else current.open = true;
    byUser.set(entry.userId, current);
  }
  return Array.from(byUser.values());
}
