import fs from "fs";
import path from "path";
import type express from "express";
import type { AuthRequest } from "./middleware/auth.js";

type LogLevel = "info" | "warn" | "error";
type LogMeta = Record<string, unknown>;
type AlertSeverity = "info" | "warning" | "critical";

const auditLogFile = process.env.AUDIT_LOG_FILE || path.resolve(process.cwd(), "data", "audit.log");
const redactKeys = new Set(["pin", "token", "authorization", "password", "clientSecret"]);
const slowRequestMs = Number(process.env.SLOW_REQUEST_MS || 1000);
const alertTimeoutMs = Number(process.env.ALERT_TIMEOUT_MS || 3000);
let lastAlertFailureLogAt = 0;

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);

  const clean: LogMeta = {};
  for (const [key, raw] of Object.entries(value as LogMeta)) {
    clean[key] = redactKeys.has(key.toLowerCase()) ? "[REDACTED]" : redact(raw);
  }
  return clean;
}

export function log(level: LogLevel, event: string, meta: LogMeta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(meta) as LogMeta
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function sendAlert(severity: AlertSeverity, event: string, meta: LogMeta = {}) {
  const url = process.env.ALERT_CHANNEL_URL;
  if (!url) return false;

  const payload = {
    text: `[${severity.toUpperCase()}] ${event}`,
    severity,
    event,
    ts: new Date().toISOString(),
    meta: redact(meta)
  };

  void postAlert(url, payload);
  return true;
}

async function postAlert(url: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), alertTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Alert webhook returned ${response.status}`);
  } catch (error) {
    const now = Date.now();
    if (now - lastAlertFailureLogAt > 60_000) {
      lastAlertFailureLogAt = now;
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        event: "alert_delivery_failed",
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  } finally {
    clearTimeout(timer);
  }
}

export function requestLogger(req: express.Request, res: express.Response, next: express.NextFunction) {
  const start = Date.now();
  const requestId = String(req.headers["x-request-id"] || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  res.setHeader("X-Request-ID", requestId);
  (req as express.Request & { requestId?: string }).requestId = requestId;
  res.on("finish", () => {
    if (req.path === "/api/health") return;
    const durationMs = Date.now() - start;
    const isSlow = Number.isFinite(slowRequestMs) && durationMs >= slowRequestMs;
    const event = isSlow ? "http_request_slow" : "http_request";
    const meta = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
      userId: (req as AuthRequest).user?.id,
      role: (req as AuthRequest).user?.role
    };
    log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 || isSlow ? "warn" : "info", event, meta);
    if (res.statusCode >= 500) sendAlert("critical", "http_request_5xx", meta);
    else if (isSlow) sendAlert("warning", "http_request_slow", meta);
  });
  next();
}

export function audit(action: string, req: AuthRequest | express.Request, details: LogMeta = {}) {
  const authReq = req as AuthRequest;
  const entry = {
    ts: new Date().toISOString(),
    type: "audit",
    action,
    actor: authReq.user ? {
      id: authReq.user.id,
      role: authReq.user.role,
      branchId: authReq.user.branchId ?? null
    } : null,
    ip: req.ip,
    requestId: (req as express.Request & { requestId?: string }).requestId,
    ...redact(details) as LogMeta
  };

  const line = JSON.stringify(entry);
  console.log(line);

  fs.promises.mkdir(path.dirname(auditLogFile), { recursive: true })
    .then(() => fs.promises.appendFile(auditLogFile, `${line}\n`))
    .catch((err) => {
      const meta = { message: err instanceof Error ? err.message : String(err) };
      log("warn", "audit_file_write_failed", meta);
      sendAlert("warning", "audit_file_write_failed", meta);
    });
}
