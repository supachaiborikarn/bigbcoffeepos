import fs from "fs";
import path from "path";

const root = path.resolve(process.cwd(), "../..");

function read(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertPattern(name: string, file: string, pattern: RegExp) {
  const text = read(file);
  if (!pattern.test(text)) throw new Error(`${name} missing in ${file}`);
}

const checks: Array<{ name: string; file: string; pattern: RegExp }> = [
  {
    name: "request id is emitted in logs and responses",
    file: "apps/api/src/logger.ts",
    pattern: /X-Request-ID[\s\S]*requestId/
  },
  {
    name: "slow request signal is emitted",
    file: "apps/api/src/logger.ts",
    pattern: /SLOW_REQUEST_MS[\s\S]*http_request_slow/
  },
  {
    name: "outbox failure alert signal is emitted",
    file: "apps/api/src/index.ts",
    pattern: /integration_outbox_attention_required[\s\S]*sendAlert\("warning",\s*"integration_outbox_attention_required"/
  },
  {
    name: "alert webhook delivery is implemented",
    file: "apps/api/src/logger.ts",
    pattern: /ALERT_CHANNEL_URL[\s\S]*fetch\(url[\s\S]*alert_delivery_failed/
  },
  {
    name: "slow and 5xx request alerts are wired",
    file: "apps/api/src/logger.ts",
    pattern: /http_request_5xx[\s\S]*http_request_slow/
  },
  {
    name: "audit write failure is logged",
    file: "apps/api/src/logger.ts",
    pattern: /audit_file_write_failed[\s\S]*sendAlert\("warning",\s*"audit_file_write_failed"/
  },
  {
    name: "admin alert test endpoint exists",
    file: "apps/api/src/index.ts",
    pattern: /\/api\/monitoring\/alert-test[\s\S]*sendAlert\("info",\s*event[\s\S]*monitoring\.alert_test/
  },
  {
    name: "CLI alert test exists",
    file: "apps/api/src/scripts/monitoring-alert-test.ts",
    pattern: /monitoring_alert_test[\s\S]*ALERT_CHANNEL_URL/
  },
  {
    name: "monitoring policy documents owner alert channel",
    file: "docs/MONITORING_ALERTS.md",
    pattern: /ALERT_CHANNEL_URL[\s\S]*http_request_slow[\s\S]*integration_outbox_attention_required/
  },
  {
    name: "runbook links monitoring targets",
    file: "docs/PRODUCTION_RUNBOOK.md",
    pattern: /Monitoring Targets[\s\S]*integration_outbox_attention_required/
  }
];

for (const check of checks) assertPattern(check.name, check.file, check.pattern);

if (process.env.REQUIRE_ALERT_CHANNEL === "1" && !process.env.ALERT_CHANNEL_URL) {
  throw new Error("ALERT_CHANNEL_URL is required when REQUIRE_ALERT_CHANNEL=1");
}

console.log(`Monitoring policy checks passed (${checks.length}/${checks.length})`);
