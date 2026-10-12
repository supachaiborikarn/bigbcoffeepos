import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CloudOff, RefreshCw, Wifi } from "lucide-react";
import {
  discardFailedOfflineOrders,
  flushOfflineOrders,
  getOfflineFailedCount,
  getOfflineFailedDetails,
  getOfflinePendingCount,
  getOfflinePendingDetails,
  retryFailedOfflineOrders
} from "../api";
import { useToast } from "../contexts/ToastContext";

function similarPendingBillCount() {
  const groups = new Map<string, Set<string>>();
  for (const item of getOfflinePendingDetails()) {
    if (!item.idempotencyKey) continue;
    const signature = JSON.stringify({
      branchId: item.branchId,
      paymentMethod: item.paymentMethod,
      customerId: item.customerId,
      discountType: item.discountType,
      discountValue: item.discountValue,
      discounts: item.discounts,
      couponCode: item.couponCode,
      loyaltyPointsToUse: item.loyaltyPointsToUse,
      items: item.items.map((line) => JSON.stringify({ menuItemId: line.menuItemId, productUnitId: line.productUnitId, qty: line.qty, modifiers: line.modifiers, note: line.note })).sort()
    });
    const keys = groups.get(signature) || new Set<string>();
    keys.add(item.idempotencyKey);
    groups.set(signature, keys);
  }
  return Array.from(groups.values()).reduce((count, keys) => count + (keys.size > 1 ? keys.size : 0), 0);
}

export default function OfflineStatus() {
  const toast = useToast();
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState<number>(getOfflinePendingCount());
  const [failed, setFailed] = useState<number>(getOfflineFailedCount());
  const [syncing, setSyncing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

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
      if (result.remaining > 0) toast.error(`ยังส่งบิลไม่ได้ ${result.remaining} บิล ข้อมูลยังเก็บไว้ในเครื่อง กดดูรายละเอียดแล้วลองส่งใหม่ได้`);
      if (result.failed > 0) toast.error(`มีบิลที่เซิร์ฟเวอร์ปฏิเสธ ${result.failed} บิล กดดูรายละเอียดได้`);
    } catch (error) {
      refresh();
      toast.error((error as Error).message || "ส่งบิลไม่สำเร็จ ข้อมูลยังเก็บไว้ในเครื่อง");
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
      if (result.remaining > 0) toast.error(`ยังส่งบิลไม่ได้ ${result.remaining} บิล ข้อมูลยังเก็บไว้ในเครื่อง`);
      if (result.failed > 0) toast.error(`ยังมีบิลที่ปฏิเสธ ${result.failed} บิล — ตรวจสต็อก/กะแล้วลองใหม่`);
    } catch (error) {
      refresh();
      toast.error((error as Error).message || "ส่งบิลไม่สำเร็จ ข้อมูลยังเก็บไว้ในเครื่อง");
    } finally {
      setSyncing(false);
    }
  }, [syncing, refresh, toast]);

  const handleDiscard = useCallback(() => {
    discardFailedOfflineOrders();
    refresh();
    setShowDetails(false);
    toast.success("ล้างรายการบิลที่ล้มเหลวแล้ว");
  }, [refresh, toast]);

  // Nothing to show when fully online and nothing queued/failed.
  if (online && pending === 0 && failed === 0) return null;

  const danger = !online;
  const similarBills = similarPendingBillCount();
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
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

      {showDetails && (pending > 0 || failed > 0) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 320,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 12,
            zIndex: 1000
          }}
        >
          {pending > 0 && <>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>บิลรอส่ง {pending} บิล</div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>ข้อมูลบิลยังเก็บไว้ในเครื่อง กรุณาส่งบิลเดิมเพื่อตรวจยอดก่อนขายซ้ำ</p>
            {similarBills > 1 && <p style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>มีบิลที่มีสินค้าและวิธีชำระเหมือนกัน {similarBills} บิล กรุณาตรวจสอบจำนวนครั้งที่ขายจริงก่อนส่ง</p>}
            {getOfflinePendingDetails().slice(0, 10).map((item, index) => (
              <div key={item.offlineQueueId || item.idempotencyKey || index} style={{ borderTop: "1px solid var(--border-light)", padding: "8px 0", fontSize: 12 }}>
                <strong>บิล {index + 1} · รวมราคาสินค้า {new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(item.items.reduce((sum, line) => sum + (line.basePrice + line.modifiers.reduce((total, mod) => total + mod.price, 0)) * line.qty, 0))}</strong>
                <div>{item.items.map((line) => `${line.name} × ${line.qty}`).join(" · ")}</div>
                {item.queuedAt && <div style={{ color: "var(--text-muted)" }}>{new Date(item.queuedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</div>}
                {item.lastSyncError && <div style={{ color: "#b91c1c", marginTop: 4 }}>{item.lastSyncError}</div>}
              </div>
            ))}
            <button className="btn btn--primary" style={{ width: "100%", fontSize: 12, marginTop: 8, marginBottom: 12 }} onClick={handleSync} disabled={syncing || !online}>
              <RefreshCw size={14} className={syncing ? "spin" : undefined} /> {syncing ? "กำลังส่งบิล..." : "ส่งบิลที่ค้าง"}
            </button>
          </>}
          {failed > 0 && <>
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
          </>}
        </div>
      )}
    </div>
  );
}
