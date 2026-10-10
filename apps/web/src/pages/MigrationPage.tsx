import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Database, RefreshCw } from "lucide-react";
import { getPosposMigrationJob, getPosposMigrationStatuses, syncPosposMigration } from "../api";
import { useToast } from "../contexts/ToastContext";
import { useBranch } from "../contexts/BranchContext";
import type { PosposBranchSyncStatus, PosposSyncJob } from "../types";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 200;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isFinalJobStatus(status: PosposSyncJob["status"]) {
  return status === "SENT" || status === "FAILED" || status === "SKIPPED";
}

function canStartSync(job: PosposSyncJob | null) {
  if (!job) return true;
  if (job.status === "SENT") return true;
  return job.canRetry;
}

function jobStatusLabel(job: PosposSyncJob | null) {
  if (!job) return "ยังไม่เคยดึง";
  if (job.isStale) return "ค้าง";
  if (job.status === "PENDING") return "รอเริ่มงาน";
  if (job.status === "RUNNING") return "กำลังดึงข้อมูล";
  if (job.status === "SENT") return "เสร็จแล้ว";
  if (job.status === "FAILED") return "ล้มเหลว";
  return "ถูกข้าม";
}

function jobBadgeClass(job: PosposSyncJob | null) {
  if (!job) return "";
  if (job.isStale || job.status === "FAILED") return "badge--danger";
  if (job.status === "RUNNING" || job.status === "PENDING") return "badge--warning";
  if (job.status === "SENT") return "badge--active";
  return "";
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function readableJobError(job: PosposSyncJob) {
  if (job.isStale) return "งานดึงข้อมูลค้างนานเกินไป กรุณากดดึงใหม่";
  if (job.lastError) return job.lastError;
  if (job.status === "SKIPPED") return "งานถูกข้าม กรุณาตรวจการตั้งค่า POSPOS แล้วกดดึงใหม่";
  return "ดึงข้อมูล POSPOS ไม่สำเร็จ";
}

function resultSummary(job: PosposSyncJob | null) {
  if (!job) return "ยังไม่มีประวัติงาน";
  if (job.isStale) return readableJobError(job);
  if (job.status === "FAILED" || job.status === "SKIPPED") return readableJobError(job);
  if (job.status === "PENDING") return "รอระบบเริ่มงาน";
  if (job.status === "RUNNING") return "ระบบกำลังดึงข้อมูลจาก POSPOS";
  const data = job.result;
  return `ยอดขาย ${data?.sales ?? 0} บิล, เมนู ${data?.menuItems ?? 0} รายการ, สต็อก ${data?.ingredients ?? 0} รายการ, ลูกค้า ${data?.customers ?? 0} ราย`;
}

function actionLabel(job: PosposSyncJob | null) {
  if (!job) return "ดึงข้อมูล";
  if (job.isStale || job.status === "FAILED" || job.status === "SKIPPED") return "ดึงใหม่";
  if (job.status === "SENT") return "ดึงอีกครั้ง";
  return "กำลังทำงาน";
}

function JobIcon({ job }: { job: PosposSyncJob | null }) {
  if (!job) return <Database size={16} />;
  if (job.isStale || job.status === "FAILED" || job.status === "SKIPPED") return <AlertTriangle size={16} />;
  if (job.status === "SENT") return <CheckCircle2 size={16} />;
  return <Clock size={16} />;
}

export default function MigrationPage() {
  const toast = useToast();
  const { activeBranch } = useBranch();
  const [branchStatuses, setBranchStatuses] = useState<PosposBranchSyncStatus[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [runningBranchId, setRunningBranchId] = useState<number | null>(null);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);

  const refreshStatuses = useCallback(async (silent = false) => {
    if (!silent) setLoadingStatuses(true);
    try {
      const items = await getPosposMigrationStatuses();
      setBranchStatuses(items);
    } catch (e) {
      if (!silent) toast.error((e as Error).message);
    } finally {
      if (!silent) setLoadingStatuses(false);
    }
  }, [toast]);

  useEffect(() => {
    refreshStatuses();
  }, [refreshStatuses]);

  const hasLiveJob = useMemo(() => {
    return branchStatuses.some((item) => {
      const job = item.job;
      return job && !job.isStale && !isFinalJobStatus(job.status);
    });
  }, [branchStatuses]);

  useEffect(() => {
    if (!hasLiveJob) return;
    const timer = window.setInterval(() => refreshStatuses(true), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasLiveJob, refreshStatuses]);

  const activeBranchStatus = useMemo(() => {
    if (!activeBranch) return null;
    return branchStatuses.find((item) => item.branch.id === activeBranch.id) ?? null;
  }, [activeBranch, branchStatuses]);

  async function waitForJob(job: PosposSyncJob) {
    let current = job;
    let lastStatus = job.status;

    for (let i = 0; i < MAX_POLLS; i++) {
      if (current.isStale || isFinalJobStatus(current.status)) return current;

      await wait(POLL_INTERVAL_MS);
      current = await getPosposMigrationJob(current.id);

      if (current.status !== lastStatus) {
        lastStatus = current.status;
        setSyncLogs(prev => [...prev, `สถานะงาน #${current.id}: ${jobStatusLabel(current)}`]);
      }
    }

    throw new Error("งานดึงข้อมูลยังไม่จบ กรุณากลับมาตรวจสถานะใหม่อีกครั้ง");
  }

  async function handleSync(branch: PosposBranchSyncStatus["branch"] | null | undefined = activeBranch) {
    if (!branch) {
      toast.error("กรุณาเลือกสาขาก่อน");
      return;
    }

    const currentJob = branchStatuses.find((item) => item.branch.id === branch.id)?.job ?? null;
    if (!canStartSync(currentJob)) return;

    const confirmed = window.confirm(
      `ยืนยัน${actionLabel(currentJob)} POSPOS ของสาขา ${branch.name}?\n\nระบบจะดึงเมนู สต็อก ลูกค้า และยอดขาย POSPOS ล่าสุด\n• ยอดขายที่เคยนำเข้าจาก POSPOS จะถูกแทนด้วยชุดใหม่\n• บิลที่ขายใน BB POS และกะขายจะไม่ถูกแตะ\n• สต็อก: อัปเดตเฉพาะรายการที่ POSPOS มียอดมากกว่า 0 ไม่ตั้งเป็น 0 และไม่แตะแก้ว`
    );
    if (!confirmed) return;

    setRunningBranchId(branch.id);
    setSyncLogs([]);
    try {
      setSyncLogs([`สร้างงานดึงข้อมูล POSPOS ของ ${branch.name}...`]);
      const queuedJob = await syncPosposMigration(branch.id);
      setSyncLogs(prev => [...prev, `เริ่มงาน #${queuedJob.id}: ${jobStatusLabel(queuedJob)}`]);
      await refreshStatuses(true);

      const job = await waitForJob(queuedJob);
      await refreshStatuses(true);

      if (job.status !== "SENT") {
        throw new Error(readableJobError(job));
      }

      const data = job.result;
      setSyncLogs(prev => [
        ...prev,
        `ดึงข้อมูลสำเร็จ: แทนยอดขาย POSPOS ที่เคยนำเข้า ${data?.replacedOrders ?? 0} บิล, นำเข้ายอดขาย POSPOS ${data?.sales ?? 0} บิล, เมนู ${data?.menuItems ?? 0} รายการ, อัปเดตสต็อก ${data?.ingredients ?? 0} รายการ, ลูกค้า ${data?.customers ?? 0} รายการ`
      ]);
      toast.success("ดึงข้อมูลสำเร็จ");
    } catch (e) {
      toast.error((e as Error).message);
      setSyncLogs(prev => [...prev, `เกิดข้อผิดพลาด: ${(e as Error).message}`]);
    } finally {
      setRunningBranchId(null);
      await refreshStatuses(true);
    }
  }

  const activeJob = activeBranchStatus?.job ?? null;
  const isSelectedBranchBlocked = activeJob ? !canStartSync(activeJob) : false;

  return (
    <main className="app__grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px", maxWidth: "1040px" }}>
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>ย้ายข้อมูล POSPOS</h2>
            <p className="muted">ดึงข้อมูลสินค้า สต็อก ลูกค้า และยอดขายจาก POSPOS</p>
          </div>
          <button className="btn btn--ghost" onClick={() => refreshStatuses()} disabled={loadingStatuses}>
            <RefreshCw size={16} className={loadingStatuses ? "spin" : undefined} />
            {loadingStatuses ? "กำลังโหลด..." : "รีเฟรช"}
          </button>
        </div>

        <div style={{ padding: "0 24px 24px" }}>
          <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginBottom: "20px" }}>
            <button
              className="btn btn--primary"
              onClick={() => handleSync()}
              disabled={!activeBranch || runningBranchId !== null || isSelectedBranchBlocked}
            >
              <RefreshCw size={16} className={runningBranchId === activeBranch?.id ? "spin" : undefined} />
              {runningBranchId === activeBranch?.id ? "กำลังดึงข้อมูล..." : actionLabel(activeJob)}
            </button>
            <span className="muted" style={{ fontSize: "14px" }}>
              {activeBranch ? `สาขาที่เลือก: ${activeBranch.name}` : "กรุณาเลือกสาขาก่อน"}
            </span>
          </div>

          <div style={{ overflowX: "auto", marginBottom: "20px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 13 }}>
                  <th style={{ padding: "10px 8px" }}>สาขา</th>
                  <th style={{ padding: "10px 8px" }}>สถานะล่าสุด</th>
                  <th style={{ padding: "10px 8px" }}>อัปเดตล่าสุด</th>
                  <th style={{ padding: "10px 8px" }}>ผลลัพธ์</th>
                  <th style={{ padding: "10px 8px" }} />
                </tr>
              </thead>
              <tbody>
                {branchStatuses.map((item) => {
                  const job = item.job;
                  const isRunningThisBranch = runningBranchId === item.branch.id;
                  const blocked = !canStartSync(job);
                  return (
                    <tr key={item.branch.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 8px", minWidth: 180 }}>
                        <strong>{item.branch.name}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>{item.branch.location || `สาขา #${item.branch.id}`}</div>
                      </td>
                      <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                        <span className={`badge ${jobBadgeClass(job)}`} style={{ gap: 6 }}>
                          <JobIcon job={job} />
                          {jobStatusLabel(job)}
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>
                        {formatDateTime(job?.updatedAt)}
                      </td>
                      <td style={{ padding: "12px 8px", maxWidth: 360 }}>
                        <span className={job?.status === "FAILED" || job?.isStale ? "negative" : "muted"}>
                          {resultSummary(job)}
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="btn btn--ghost"
                          onClick={() => handleSync(item.branch)}
                          disabled={runningBranchId !== null || blocked}
                        >
                          <RefreshCw size={16} className={isRunningThisBranch ? "spin" : undefined} />
                          {isRunningThisBranch ? "กำลังดึง..." : actionLabel(job)}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!loadingStatuses && branchStatuses.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: "center" }} className="muted">
                      ยังไม่มีสาขาในระบบ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ background: "var(--bg-alt)", padding: "16px", borderRadius: "8px", minHeight: "180px", fontFamily: "monospace", fontSize: "14px", color: "var(--ink-secondary)" }} aria-live="polite">
            <div style={{ marginBottom: "8px", fontWeight: 600 }}>Logs</div>
            {syncLogs.length === 0 && <div style={{ opacity: 0.5 }}>ยังไม่มีการทำงาน...</div>}
            {syncLogs.map((log, i) => (
              <div key={i} style={{ marginBottom: "4px" }}>{log}</div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
