import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import db, { dataDir } from "./db.js";

export type BackupInfo = {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  reason: string;
  totalPages: number;
};

type BackupStatus = {
  enabled: boolean;
  intervalMinutes: number;
  retentionCount: number;
  backupDir: string;
  backupOnStartup: boolean;
  inProgress: boolean;
  lastBackup: BackupInfo | null;
  lastError: string | null;
  nextRunAt: string | null;
  backups: BackupInfo[];
};

const DEFAULT_INTERVAL_MINUTES = 60;
const DEFAULT_RETENTION_COUNT = 48;

let backupInProgress = false;
let lastBackup: BackupInfo | null = null;
let lastError: string | null = null;
let nextRunAt: string | null = null;
let timer: NodeJS.Timeout | null = null;

function readPositiveNumber(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveInteger(raw: string | undefined, fallback: number) {
  return Math.max(1, Math.floor(readPositiveNumber(raw, fallback)));
}

function getBackupDir() {
  return process.env.DB_BACKUP_DIR
    ? path.resolve(process.env.DB_BACKUP_DIR)
    : path.join(dataDir, "backups");
}

function getBackupIntervalMinutes() {
  return readPositiveNumber(process.env.DB_BACKUP_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES);
}

function getRetentionCount() {
  return readPositiveInteger(process.env.DB_BACKUP_RETENTION_COUNT, DEFAULT_RETENTION_COUNT);
}

function isEnabled() {
  return process.env.DB_BACKUP_ENABLED !== "0";
}

function shouldBackupOnStartup() {
  return process.env.DB_BACKUP_ON_STARTUP !== "0";
}

function makeTimestamp() {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 17);
}

function safeReason(reason: string) {
  return reason.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "manual";
}

function toBackupInfo(filePath: string, reason = "existing"): BackupInfo {
  const stat = fs.statSync(filePath);
  return {
    filename: path.basename(filePath),
    path: filePath,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
    reason,
    totalPages: 0
  };
}

function removeSqliteSidecars(filePath: string) {
  fs.rmSync(`${filePath}-shm`, { force: true });
  fs.rmSync(`${filePath}-wal`, { force: true });
}

export function listDatabaseBackups() {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) return [];

  return fs.readdirSync(backupDir)
    .filter((file) => /^pos-\d{14}(?:\d{3})?-[a-z0-9-]+\.db$/.test(file))
    .map((file) => toBackupInfo(path.join(backupDir, file)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function verifyBackup(filePath: string) {
  const backupDb = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = backupDb.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`SQLite integrity check failed: ${String(result)}`);
  } finally {
    backupDb.close();
    removeSqliteSidecars(filePath);
  }
}

function pruneOldBackups() {
  const retentionCount = getRetentionCount();
  const backups = listDatabaseBackups();
  backups.slice(retentionCount).forEach((backup) => {
    fs.rmSync(backup.path, { force: true });
    removeSqliteSidecars(backup.path);
  });
}

export async function createDatabaseBackup(reason = "manual"): Promise<BackupInfo> {
  if (backupInProgress) throw new Error("Database backup is already running");

  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const filename = `pos-${makeTimestamp()}-${safeReason(reason)}.db`;
  const backupPath = path.join(backupDir, filename);

  backupInProgress = true;
  try {
    const metadata = await db.backup(backupPath);
    verifyBackup(backupPath);

    const stat = fs.statSync(backupPath);
    const info: BackupInfo = {
      filename,
      path: backupPath,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
      reason,
      totalPages: metadata.totalPages
    };

    lastBackup = info;
    lastError = null;
    pruneOldBackups();
    return info;
  } catch (error) {
    fs.rmSync(backupPath, { force: true });
    removeSqliteSidecars(backupPath);
    lastError = error instanceof Error ? error.message : "Unknown backup error";
    throw error;
  } finally {
    backupInProgress = false;
  }
}

async function runScheduledBackup(reason: string) {
  try {
    const backup = await createDatabaseBackup(reason);
    console.log(`[Backup] Created ${backup.filename}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backup error";
    lastError = message;
    console.error(`[Backup] Failed: ${message}`);
  }
}

function scheduleNextRun() {
  const intervalMinutes = getBackupIntervalMinutes();
  nextRunAt = new Date(Date.now() + intervalMinutes * 60_000).toISOString();
}

export function startAutoBackup() {
  if (timer) return;

  if (!isEnabled()) {
    console.log("[Backup] Auto-backup disabled by DB_BACKUP_ENABLED=0");
    return;
  }

  const intervalMinutes = getBackupIntervalMinutes();
  scheduleNextRun();

  if (shouldBackupOnStartup()) {
    void runScheduledBackup("startup");
  }

  timer = setInterval(() => {
    scheduleNextRun();
    void runScheduledBackup("scheduled");
  }, intervalMinutes * 60_000);
  timer.unref?.();

  console.log(`[Backup] Auto-backup enabled: every ${intervalMinutes} minute(s), retention ${getRetentionCount()}`);
}

export function stopAutoBackup() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  nextRunAt = null;
}

export function getBackupStatus(): BackupStatus {
  return {
    enabled: isEnabled(),
    intervalMinutes: getBackupIntervalMinutes(),
    retentionCount: getRetentionCount(),
    backupDir: getBackupDir(),
    backupOnStartup: shouldBackupOnStartup(),
    inProgress: backupInProgress,
    lastBackup,
    lastError,
    nextRunAt,
    backups: listDatabaseBackups()
  };
}
