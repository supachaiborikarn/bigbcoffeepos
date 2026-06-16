import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudOff, RefreshCw, Wifi } from "lucide-react";
import {
  discardFailedOfflineOrders,
  flushOfflineOrders,
  getOfflineFailedCount,
  getOfflineFailedDetails,
  getOfflinePendingCount,
  retryFailedOfflineOrders
} from "../api";
import { useToast } from "../contexts/ToastContext";

export default function OfflineStatus() {
  const toast = useToast();
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState<number>(getOfflinePendingCount());
  const [failed, setFailed] = useState<number>(getOfflineFailedCount());
  const [syncing, setSyncing] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  const refresh = useCallback(() => {
    setPending(getOfflinePendingCount());
    setFailed(getOfflineFailedCount());
  }, []);

  useEffect(() => {
    const onOnline = () => { setOnline(true); refresh(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = window.setInterval(refresh, 5_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await flushOfflineOrders();
      refresh();
      if (result.sent > 0) toast.success(`ส่งบิลออฟไลน์สำเร็จ ${result.sent} บิล`);
      if (result.failed > 0) toast.error(`มีบิลที่เซิร์ฟเวอร์ปฏิเสธ ${result.failed} บิล กดดูรายละเอียดได้`);
    } catch {
      // ignore — will retry automatically
    } finally {
      setSyncing(false);
    }
  }, [syncing, refresh, toast]);

  const handleRetryFailed = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await retryFailedOfflineOrders();
      refresh();
      if (result.sent > 0) toast.success(`ส่งบิลที่ค้างสำเร็จ ${result.sent} บิล`);
      if (result.failed > 0) toast.error(`ยังมีบิลที่ปฏิเสธ ${result.failed} บิล — ตรวจสต็อก/กะแล้วลองใหม่`);
    } finally {
      setSyncing(false);
      setShowFailed(false);
    }
  }, [syncing, refresh, toast]);

  const handleDiscard = useCallback(() => {
    discardFailedOfflineOrders();
    refresh();
    setShowFailed(false);
    toast.success("ล้างรายการบิลที่ล้มเหลวแล้ว");
  }, [refresh, toast]);

  // Nothing to show when fully online and nothing queued/failed.
  if (online && pending === 0 && failed === 0) return null;

  const danger = !online;
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => (failed > 0 ? setShowFailed((v) => !v) : handleSync())}
        title={online ? "มีบิลรอ sync — กดเพื่อจัดการ" : "กำลังออฟไลน์ — บิลจะถูกเก็บไว้และ sync อัตโนมัติเมื่อเน็ตกลับมา"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 999,
          border: `1px solid ${failed > 0 ? "#fca5a5" : danger ? "#fca5a5" : "#fcd34d"}`,
          background: failed > 0 ? "#fef2f2" : danger ? "#fef2f2" : "#fffbeb",
          color: failed > 0 ? "#b91c1c" : danger ? "#b91c1c" : "#92400e",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer"
        }}
      >
        {danger ? <CloudOff size={14} /> : <Wifi size={14} />}
        <span>{danger ? "ออฟไลน์" : "ออนไลน์"}</span>
        {pending > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            · รอ sync {pending}
            <RefreshCw size={12} className={syncing ? "spin" : undefined} />
          </span>
        )}
        {failed > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <AlertTriangle size={12} /> ล้มเหลว {failed}
          </span>
        )}
      </button>

      {showFailed && failed > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 320,
            maxHeight: 360,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 12,
            zIndex: 1000
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>บิลออฟไลน์ที่เซิร์ฟเวอร์ปฏิเสธ</div>
          {getOfflineFailedDetails().slice(0, 10).map((item, index) => (
            <div key={index} style={{ borderTop: "1px solid var(--border-light)", padding: "8px 0", fontSize: 12 }}>
              <div style={{ color: "#b91c1c" }}>{item.error}</div>
              <div style={{ color: "var(--muted)" }}>
                {item.input.items.reduce((s, it) => s + it.qty, 0)} ชิ้น · {new Date(item.failedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn--primary" style={{ flex: 1, fontSize: 12 }} onClick={handleRetryFailed} disabled={syncing}>
              ลองส่งใหม่
            </button>
            <button className="btn btn--ghost" style={{ flex: 1, fontSize: 12, color: "var(--danger)" }} onClick={handleDiscard} disabled={syncing}>
              ล้างทิ้ง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
