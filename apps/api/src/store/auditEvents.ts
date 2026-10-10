import prisma from "../prisma.js";
import { Prisma } from "@prisma/client";

// Durable activity log. The audit file (data/audit.log) doesn't survive on
// serverless hosts, so every audit() entry is also stored here (raw table
// created on demand — no migration step needed).

let ready: Promise<void> | null = null;
function ensureTable() {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        action TEXT NOT NULL,
        actor_id INTEGER,
        actor_role TEXT,
        branch_id INTEGER,
        request_id TEXT,
        details JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS audit_events_ts_idx ON audit_events (ts DESC)`);
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

export async function saveAuditEvent(entry: Record<string, any>) {
  await ensureTable();
  const { ts, action, actor, requestId, type: _type, ip: _ip, ...details } = entry;
  const branchId = Number(details.branchId ?? details.fromBranchId ?? actor?.branchId) || null;
  await prisma.$executeRaw`
    INSERT INTO audit_events (ts, action, actor_id, actor_role, branch_id, request_id, details)
    VALUES (${new Date(ts ?? Date.now())}, ${String(action)}, ${actor?.id ?? null}, ${actor?.role ?? null}, ${branchId}, ${requestId ?? null}, CAST(${JSON.stringify(details)} AS jsonb))
  `;
}

export async function listAuditEvents(input: { limit?: number; action?: string; branchId?: number }) {
  await ensureTable();
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 1000);
  const action = input.action?.trim().toLowerCase();
  const rows = await prisma.$queryRaw<Array<{ id: bigint; ts: Date; action: string; actor_id: number | null; actor_role: string | null; actor_name: string | null; branch_id: number | null; request_id: string | null; details: Record<string, unknown> }>>`
    SELECT e.id, e.ts, e.action, e.actor_id, e.actor_role, u.name AS actor_name, e.branch_id, e.request_id, e.details
    FROM audit_events e
    LEFT JOIN users u ON u.id = e.actor_id
    WHERE 1 = 1
    ${action ? Prisma.sql`AND lower(e.action) LIKE ${`%${action}%`}` : Prisma.empty}
    ${input.branchId ? Prisma.sql`AND e.branch_id = ${input.branchId}` : Prisma.empty}
    ORDER BY e.ts DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    ts: row.ts.toISOString(),
    action: row.action,
    actor: row.actor_id ? { id: row.actor_id, role: row.actor_role, name: row.actor_name } : null,
    branchId: row.branch_id,
    requestId: row.request_id,
    ...row.details
  }));
}
