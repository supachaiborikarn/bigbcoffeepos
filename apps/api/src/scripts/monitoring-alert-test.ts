import { sendAlert } from "../logger.js";

const configured = sendAlert("info", "monitoring_alert_test", {
  source: "script",
  environment: process.env.NODE_ENV || "development",
  runId: process.env.GITHUB_RUN_ID || process.env.CI ? "ci" : "local"
});

if (!configured) {
  if (process.env.REQUIRE_ALERT_CHANNEL === "1") {
    throw new Error("ALERT_CHANNEL_URL is required when REQUIRE_ALERT_CHANNEL=1");
  }
  console.log("Monitoring alert test skipped: ALERT_CHANNEL_URL is not configured");
  process.exit(0);
}

await new Promise((resolve) => setTimeout(resolve, Number(process.env.ALERT_DRAIN_MS || 750)));
console.log("Monitoring alert test sent");
