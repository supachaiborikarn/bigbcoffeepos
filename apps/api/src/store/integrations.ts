import prisma from "../prisma.js";

export type IntegrationProvider = "rd_tax" | "line_oa" | "lineman";

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
  }
];

const MAX_OUTBOX_ATTEMPTS = 3;

function missingEnv(requiredEnv: string[]) {
  return requiredEnv.filter((key) => !process.env[key]);
}

function parsePayload(value: unknown) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
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

export async function processOutboxQueue() {
  const pending = await prisma.integrationOutbox.findMany({
    where: { status: "PENDING", attempts: { lt: MAX_OUTBOX_ATTEMPTS } },
    orderBy: { id: "asc" },
    take: 10
  });

  let sent = 0;
  let retried = 0;
  let skipped = 0;
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
      if (event.provider === "rd_tax") {
        const endpoint = process.env.RD_TAX_ENDPOINT!;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-ID": process.env.RD_TAX_CLIENT_ID!,
            "X-Client-Secret": process.env.RD_TAX_CLIENT_SECRET!
          },
          body: JSON.stringify({ ...payload, vat: 7 })
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
