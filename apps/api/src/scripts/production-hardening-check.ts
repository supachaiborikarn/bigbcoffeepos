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
    name: "checkout retries transient transaction conflicts",
    file: "apps/api/src/store/orders.ts",
    pattern: /CHECKOUT_TX_RETRIES[\s\S]*isRetryableCheckoutError[\s\S]*สต็อกมีการเปลี่ยนแปลง[\s\S]*waitForCheckoutRetry/
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
    name: "cup modifiers decrement stock",
    file: "apps/api/src/store/orders.ts",
    pattern: /CUP_STOCK_INGREDIENTS[\s\S]*แก้วพลาสติก 16oz[\s\S]*addModifierStockRequirements[\s\S]*modifier\.name !== "Cup"/
  },
  {
    name: "cup variant menu cards are hidden from POS grid",
    file: "apps/web/src/components/pos/ProductGrid.tsx",
    pattern: /isCupVariantMenuItem[\s\S]*return false/
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
    pattern: /Runtime database: PostgreSQL[\s\S]*ถ้าไม่ตั้ง `DATABASE_URL`[\s\S]*API จะไม่ start/
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
    pattern: /^(?![\s\S]*better-sqlite3)[\s\S]*DATABASE_URL must be a PostgreSQL connection string/
  },
  {
    name: "order detail endpoint enforces cashier branch scope",
    file: "apps/api/src/index.ts",
    pattern: /\/api\/orders\/:id",\s*requireRole\("admin",\s*"manager",\s*"cashier"\)[\s\S]*ไม่มีสิทธิ์ดูออเดอร์ของสาขาอื่น/
  },
  {
    name: "non-local runtime requires JWT_SECRET",
    file: "apps/api/src/middleware/auth.ts",
    pattern: /localJwtFallbackModes[\s\S]*JWT_SECRET is required when NODE_ENV is not development\/test\/local/
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
    name: "fresh PostgreSQL databases have a baseline migration",
    file: "apps/api/prisma/migrations/202604290000_initial_baseline/migration.sql",
    pattern: /CREATE TABLE IF NOT EXISTS "branches"[\s\S]*CREATE TABLE IF NOT EXISTS "orders"[\s\S]*CREATE TABLE IF NOT EXISTS "integration_outbox"/
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
    name: "alert webhook delivery is implemented",
    file: "apps/api/src/logger.ts",
    pattern: /sendAlert[\s\S]*ALERT_CHANNEL_URL[\s\S]*fetch\(url/
  },
  {
    name: "admin monitoring alert test endpoint exists",
    file: "apps/api/src/index.ts",
    pattern: /\/api\/monitoring\/alert-test[\s\S]*monitoring\.alert_test/
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
    pattern: /createOrder[\s\S]*Cup stock decrement mismatch[\s\S]*ORDER_REFUNDED[\s\S]*Promise\.allSettled/
  },
  {
    name: "checkout integration check is runnable",
    file: "apps/api/package.json",
    pattern: /checkout:integration/
  },
  {
    name: "migration deploy script is available",
    file: "apps/api/package.json",
    pattern: /db:migrate[\s\S]*prisma migrate deploy/
  },
  {
    name: "API start checks migration status",
    file: "apps/api/package.json",
    pattern: /prestart[\s\S]*db:migrate:status/
  },
  {
    name: "CI verifies build, migrations, hardening, and DB integration",
    file: ".github/workflows/ci.yml",
    pattern: /postgres:16[\s\S]*npm run ci:verify/
  },
  {
    name: "root CI script gates migration and checkout integration",
    file: "package.json",
    pattern: /ci:verify[\s\S]*db:migrate[\s\S]*checkout:integration[\s\S]*load:concurrency[\s\S]*browser:e2e/
  },
  {
    name: "browser E2E check exists",
    file: "apps/api/src/scripts/browser-e2e-check.ts",
    pattern: /(?=[\s\S]*chromium\.launch)(?=[\s\S]*addModifiedLatte)(?=[\s\S]*แก้วเย็น)(?=[\s\S]*Underpayment should keep cash confirmation disabled)(?=[\s\S]*สแกนจ่าย \(QR\))(?=[\s\S]*บัตรเครดิต)(?=[\s\S]*ORDER_CANCELLED)/
  },
  {
    name: "CI installs browser runtime",
    file: ".github/workflows/ci.yml",
    pattern: /playwright install --with-deps chromium/
  },
  {
    name: "load concurrency check exists",
    file: "apps/api/src/scripts/load-concurrency-check.ts",
    pattern: /Promise\.allSettled[\s\S]*Stock went negative[\s\S]*totalSales/
  },
  {
    name: "backup restore drill check exists",
    file: "apps/api/src/scripts/backup-restore-check.ts",
    pattern: /RESTORE_DATABASE_URL[\s\S]*rollbackSteps[\s\S]*Report written/
  },
  {
    name: "restore drill workflow is scheduled",
    file: ".github/workflows/restore-drill.yml",
    pattern: /workflow_dispatch[\s\S]*schedule[\s\S]*RESTORE_DATABASE_URL[\s\S]*upload-artifact/
  },
  {
    name: "monitoring policy check exists",
    file: "apps/api/src/scripts/monitoring-policy-check.ts",
    pattern: /integration_outbox_attention_required[\s\S]*admin alert test endpoint exists[\s\S]*ALERT_CHANNEL_URL/
  },
  {
    name: "monitoring alert policy exists",
    file: "docs/MONITORING_ALERTS.md",
    pattern: /Required Alerts[\s\S]*http_request_slow[\s\S]*integration_outbox_attention_required/
  },
  {
    name: "production data readiness check exists",
    file: "apps/api/src/scripts/production-data-readiness-check.ts",
    pattern: /No recipes are configured[\s\S]*dayCloseRehearsalRequired/
  },
  {
    name: "exact-match recipe bootstrap is guarded",
    file: "apps/api/src/scripts/bootstrap-exact-match-recipes.ts",
    pattern: /APPLY_RECIPE_BOOTSTRAP[\s\S]*ALLOW_RECIPE_BOOTSTRAP[\s\S]*skipDuplicates/
  },
  {
    name: "exact-match recipe bootstrap is runnable",
    file: "apps/api/package.json",
    pattern: /recipes:bootstrap-exact/
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
