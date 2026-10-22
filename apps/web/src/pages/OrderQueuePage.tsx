import { useCallback, useEffect, useState } from "react";
import { getOrders, updateOrderStatus } from "../api";
import { useBranch } from "../contexts/BranchContext";
import { useShift } from "../contexts/ShiftContext";
import { useToast } from "../contexts/ToastContext";
import type { Order } from "../types";
import { Ban, CheckCircle2 } from "lucide-react";
import { describeModifiers } from "../utils/modifierLabel";
import ConfirmReasonDialog from "../components/ui/ConfirmReasonDialog";

const LATE_AFTER_MINUTES = 15;

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function waitedMinutes(dateStr: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(dateStr).getTime()) / 60_000));
}

function formatWait(minutes: number) {
  if (minutes < 1) return "เพิ่งเข้า";
  if (minutes < 60) return `รอ ${minutes} นาที`;
  return `รอ ${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

export default function OrderQueuePage() {
  const { activeBranch } = useBranch();
  const { activeShift, refreshShift } = useShift();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!activeBranch || !activeShift) {
      setOrders([]);
      setLoading(false);
      return;
    }
    try {
      // filtered on the server: pulling every bill of the branch made the first load take ~12 s
      const data = await getOrders(activeBranch.id, undefined, { status: "PAID", shiftId: activeShift.id });
      // filter again: an API that predates these params (web deployed first) returns every bill
      setOrders(data.filter((o) => o.status === "PAID" && o.shiftId === activeShift.id).reverse());
      setNow(Date.now());
    } catch {
      // Keep the current queue visible if an auto-refresh request fails.
    } finally {
      setLoading(false);
    }
  }, [activeBranch, activeShift]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const markReady = async (order: Order) => {
    if (busyId !== null) return;
    setBusyId(order.id);
    try {
      await updateOrderStatus(order.id, "READY");
      toast.success(`บันทึกออเดอร์ #${order.id} เป็นเสร็จสิ้นแล้ว`);
      refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  // one request per bill at a time: a double click must not cancel twice
  const cancelOrder = async (order: Order, reason: string) => {
    if (busyId !== null) return;
    setBusyId(order.id);
    try {
      await updateOrderStatus(order.id, "CANCELLED", reason);
      toast.success(`ยกเลิกบิล #${order.id} แล้ว`);
      setCancelling(null);
      refresh();
      void refreshShift().catch(() => {});
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", margin: 0 }}>คิวออเดอร์</h1>
          <p className="muted">{activeBranch?.name} · กะปัจจุบัน{activeShift ? ` #${activeShift.id}` : ""} · อัปเดตอัตโนมัติทุก 5 วินาที</p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span className="badge badge--active" style={{ fontSize: "16px", padding: "8px 16px" }}>
            รอจัดเตรียม {loading ? "…" : orders.length} รายการ
          </span>
          <button className="btn btn--ghost" onClick={refresh}>รีเฟรช</button>
        </div>
      </div>

      {loading && <div className="empty" style={{ padding: "48px" }}>กำลังโหลด...</div>}

      {!loading && orders.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ fontSize: "64px", marginBottom: "16px" }}>✅</div>
          <h2 style={{ color: "var(--text-secondary)" }}>ไม่มีออเดอร์ค้าง</h2>
          <p className="muted">บิลใหม่ที่รอจัดเตรียมจะแสดงที่นี่อัตโนมัติ</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
        {orders.map((order) => {
          const waited = waitedMinutes(order.createdAt, now);
          const late = waited >= LATE_AFTER_MINUTES;
          return (
          <div key={order.id} className="panel" style={{ padding: "20px", borderLeft: `4px solid ${late ? "var(--danger)" : "var(--brand)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <strong style={{ fontSize: "22px" }}>#{order.id}</strong>
              <span style={{ textAlign: "right" }}>
                <span className="muted">{formatTime(order.createdAt)}</span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: late ? "var(--danger)" : "var(--text-muted)" }}>
                  {formatWait(waited)}{late ? " · ทำเสร็จแล้วกด เสร็จสิ้น" : ""}
                </span>
              </span>
            </div>

            <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
              {order.items.map((item) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "16px" }}>
                  <span>
                    <strong>{item.qty}x</strong> {item.name}
                    {describeModifiers(item.modifiers) && <span style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "var(--brand-hover)" }}>{describeModifiers(item.modifiers)}</span>}
                    {item.note && <span className="muted" style={{ display: "block", fontSize: "13px" }}>หมายเหตุ: {item.note}</span>}
                  </span>
                </div>
              ))}
            </div>

            {/* the destructive action is small and set apart so it is not hit instead of "done" */}
            <button
              className="btn btn--primary btn--full"
              style={{ padding: "14px", fontSize: "16px" }}
              onClick={() => markReady(order)}
              disabled={busyId !== null}
            >
              <CheckCircle2 size={18} /> เสร็จสิ้น
            </button>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                className="btn btn--ghost"
                style={{ padding: "6px 12px", fontSize: "13px", color: "var(--danger)" }}
                onClick={() => setCancelling(order)}
                disabled={busyId !== null}
              >
                <Ban size={14} /> ยกเลิกบิล…
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {cancelling && (
        <ConfirmReasonDialog
          title={`ยกเลิกบิล #${cancelling.id}`}
          detail={`${cancelling.items.map((item) => `${item.qty}x ${item.name}`).join(", ")}\nระบบจะคืนสต็อกและหักยอดขายของกะออกให้ · ยกเลิกแล้วย้อนกลับไม่ได้${cancelling.paymentMethod !== "CASH" ? "\nการยกเลิกใน POS ไม่โอนเงินคืนลูกค้าอัตโนมัติ ต้องตรวจและดำเนินการคืนเงินจริงแยกต่างหาก" : ""}`}
          confirmLabel="ยืนยันยกเลิกบิล"
          busy={busyId === cancelling.id}
          onConfirm={(reason) => cancelOrder(cancelling, reason)}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}
