import fs from "fs";
import path from "path";

const root = path.resolve(process.cwd(), "../..");

function read(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertPattern(name: string, file: string, pattern: RegExp) {
  const text = read(file);
  if (!pattern.test(text)) {
    throw new Error(`${name} missing in ${file}`);
  }
}

const checks: Array<{ name: string; file: string; pattern: RegExp }> = [
  {
    name: "PIN login route",
    file: "apps/api/src/index.ts",
    pattern: /app\.post\("\/api\/auth\/pin"[\s\S]*authenticatePin/
  },
  {
    name: "Branch selection route",
    file: "apps/web/src/router.tsx",
    pattern: /path:\s*"\/branch"[\s\S]*BranchSelectPage/
  },
  {
    name: "POS route is guarded by AppLayout",
    file: "apps/web/src/router.tsx",
    pattern: /element:\s*<AppLayout[\s\S]*path:\s*"\/pos"[\s\S]*POSPage/
  },
  {
    name: "Visible shift open control",
    file: "apps/web/src/components/layout/TopBar.tsx",
    pattern: /openShift[\s\S]*เปิดกะ/
  },
  {
    name: "Checkout is blocked without active shift",
    file: "apps/web/src/components/pos/CartPanel.tsx",
    pattern: /disabled=\{cart\.length === 0 \|\| isSubmitting \|\| !activeShift\}/
  },
  {
    name: "Checkout sends order to API",
    file: "apps/web/src/contexts/CartContext.tsx",
    pattern: /createOrder\([\s\S]*shiftId:\s*activeShift\.id/
  },
  {
    name: "Stock decrement is guarded",
    file: "apps/api/src/store/orders.ts",
    pattern: /stockQty:\s*\{\s*gte:\s*requiredQty\s*\}[\s\S]*decrement:\s*requiredQty/
  },
  {
    name: "Cancel and refund reverse stock",
    file: "apps/api/src/store/orders.ts",
    pattern: /REVERSAL_STATUSES[\s\S]*stockMovement\.create/
  },
  {
    name: "Order status API supports refund/cancel path",
    file: "apps/api/src/index.ts",
    pattern: /app\.patch\("\/api\/orders\/:id"[\s\S]*updateOrderStatus/
  },
  {
    name: "Daily send-total report endpoint",
    file: "apps/api/src/index.ts",
    pattern: /\/api\/reports\/day-close/
  },
  {
    name: "Daily send-total print button",
    file: "apps/web/src/pages/ReportsPage.tsx",
    pattern: /พิมพ์ใบส่งยอด/
  },
  {
    name: "Integration outbox manual processor",
    file: "apps/api/src/index.ts",
    pattern: /\/api\/integrations\/process[\s\S]*processOutboxQueue/
  }
];

for (const check of checks) {
  assertPattern(check.name, check.file, check.pattern);
}

console.log(`POS workflow smoke checks passed (${checks.length}/${checks.length})`);
