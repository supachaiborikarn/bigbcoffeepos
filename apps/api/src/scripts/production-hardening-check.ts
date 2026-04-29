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
    pattern: /Production database: PostgreSQL/
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
