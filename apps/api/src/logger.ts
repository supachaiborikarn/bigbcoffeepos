import fs from "fs";
import path from "path";
import type express from "express";
import type { AuthRequest } from "./middleware/auth.js";

type LogLevel = "info" | "warn" | "error";
type LogMeta = Record<string, unknown>;

const auditLogFile = process.env.AUDIT_LOG_FILE || path.resolve(process.cwd(), "data", "audit.log");
const redactKeys = new Set(["pin", "token", "authorization", "password", "clientSecret"]);

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

export function requestLogger(req: express.Request, res: express.Response, next: express.NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    if (req.path === "/api/health") return;
    log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", "http_request", {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
      userId: (req as AuthRequest).user?.id,
      role: (req as AuthRequest).user?.role
    });
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
    ...redact(details) as LogMeta
  };

  const line = JSON.stringify(entry);
  console.log(line);

  fs.promises.mkdir(path.dirname(auditLogFile), { recursive: true })
    .then(() => fs.promises.appendFile(auditLogFile, `${line}\n`))
    .catch((err) => {
      log("warn", "audit_file_write_failed", { message: err instanceof Error ? err.message : String(err) });
    });
}
