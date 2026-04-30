import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../api";
import { useBranch } from "../contexts/BranchContext";
import { useShift } from "../contexts/ShiftContext";
import { useToast } from "../contexts/ToastContext";
import type { Order } from "../types";
import { Ban, CheckCircle2 } from "lucide-react";

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const token = localStorage.getItem("bb_pos_token");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...init, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "Request failed";
    throw new Error(message);
  }
  return payload as T;
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export default function OrderQueuePage() {
  const { activeBranch } = useBranch();
  const { activeShift, refreshShift } = useShift();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeBranch || !activeShift) {
      setOrders([]);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchJson<{ items: Order[] }>(`${API_URL}/orders?branchId=${activeBranch.id}`);
      const pending = (data.items || []).filter(o => o.status === "PAID" && o.shiftId === activeShift.id).reverse();
      setOrders(pending);
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
    try {
      await fetchJson(`${API_URL}/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "READY" })
      });
      toast.success(`บันทึกออเดอร์ #${order.id} เป็นเสร็จสิ้นแล้ว`);
      refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const cancelOrder = async (order: Order) => {
    if (!window.confirm(`ยืนยันยกเลิกบิล #${order.id}?\nระบบจะคืนสต็อกและหักยอดขายของกะออกให้`)) return;
    try {
      await fetchJson(`${API_URL}/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "CANCELLED" })
      });
      toast.success(`ยกเลิกบิล #${order.id} แล้ว`);
      refresh();
      void refreshShift().catch(() => {});
    } catch (error) {
      toast.error((error as Error).message);
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
            รอจัดเตรียม {orders.length} รายการ
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
        {orders.map((order) => (
          <div key={order.id} className="panel" style={{ padding: "20px", borderLeft: "4px solid var(--brand)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <strong style={{ fontSize: "22px" }}>#{order.id}</strong>
              <span className="muted">{formatTime(order.createdAt)}</span>
            </div>

            <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
              {order.items.map((item) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "16px" }}>
                  <span>
                    <strong>{item.qty}x</strong> {item.name}
                    {item.note && <span className="muted" style={{ fontSize: "13px" }}> — {item.note}</span>}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                className="btn btn--primary btn--full"
                style={{ padding: "14px", fontSize: "16px" }}
                onClick={() => markReady(order)}
              >
                <CheckCircle2 size={18} /> เสร็จสิ้น
              </button>
              <button
                className="btn btn--danger btn--full"
                style={{ padding: "14px", fontSize: "16px" }}
                onClick={() => cancelOrder(order)}
              >
                <Ban size={18} /> ยกเลิกบิล
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
