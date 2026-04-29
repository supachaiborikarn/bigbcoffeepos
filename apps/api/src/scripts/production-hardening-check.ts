import fs from "fs";
import path from "path";

const root = path.resolve(process.cwd(), "../..");

function read(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

const checks: Array<{ name: string; file: string; pattern: RegExp }> = [
  {
    name: "checkout uses a Prisma transaction",
    file: "apps/api/src/store/orders.ts",
    pattern: /prisma\.\$transaction\(async \(tx\)/
  },
  {
    name: "stock decrement is conditionally guarded by available stock",
    file: "apps/api/src/store/orders.ts",
    pattern: /stockQty:\s*\{\s*gte:\s*requiredQty\s*\}[\s\S]*decrement:\s*requiredQty/
  },
  {
    name: "cancel/refund restores stock with movement trail",
    file: "apps/api/src/store/orders.ts",
    pattern: /REVERSAL_STATUSES[\s\S]*stockMovement\.create/
  },
  {
    name: "customer points are updated inside checkout transaction",
    file: "apps/api/src/store/orders.ts",
    pattern: /tx\.customer\.updateMany\([\s\S]*points:\s*\{\s*gte:\s*pointsToUse/
  },
  {
    name: "PIN login has rate limiting",
    file: "apps/api/src/index.ts",
    pattern: /enforcePinRateLimit/
  },
  {
    name: "sensitive routes use role middleware",
    file: "apps/api/src/index.ts",
    pattern: /requireRole\("admin",\s*"manager"\)/
  },
  {
    name: "cashier branch access is enforced",
    file: "apps/api/src/middleware/auth.ts",
    pattern: /requireBranchAccess/
  },
  {
    name: "new PINs are hashed",
    file: "apps/api/src/store/users.ts",
    pattern: /pbkdf2Sync/
  },
  {
    name: "cash payments require received amount",
    file: "apps/api/src/store/orders.ts",
    pattern: /cashReceived[\s\S]*cashReceived < total/
  },
  {
    name: "non-cash payments require confirmation",
    file: "apps/api/src/store/orders.ts",
    pattern: /paymentConfirmed !== true/
  },
  {
    name: "modifier pricing is backend-owned",
    file: "apps/api/src/store/orders.ts",
    pattern: /MODIFIER_CATALOG[\s\S]*catalogItem\.price/
  },
  {
    name: "order center no longer uses mock orders",
    file: "apps/web/src/pages/OrdersPage.tsx",
    pattern: /getOrders\(activeBranch\.id\)/
  },
  {
    name: "reports exclude reversed orders",
    file: "apps/api/src/store/reports.ts",
    pattern: /status:\s*\{\s*notIn:\s*\["CANCELLED",\s*"REFUNDED"\]/
  },
  {
    name: "structured request logging is enabled",
    file: "apps/api/src/index.ts",
    pattern: /app\.use\(requestLogger\)/
  },
  {
    name: "audit trail writes operational events",
    file: "apps/api/src/index.ts",
    pattern: /audit\("order\.created"/
  },
  {
    name: "logger emits JSON entries",
    file: "apps/api/src/logger.ts",
    pattern: /JSON\.stringify\(entry\)/
  },
  {
    name: "README documents PostgreSQL production mode",
    file: "README.md",
    pattern: /Runtime database: PostgreSQL/
  },
  {
    name: "API env example exists with JWT secret",
    file: "apps/api/.env.example",
    pattern: /JWT_SECRET/
  },
  {
    name: "POSPOS explorer with hardcoded credentials is absent",
    file: "apps/api/src/scripts/explore-pospos.ts",
    pattern: /^$/
  },
  {
    name: "export script uses configurable output directory",
    file: "apps/api/src/scripts/export-data.ts",
    pattern: /EXPORT_OUT_DIR/
  },
  {
    name: "mock history generator requires explicit opt-in",
    file: "apps/api/src/scripts/generate-mock-history.ts",
    pattern: /ALLOW_MOCK_HISTORY/
  },
  {
    name: "POSPOS sync credentials come from env",
    file: "apps/api/src/scripts/pospos-sync.ts",
    pattern: /POSPOS_EMAIL[\s\S]*POSPOS_PASSWORD/
  },
  {
    name: "API runtime fails fast without PostgreSQL DATABASE_URL",
    file: "apps/api/src/index.ts",
    pattern: /DATABASE_URL must be a PostgreSQL connection string/
  },
  {
    name: "order detail endpoint enforces cashier branch scope",
    file: "apps/api/src/index.ts",
    pattern: /ไม่มีสิทธิ์ดูออเดอร์ของสาขาอื่น/
  },
  {
    name: "production requires JWT_SECRET",
    file: "apps/api/src/middleware/auth.ts",
    pattern: /JWT_SECRET is required when NODE_ENV=production/
  },
  {
    name: "payment evidence is persisted",
    file: "apps/api/prisma/schema.prisma",
    pattern: /model Payment[\s\S]*amountReceived[\s\S]*confirmedByUserId/
  },
  {
    name: "payment and event schema changes have a migration",
    file: "apps/api/prisma/migrations/202604290001_production_reliability/migration.sql",
    pattern: /idempotency_key[\s\S]*CREATE TABLE "payments"[\s\S]*CREATE TABLE "order_events"/
  },
  {
    name: "checkout writes payment row",
    file: "apps/api/src/store/orders.ts",
    pattern: /tx\.payment\.create/
  },
  {
    name: "order event history is persisted",
    file: "apps/api/prisma/schema.prisma",
    pattern: /model OrderEvent[\s\S]*eventType[\s\S]*payload/
  },
  {
    name: "refund and cancel write order events",
    file: "apps/api/src/store/orders.ts",
    pattern: /ORDER_REFUNDED[\s\S]*ORDER_CANCELLED/
  },
  {
    name: "checkout idempotency key is unique",
    file: "apps/api/prisma/schema.prisma",
    pattern: /idempotencyKey\s+String\?\s+@unique/
  },
  {
    name: "integration provider HTTP failures are retried",
    file: "apps/api/src/store/integrations.ts",
    pattern: /assertProviderResponseOk[\s\S]*response\.ok[\s\S]*throw new Error/
  },
  {
    name: "integration retry resets exhausted attempts",
    file: "apps/api/src/store/integrations.ts",
    pattern: /retryIntegrationEvent[\s\S]*attempts:\s*0/
  },
  {
    name: "integration outbox summary endpoint exists",
    file: "apps/api/src/index.ts",
    pattern: /\/api\/integrations\/summary[\s\S]*getIntegrationOutboxSummary/
  },
  {
    name: "integration outbox processing reports observable counters",
    file: "apps/api/src/store/integrations.ts",
    pattern: /remainingPending[\s\S]*remainingFailed/
  },
  {
    name: "request logs include request ids",
    file: "apps/api/src/logger.ts",
    pattern: /X-Request-ID[\s\S]*requestId/
  },
  {
    name: "slow requests are observable",
    file: "apps/api/src/logger.ts",
    pattern: /SLOW_REQUEST_MS[\s\S]*http_request_slow/
  },
  {
    name: "audit search endpoint exists",
    file: "apps/api/src/index.ts",
    pattern: /\/api\/audit[\s\S]*readAuditRows/
  },
  {
    name: "audit CSV export endpoint exists",
    file: "apps/api/src/index.ts",
    pattern: /\/api\/audit\.csv[\s\S]*sendCsv/
  },
  {
    name: "integration outbox failure alert log exists",
    file: "apps/api/src/index.ts",
    pattern: /integration_outbox_attention_required/
  },
  {
    name: "production runbook exists",
    file: "docs/PRODUCTION_RUNBOOK.md",
    pattern: /Deploy Checklist[\s\S]*Rollback[\s\S]*Monitoring Targets/
  },
  {
    name: "database-backed checkout integration check exists",
    file: "apps/api/src/scripts/checkout-integration-check.ts",
    pattern: /createOrder[\s\S]*ORDER_REFUNDED[\s\S]*Promise\.allSettled/
  },
  {
    name: "checkout integration check is runnable",
    file: "apps/api/package.json",
    pattern: /checkout:integration/
  }
];

const failures = checks.filter((check) => {
  if (check.name.includes("is absent")) return fs.existsSync(path.join(root, check.file));
  return !check.pattern.test(read(check.file));
});

if (failures.length) {
  console.error("Production hardening checks failed:");
  for (const failure of failures) console.error(`- ${failure.name} (${failure.file})`);
  process.exit(1);
}

console.log(`Production hardening checks passed (${checks.length}/${checks.length})`);
