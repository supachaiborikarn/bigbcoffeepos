import { useCallback, useEffect, useMemo, useState } from "react";
import { getIntegrationEvents, getIntegrationStatus, processIntegrationOutbox, retryIntegrationEvent } from "../api";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import type { IntegrationEvent, IntegrationProvider, IntegrationStatus } from "../types";

const providerLabel: Record<IntegrationProvider, string> = {
  rd_tax: "RD / e-Tax",
  line_oa: "Line OA",
  lineman: "Lineman"
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function getStatusClass(status: IntegrationEvent["status"]) {
  if (status === "SENT") return "badge--active";
  if (status === "FAILED") return "badge--danger";
  return "";
}

export default function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusItems, eventItems] = await Promise.all([
        getIntegrationStatus(),
        getIntegrationEvents(40)
      ]);
      setStatuses(statusItems);
      setEvents(eventItems);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (user?.role === "admin") refresh();
    else setLoading(false);
  }, [refresh, user]);

  const totals = useMemo(() => {
    return statuses.reduce(
      (acc, item) => ({
        pending: acc.pending + item.pendingEvents,
        failed: acc.failed + item.failedEvents,
        configured: acc.configured + (item.configured ? 1 : 0)
      }),
      { pending: 0, failed: 0, configured: 0 }
    );
  }, [statuses]);

  async function handleRetry(eventId: number) {
    setRetryingId(eventId);
    try {
      await retryIntegrationEvent(eventId);
      toast.success("ส่งเข้าคิวใหม่แล้ว");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRetryingId(null);
    }
  }

  async function handleProcessOutbox() {
    setProcessing(true);
    try {
      const result = await processIntegrationOutbox();
      toast.success(`ประมวลผลคิว ${result.total} งาน ส่งสำเร็จ ${result.processed} งาน`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProcessing(false);
    }
  }

  if (user?.role !== "admin") {
    return (
      <div>
        <h2>ตั้งค่า</h2>
        <div className="panel" style={{ marginTop: 16, padding: 24 }}>
          <h3>สิทธิ์การเข้าถึง</h3>
          <p className="muted">หน้านี้เปิดให้ผู้ดูแลระบบดูสถานะระบบเชื่อมต่อและงานคิวภายนอกเท่านั้น</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel__header" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div>
          <h2>ตั้งค่า</h2>
          <p className="muted">ตรวจสถานะระบบเชื่อมต่อและงาน outbox สำหรับ Phase 3</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--ghost" onClick={handleProcessOutbox} disabled={processing}>
            {processing ? "กำลังส่งคิว..." : "ส่งคิวตอนนี้"}
          </button>
          <button className="btn btn--ghost" onClick={refresh} disabled={loading}>
            {loading ? "กำลังโหลด..." : "รีเฟรช"}
          </button>
        </div>
      </div>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16
        }}
      >
        <div className="panel" style={{ padding: 18 }}>
          <p className="muted" style={{ margin: 0 }}>เชื่อมต่อพร้อมใช้</p>
          <strong style={{ fontSize: 28 }}>{totals.configured}/{statuses.length || 3}</strong>
        </div>
        <div className="panel" style={{ padding: 18 }}>
          <p className="muted" style={{ margin: 0 }}>รอส่ง</p>
          <strong style={{ fontSize: 28 }}>{totals.pending}</strong>
        </div>
        <div className="panel" style={{ padding: 18 }}>
          <p className="muted" style={{ margin: 0 }}>ผิดพลาด</p>
          <strong style={{ fontSize: 28 }}>{totals.failed}</strong>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 16
        }}
      >
        {statuses.map((item) => (
          <article key={item.provider} className="panel" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0 }}>{item.label}</h3>
                <p className="muted" style={{ marginTop: 6 }}>{item.description}</p>
              </div>
              <span className={`badge ${item.configured ? "badge--active" : ""}`}>
                {item.configured ? "พร้อม" : "รอค่า ENV"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
              <span className="badge">รอส่ง {item.pendingEvents}</span>
              <span className={`badge ${item.failedEvents > 0 ? "badge--danger" : ""}`}>พลาด {item.failedEvents}</span>
            </div>
            {!item.configured && (
              <div style={{ marginTop: 14 }}>
                <p className="muted" style={{ marginBottom: 8 }}>ต้องตั้งค่า</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {item.missingEnv.map((name) => (
                    <code key={name} style={{ background: "var(--bg-muted)", padding: "4px 8px", borderRadius: 6 }}>
                      {name}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Integration Outbox</h3>
            <p className="muted">รายการงานล่าสุดที่ถูกสร้างจากออเดอร์และรอระบบจริงมาดึงไปส่ง</p>
          </div>
        </div>

        <div style={{ overflowX: "auto", padding: "0 24px 24px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 13 }}>
                <th style={{ padding: "10px 8px" }}>เวลา</th>
                <th style={{ padding: "10px 8px" }}>ระบบ</th>
                <th style={{ padding: "10px 8px" }}>เหตุการณ์</th>
                <th style={{ padding: "10px 8px" }}>สถานะ</th>
                <th style={{ padding: "10px 8px" }}>ครั้ง</th>
                <th style={{ padding: "10px 8px" }}>ข้อผิดพลาด</th>
                <th style={{ padding: "10px 8px" }} />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>{formatDateTime(event.createdAt)}</td>
                  <td style={{ padding: "12px 8px" }}>{providerLabel[event.provider]}</td>
                  <td style={{ padding: "12px 8px" }}>
                    <strong>{event.eventType}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {event.entityType} #{event.entityId ?? "-"}
                    </div>
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <span className={`badge ${getStatusClass(event.status)}`}>{event.status}</span>
                  </td>
                  <td style={{ padding: "12px 8px" }}>{event.attempts}</td>
                  <td style={{ padding: "12px 8px", maxWidth: 220 }}>
                    <span className="muted">{event.lastError || "-"}</span>
                  </td>
                  <td style={{ padding: "12px 8px", textAlign: "right" }}>
                    {event.status !== "SENT" && (
                      <button
                        className="btn btn--ghost"
                        onClick={() => handleRetry(event.id)}
                        disabled={retryingId === event.id}
                      >
                        {retryingId === event.id ? "กำลังส่ง..." : "Retry"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && events.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: "center" }} className="muted">
                    ยังไม่มีงานใน outbox
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
