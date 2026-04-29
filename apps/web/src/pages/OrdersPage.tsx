import { useEffect, useMemo, useState } from "react";
import { getOrders, updateOrderStatus } from "../api";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";
import type { Order, OrderStatus, PaymentMethod } from "../types";
import { ShoppingBag, Search, Clock, Filter } from "lucide-react";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  QR: "QR",
  CARD: "บัตร",
  EWALLET: "E-Wallet"
};

const STATUS_COLORS: Record<OrderStatus, { bg: string; color: string; label: string }> = {
  PAID: { bg: "#FFFBEB", color: "#B45309", label: "ชำระแล้ว" },
  READY: { bg: "#ECFDF5", color: "#047857", label: "พร้อมรับ" },
  CANCELLED: { bg: "#FEF2F2", color: "#B91C1C", label: "ยกเลิก" },
  REFUNDED: { bg: "#EFF6FF", color: "#1D4ED8", label: "คืนเงิน" }
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value);
}

export default function OrdersPage() {
  const { activeBranch } = useBranch();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<"ALL" | OrderStatus>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!activeBranch) return;
    setLoading(true);
    try {
      setOrders(await getOrders(activeBranch.id));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [activeBranch?.id]);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (activeTab !== "ALL" && order.status !== activeTab) return false;
      if (!query) return true;
      return (
        String(order.id).includes(query) ||
        order.paymentMethod.toLowerCase().includes(query) ||
        order.items.some((item) => item.name.toLowerCase().includes(query))
      );
    });
  }, [orders, activeTab, search]);

  const setReady = async (order: Order) => {
    try {
      await updateOrderStatus(order.id, "READY");
      toast.success(`ออเดอร์ #${order.id} พร้อมรับแล้ว`);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <main className="container" style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", gap: 12 }}>
            <ShoppingBag size={28} style={{ color: "var(--brand)" }} /> ศูนย์รวมออเดอร์
          </h1>
          <p className="muted" style={{ marginTop: 8 }}>{activeBranch?.name} · ออเดอร์จริงจากระบบขาย</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <Search size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              className="input"
              placeholder="ค้นหาเลขออเดอร์ / สินค้า"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 40, width: 260, borderRadius: 12 }}
            />
          </div>
          <button className="btn btn--ghost" style={{ borderRadius: 12 }} onClick={refresh}>
            <Filter size={18} /> รีเฟรช
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24, overflowX: "auto", paddingBottom: 4 }}>
        {(["ALL", "PAID", "READY", "CANCELLED", "REFUNDED"] as Array<"ALL" | OrderStatus>).map((status) => (
          <button
            key={status}
            className={`btn ${activeTab === status ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setActiveTab(status)}
            style={{ borderRadius: 20 }}
          >
            {status === "ALL" ? `ทั้งหมด (${orders.length})` : STATUS_COLORS[status].label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filteredOrders.map((order) => {
            const statusInfo = STATUS_COLORS[order.status] ?? STATUS_COLORS.PAID;
            return (
              <div key={order.id} style={{
                background: "var(--bg-surface)", borderRadius: 16, padding: 20,
                border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)",
                display: "flex", flexDirection: "column", gap: 16
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span style={{ background: "var(--bg-muted)", color: "var(--text-primary)", padding: "4px 8px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                      {PAYMENT_LABELS[order.paymentMethod]}
                    </span>
                    <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>#{order.id}</h3>
                  </div>
                  <span style={{ background: statusInfo.bg, color: statusInfo.color, padding: "4px 8px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                    {statusInfo.label}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13 }}>
                  <Clock size={14} /> {new Date(order.createdAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                </div>

                <div style={{ background: "var(--bg-subtle)", padding: 12, borderRadius: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {order.items.map((item) => (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                      <span>{item.qty}x {item.name}</span>
                      <strong>{formatMoney(item.lineTotal)}</strong>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{formatMoney(order.total)}</span>
                  {order.status === "PAID" && (
                    <button className="btn btn--primary" style={{ padding: "8px 16px", borderRadius: 8 }} onClick={() => setReady(order)}>
                      พร้อมรับ
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!loading && filteredOrders.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
            <ShoppingBag size={48} style={{ opacity: 0.2, margin: "0 auto 16px" }} />
            <p>ไม่พบออเดอร์</p>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
            กำลังโหลดออเดอร์...
          </div>
        )}
      </div>
    </main>
  );
}
