import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../api";
import { useBranch } from "../contexts/BranchContext";
import type { Order } from "../types";

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const token = localStorage.getItem("bb_pos_token");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...init, headers });
  return res.json();
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export default function OrderQueuePage() {
  const { activeBranch } = useBranch();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeBranch) return;
    try {
      const data = await fetchJson<{ items: Order[] }>(`${API_URL}/orders?branchId=${activeBranch.id}`);
      // Show only PAID (pending) orders, newest first
      const pending = (data.items || []).filter(o => o.status === "PAID").reverse();
      setOrders(pending);
    } catch {}
    setLoading(false);
  }, [activeBranch]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const markReady = async (orderId: number) => {
    await fetchJson(`${API_URL}/orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "READY" })
    });
    refresh();
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #f5f0eb)", padding: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "28px", margin: 0 }}>🍳 คิวออเดอร์</h1>
          <p className="muted">{activeBranch?.name} · อัปเดตอัตโนมัติทุก 5 วินาที</p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span className="badge badge--active" style={{ fontSize: "16px", padding: "8px 16px" }}>
            รอทำ {orders.length} รายการ
          </span>
          <button className="btn btn--ghost" onClick={refresh}>รีเฟรช</button>
        </div>
      </div>

      {loading && <div className="empty" style={{ padding: "48px" }}>กำลังโหลด...</div>}

      {!loading && orders.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ fontSize: "64px", marginBottom: "16px" }}>✅</div>
          <h2 style={{ color: "var(--ink-secondary)" }}>ไม่มีออเดอร์ค้าง</h2>
          <p className="muted">ออเดอร์ใหม่จะแสดงที่นี่อัตโนมัติ</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
        {orders.map((order) => (
          <div key={order.id} className="panel" style={{ padding: "20px", borderLeft: "4px solid var(--accent, #b5482b)" }}>
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

            <button
              className="btn btn--primary btn--full"
              style={{ padding: "14px", fontSize: "16px" }}
              onClick={() => markReady(order.id)}
            >
              ✅ เสร็จแล้ว
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
