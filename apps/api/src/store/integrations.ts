import prisma from "../prisma.js";

export type IntegrationProvider = "rd_tax" | "line_oa" | "lineman" | "email" | "pospos";

type IntegrationDefinition = {
  provider: IntegrationProvider;
  label: string;
  description: string;
  requiredEnv: string[];
};

const DEFINITIONS: IntegrationDefinition[] = [
  {
    provider: "rd_tax",
    label: "RD Tax / e-Tax",
    description: "เตรียมข้อมูลใบกำกับภาษีและคิวส่งเข้าระบบภาษี",
    requiredEnv: ["RD_TAX_ENDPOINT", "RD_TAX_CLIENT_ID", "RD_TAX_CLIENT_SECRET"]
  },
  {
    provider: "line_oa",
    label: "Line OA",
    description: "คิวแจ้งเตือนลูกค้าและส่งข้อความหลังการขาย",
    requiredEnv: ["LINE_OA_CHANNEL_ACCESS_TOKEN"]
  },
  {
    provider: "lineman",
    label: "Lineman",
    description: "คิวซิงก์ออเดอร์/เมนูสำหรับเดลิเวอรี",
    requiredEnv: ["LINEMAN_API_ENDPOINT", "LINEMAN_API_KEY"]
  },
  {
    provider: "email",
    label: "Daily Email",
    description: "ส่งอีเมลสรุปยอดขายรายวันผ่าน webhook หรือ email service",
    requiredEnv: ["EMAIL_WEBHOOK_URL"]
  },
  {
    provider: "pospos",
    label: "POSPOS",
    description: "ดึงข้อมูลสินค้า สต็อก ลูกค้า และยอดขายจาก POSPOS",
    requiredEnv: ["POSPOS_EMAIL", "POSPOS_PASSWORD"]
  }
];

const MAX_OUTBOX_ATTEMPTS = 3;
const POSPOS_RUNNING_STALE_MS = 20 * 60 * 1000;

function missingEnv(requiredEnv: string[]) {
  return requiredEnv.filter((key) => !process.env[key]);
}

/** False when the provider's credentials are not set: callers must not queue work it can never send. */
export function isIntegrationConfigured(provider: IntegrationProvider) {
  const def = DEFINITIONS.find((d) => d.provider === provider);
  return Boolean(def) && missingEnv(def!.requiredEnv).length === 0;
}

function integrationLabel(provider: IntegrationProvider) {
  return DEFINITIONS.find((d) => d.provider === provider)?.label ?? provider;
}

/** Retire everything still PENDING for providers that are not configured, in one write per provider. */
export async function skipUnconfiguredOutbox() {
  let skipped = 0;
  for (const def of DEFINITIONS) {
    const missing = missingEnv(def.requiredEnv);
    if (missing.length === 0) continue;
    const result = await prisma.integrationOutbox.updateMany({
      where: { provider: def.provider, status: "PENDING" },
      data: { status: "SKIPPED", lastError: `Missing ENV: ${missing.join(", ")}`, updatedAt: new Date() }
    });
    skipped += result.count;
  }
  return skipped;
}

function parsePayload(value: unknown) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function isActivePosposStatus(status: string) {
  return status === "PENDING" || status === "RUNNING";
}

function isPosposJobStale(row: { status: string; updatedAt: Date }) {
  return isActivePosposStatus(row.status) && Date.now() - row.updatedAt.getTime() > POSPOS_RUNNING_STALE_MS;
}

function getStalePosposMessage(status: string) {
  if (status === "PENDING") return "งานดึงข้อมูลรอเริ่มนานเกินไป กรุณาสั่งดึงใหม่";
  return "งานดึงข้อมูลค้างนานเกินไป กรุณาสั่งดึงใหม่";
}

function toReadablePosposError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/POSPOS_EMAIL|POSPOS_PASSWORD/i.test(message)) {
    return "ยังไม่ได้ตั้งค่าอีเมลหรือรหัสผ่าน POSPOS ในระบบ";
  }
  if (/Branch not found/i.test(message)) {
    return "ไม่พบสาขานี้ในระบบ";
  }
  if (/timeout|timed out|Timeout/i.test(message)) {
    return "POSPOS ตอบช้าเกินไป กรุณาลองดึงใหม่อีกครั้ง";
  }
  if (/ECONN|ENOTFOUND|net::|fetch failed|network/i.test(message)) {
    return "เชื่อมต่อ POSPOS ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตหรือระบบ POSPOS";
  }
  return (message || "ดึงข้อมูล POSPOS ไม่สำเร็จ").slice(0, 500);
}

function toPosposSyncJob(row: Awaited<ReturnType<typeof prisma.integrationOutbox.findUnique>>) {
  if (!row) return null;
  const payload = parsePayload(row.payload) as Record<string, unknown>;
  const result = payload.result && typeof payload.result === "object"
    ? payload.result as Record<string, unknown>
    : null;
  const isStale = isPosposJobStale(row);

  return {
    id: row.id,
    branchId: Number(payload.branchId ?? row.entityId ?? 0),
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError ? toReadablePosposError(row.lastError) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: typeof payload.startedAt === "string" ? payload.startedAt : null,
    finishedAt: typeof payload.finishedAt === "string" ? payload.finishedAt : null,
    isStale,
    canRetry: row.status === "FAILED" || row.status === "SKIPPED" || isStale,
    result: result
      ? {
          menuItems: Number(result.menuItems ?? 0),
          ingredients: Number(result.ingredients ?? 0),
          customers: Number(result.customers ?? 0),
          sales: Number(result.sales ?? 0),
          replacedOrders: Number(result.replacedOrders ?? 0),
          replacedShifts: Number(result.replacedShifts ?? 0),
          zeroedStockItems: Number(result.zeroedStockItems ?? 0),
          success: result.success === true
        }
      : null
  };
}

async function assertProviderResponseOk(response: Response, provider: IntegrationProvider) {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  const detail = body ? `: ${body.slice(0, 300)}` : "";
  throw new Error(`${provider} responded ${response.status} ${response.statusText}${detail}`);
}

export async function getIntegrationStatus() {
  const statuses = await Promise.all(DEFINITIONS.map(async (definition) => {
    const missing = missingEnv(definition.requiredEnv);
    const pendingCount = await prisma.integrationOutbox.count({
      where: { provider: definition.provider, status: "PENDING" }
    });
    const failedCount = await prisma.integrationOutbox.count({
      where: { provider: definition.provider, status: "FAILED" }
    });

    return {
      ...definition,
      configured: missing.length === 0,
      missingEnv: missing,
      pendingEvents: pendingCount,
      failedEvents: failedCount
    };
  }));
  return statuses;
}

export async function getIntegrationOutboxSummary() {
  const [byStatus, byProviderStatus, oldestPending, newestFailed] = await Promise.all([
    prisma.integrationOutbox.groupBy({
      by: ["status"],
      _count: { _all: true }
    }),
    prisma.integrationOutbox.groupBy({
      by: ["provider", "status"],
      _count: { _all: true }
    }),
    prisma.integrationOutbox.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        provider: true,
        eventType: true,
        entityType: true,
        entityId: true,
        attempts: true,
        createdAt: true,
        updatedAt: true,
        lastError: true
      }
    }),
    prisma.integrationOutbox.findFirst({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        provider: true,
        eventType: true,
        entityType: true,
        entityId: true,
        attempts: true,
        createdAt: true,
        updatedAt: true,
        lastError: true
      }
    })
  ]);

  return {
    maxAttempts: MAX_OUTBOX_ATTEMPTS,
    byStatus: byStatus.map((item) => ({ status: item.status, count: item._count._all })),
    byProviderStatus: byProviderStatus.map((item) => ({
      provider: item.provider,
      status: item.status,
      count: item._count._all
    })),
    oldestPending,
    newestFailed
  };
}

export async function enqueueIntegrationEvent(input: {
  provider: IntegrationProvider;
  eventType: string;
  entityType: string;
  entityId?: number;
  payload: unknown;
}) {
  if (!isIntegrationConfigured(input.provider)) {
    throw new Error(`ยังไม่ได้ตั้งค่าการเชื่อมต่อ ${integrationLabel(input.provider)}`);
  }
  const result = await prisma.integrationOutbox.create({
    data: {
      provider: input.provider,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      payload: JSON.stringify(input.payload ?? {})
    }
  });

  return getIntegrationEvent(result.id);
}

export async function getIntegrationEvent(id: number) {
  const row = await prisma.integrationOutbox.findUnique({
    where: { id }
  });

  if (!row) return null;
  return { ...row, payload: parsePayload(row.payload) };
}

export async function getIntegrationEvents(input: { provider?: IntegrationProvider; status?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 200);

  const rows = await prisma.integrationOutbox.findMany({
    where: {
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.status ? { status: input.status } : {})
    },
    orderBy: { id: "desc" },
    take: limit
  });

  return rows.map((row) => ({ ...row, payload: parsePayload(row.payload) }));
}

export async function retryIntegrationEvent(id: number) {
  const event = await getIntegrationEvent(id);
  if (!event) return null;

  await prisma.integrationOutbox.update({
    where: { id },
    data: { status: "PENDING", attempts: 0, lastError: null, updatedAt: new Date() }
  });

  return getIntegrationEvent(id);
}

export async function enqueuePosposSync(branchId: number, requestedByUserId?: number) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw new Error("Branch not found");

  const activeJobs = await prisma.integrationOutbox.findMany({
    where: {
      provider: "pospos",
      eventType: "POSPOS_SYNC",
      entityType: "branch",
      entityId: branchId,
      status: { in: ["PENDING", "RUNNING"] }
    },
    orderBy: { id: "desc" },
    take: 5
  });

  for (const activeJob of activeJobs) {
    if (isPosposJobStale(activeJob)) {
      await prisma.integrationOutbox.update({
        where: { id: activeJob.id },
        data: {
          status: "FAILED",
          lastError: getStalePosposMessage(activeJob.status),
          updatedAt: new Date()
        }
      });
      continue;
    }
    return toPosposSyncJob(activeJob);
  }

  const row = await prisma.integrationOutbox.create({
    data: {
      provider: "pospos",
      eventType: "POSPOS_SYNC",
      entityType: "branch",
      entityId: branchId,
      payload: JSON.stringify({
        branchId,
        requestedByUserId: requestedByUserId ?? null,
        requestedAt: new Date().toISOString()
      })
    }
  });

  return toPosposSyncJob(row);
}

export async function getLatestPosposSyncJobsByBranch() {
  const branches = await prisma.branch.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      location: true,
      branchType: true,
      active: true,
      createdAt: true
    }
  });

  const items = await Promise.all(branches.map(async (branch) => {
    const row = await prisma.integrationOutbox.findFirst({
      where: {
        provider: "pospos",
        eventType: "POSPOS_SYNC",
        entityType: "branch",
        entityId: branch.id
      },
      orderBy: { id: "desc" }
    });

    return { branch, job: toPosposSyncJob(row) };
  }));

  return items;
}

export async function getPosposSyncJob(id: number) {
  const row = await prisma.integrationOutbox.findUnique({ where: { id } });
  if (!row || row.provider !== "pospos" || row.eventType !== "POSPOS_SYNC") return null;
  return toPosposSyncJob(row);
}

export async function runPosposSyncJob(id: number) {
  const row = await prisma.integrationOutbox.findUnique({ where: { id } });
  if (!row || row.provider !== "pospos" || row.eventType !== "POSPOS_SYNC") return null;
  if (row.status !== "PENDING") return toPosposSyncJob(row);

  const payload = parsePayload(row.payload) as Record<string, unknown>;
  const branchId = Number(payload.branchId ?? row.entityId);
  if (!Number.isFinite(branchId) || branchId <= 0) {
    const failed = await prisma.integrationOutbox.update({
      where: { id },
      data: {
        status: "FAILED",
        lastError: "Invalid branchId",
        attempts: { increment: 1 },
        updatedAt: new Date()
      }
    });
    return toPosposSyncJob(failed);
  }

  const runPayload = { ...payload, branchId, startedAt: new Date().toISOString() };
  const claimed = await prisma.integrationOutbox.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: "RUNNING",
      lastError: null,
      attempts: { increment: 1 },
      payload: JSON.stringify(runPayload),
      updatedAt: new Date()
    }
  });
  if (claimed.count === 0) return getPosposSyncJob(id);

  try {
    const { syncPosposData } = await import("../scripts/pospos-sync.js");
    const result = await syncPosposData(branchId);
    const done = await prisma.integrationOutbox.update({
      where: { id },
      data: {
        status: "SENT",
        lastError: null,
        payload: JSON.stringify({
          ...runPayload,
          result,
          finishedAt: new Date().toISOString()
        }),
        updatedAt: new Date()
      }
    });
    return toPosposSyncJob(done);
  } catch (err: any) {
    const failed = await prisma.integrationOutbox.update({
      where: { id },
      data: {
        status: "FAILED",
        lastError: toReadablePosposError(err),
        payload: JSON.stringify({
          ...runPayload,
          finishedAt: new Date().toISOString()
        }),
        updatedAt: new Date()
      }
    });
    return toPosposSyncJob(failed);
  }
}

export async function processOutboxQueue() {
  let skipped = await skipUnconfiguredOutbox();
  const pending = await prisma.integrationOutbox.findMany({
    where: { status: "PENDING", attempts: { lt: MAX_OUTBOX_ATTEMPTS } },
    orderBy: { id: "asc" },
    take: 10
  });

  let sent = 0;
  let retried = 0;
  let failed = 0;
  for (const event of pending) {
    const payload = parsePayload(event.payload);
    const def = DEFINITIONS.find(d => d.provider === event.provider);
    if (!def) continue;

    const missing = missingEnv(def.requiredEnv);
    if (missing.length > 0) {
      await prisma.integrationOutbox.update({
        where: { id: event.id },
        data: {
          status: "SKIPPED",
          lastError: `Missing ENV: ${missing.join(", ")}`,
          attempts: { increment: 1 },
          updatedAt: new Date()
        }
      });
      skipped++;
      continue;
    }

    try {
      if (event.provider === "pospos") {
        const job = await runPosposSyncJob(event.id);
        if (job?.status === "SENT") sent++;
        else if (job?.status === "FAILED") failed++;
        else skipped++;
        continue;
      } else if (event.provider === "rd_tax") {
        const endpoint = process.env.RD_TAX_ENDPOINT!;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-ID": process.env.RD_TAX_CLIENT_ID!,
            "X-Client-Secret": process.env.RD_TAX_CLIENT_SECRET!
          },
          body: JSON.stringify(payload)
        });
        await assertProviderResponseOk(response, event.provider);
      } else if (event.provider === "line_oa") {
        const token = process.env.LINE_OA_CHANNEL_ACCESS_TOKEN!;
        const response = await fetch("https://api.line.me/v2/bot/message/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({
            messages: [{
              type: "text",
              text: `☕ ออเดอร์ #${event.entityId} ยอด ฿${payload.total ?? 0} ชำระเรียบร้อย`
            }]
          })
        });
        await assertProviderResponseOk(response, event.provider);
      } else if (event.provider === "lineman") {
        const endpoint = process.env.LINEMAN_API_ENDPOINT!;
        const response = await fetch(`${endpoint}/orders/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": process.env.LINEMAN_API_KEY!
          },
          body: JSON.stringify(payload)
        });
        await assertProviderResponseOk(response, event.provider);
      } else if (event.provider === "email") {
        const response = await fetch(process.env.EMAIL_WEBHOOK_URL!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        await assertProviderResponseOk(response, event.provider);
      }

      await prisma.integrationOutbox.update({
        where: { id: event.id },
        data: { status: "SENT", attempts: { increment: 1 }, updatedAt: new Date() }
      });
      sent++;
    } catch (err: any) {
      const attempts = (event.attempts || 0) + 1;
      const status = attempts >= MAX_OUTBOX_ATTEMPTS ? "FAILED" : "PENDING";
      
      await prisma.integrationOutbox.update({
        where: { id: event.id },
        data: {
          status,
          lastError: String(err?.message || err).slice(0, 500),
          attempts,
          updatedAt: new Date()
        }
      });
      if (status === "FAILED") failed++;
      else retried++;
    }
  }

  const [remainingPending, remainingFailed] = await Promise.all([
    prisma.integrationOutbox.count({ where: { status: "PENDING" } }),
    prisma.integrationOutbox.count({ where: { status: "FAILED" } })
  ]);

  return {
    processed: sent,
    sent,
    retried,
    skipped,
    failed,
    total: pending.length,
    remainingPending,
    remainingFailed
  };
}
