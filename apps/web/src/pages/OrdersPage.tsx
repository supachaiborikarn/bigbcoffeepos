import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getOrders, updateOrderStatus, getStoreSetting } from "../api";
import { useAuth } from "../contexts/AuthContext";
import { describeModifiers } from "../utils/modifierLabel";
import { printReceipt } from "../components/ReceiptPrinter";
import { getPrinterMode } from "../utils/printerSettings";
import { useBranch } from "../contexts/BranchContext";
import { useShift } from "../contexts/ShiftContext";
import { useToast } from "../contexts/ToastContext";
import { useCart } from "../contexts/CartContext";
import type { Order, OrderStatus, PaymentMethod, StoreSetting } from "../types";
import { Ban, CheckCircle2, Clock, Printer, RefreshCw, RotateCcw, Search, ShoppingBag } from "lucide-react";
import ConfirmReasonDialog from "../components/ui/ConfirmReasonDialog";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  QR: "QR",
  CARD: "บัตร",
  EWALLET: "E-Wallet"
};

const STATUS_COLORS: Record<OrderStatus, { bg: string; color: string; label: string }> = {
  PAID: { bg: "#FFFBEB", color: "#B45309", label: "รอจัดเตรียม" },
  READY: { bg: "#ECFDF5", color: "#047857", label: "เสร็จสิ้น" },
  CANCELLED: { bg: "#FEF2F2", color: "#B91C1C", label: "ยกเลิกแล้ว" },
  REFUNDED: { bg: "#EFF6FF", color: "#1D4ED8", label: "คืนเงินแล้ว" }
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function isSameLocalDay(value: string, base = new Date()) {
  const date = new Date(value);
  return date.getFullYear() === base.getFullYear() &&
    date.getMonth() === base.getMonth() &&
    date.getDate() === base.getDate();
}

export default function OrdersPage() {
  const { activeBranch } = useBranch();
  const { activeShift, refreshShift } = useShift();
  const { user } = useAuth();
  const { cart, restoreOrderAsNewBill } = useCart();
  const navigate = useNavigate();
  const canRefund = user?.role === "admin" || user?.role === "manager";
  // one action at a time: a double click must not cancel/refund twice
  const [busyId, setBusyId] = useState<number | null>(null);
  const guarded = (fn: (order: Order) => Promise<void>) => async (order: Order) => {
    if (busyId !== null) return;
    setBusyId(order.id);
    try { await fn(order); } finally { setBusyId(null); }
  };
  // cancel/refund wait here for a written reason before anything is sent
  const [pending, setPending] = useState<{ kind: "cancel" | "refund" | "refund-reopen"; order: Order } | null>(null);
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<"ALL" | OrderStatus>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!activeBranch) return;
    setLoading(true);
    try {
      // the page shows the current shift / today; recent bills are plenty
      setOrders(await getOrders(activeBranch.id, 300));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [activeBranch?.id]);

  async function reprint(order: Order) {
    // Open the print window inside the click gesture so it never blocks the page.
    // In the native wrapper the Star SDK prints directly, so skip the blank window.
    const win = (getPrinterMode() === "browser" && typeof window !== "undefined")
      ? window.open("", "bbpos_receipt", "width=380,height=640")
      : null;
    let storeSetting: StoreSetting | null = null;
    try { storeSetting = await getStoreSetting(order.branchId); } catch { /* fall back to defaults */ }
    const isOil = activeBranch?.branchType === "oil_service";
    const cart = order.items.map((it) => ({
      id: String(it.id),
      menuItemId: it.menuItemId,
      name: it.name,
      category: "",
      basePrice: it.basePrice,
      qty: it.qty,
      modifiers: it.modifiers ?? [],
      note: it.note
    }));
    try {
    const printed = printReceipt({
      order,
      cart,
      discountRules: [],
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      total: order.total,
      pointsUsed: order.loyaltyPointsUsed,
      paymentMethod: order.paymentMethod,
      cashReceived: order.cashReceived ?? undefined,
      changeAmount: order.changeAmount ?? undefined,
      storeSetting,
      copies: isOil ? 3 : 1,
      copyLabels: isOil
        ? ["สำเนา · สำหรับสำนักงาน", "สำเนา · สำหรับร้าน (เก็บที่บ่อ)", "สำเนา · สำหรับลูกค้า"]
        : ["สำเนาใบเสร็จ"]
    }, activeBranch?.name || "Big B Coffee", win);
    if (!printed) {
      win?.close();
      toast.error("เปิดใบเสร็จไม่ได้ กรุณาตรวจการตั้งค่าเครื่องพิมพ์");
    }
    } catch (error) {
      win?.close();
      toast.error((error as Error).message || "เปิดใบเสร็จไม่สำเร็จ บิลยังบันทึกอยู่");
    }
  }

  const operationalOrders = useMemo(() => {
    if (activeShift) return orders.filter((order) => order.shiftId === activeShift.id);
    return orders.filter((order) => isSameLocalDay(order.createdAt));
  }, [orders, activeShift]);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return operationalOrders.filter((order) => {
      if (activeTab !== "ALL" && order.status !== activeTab) return false;
      if (!query) return true;
      return (
        String(order.id).includes(query) ||
        order.paymentMethod.toLowerCase().includes(query) ||
        order.items.some((item) => item.name.toLowerCase().includes(query))
      );
    });
  }, [operationalOrders, activeTab, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<OrderStatus, number> = { PAID: 0, READY: 0, CANCELLED: 0, REFUNDED: 0 };
    operationalOrders.forEach((order) => {
      counts[order.status] = (counts[order.status] ?? 0) + 1;
    });
    return counts;
  }, [operationalOrders]);

  const setReady = async (order: Order) => {
    try {
      await updateOrderStatus(order.id, "READY");
      toast.success(`บันทึกออเดอร์ #${order.id} เป็นเสร็จสิ้นแล้ว`);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const cancelOrder = async (order: Order, reason: string) => {
    try {
      await updateOrderStatus(order.id, "CANCELLED", reason);
      toast.success(`ยกเลิกบิล #${order.id} แล้ว`);
      await refresh();
      void refreshShift().catch(() => {});
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const reopenOrder = async (order: Order) => {
    if (await restoreOrderAsNewBill(order)) {
      navigate("/pos");
    }
  };

  const askRefund = (order: Order, reopen: boolean) => {
    if (reopen && cart.length > 0) {
      toast.error("มีสินค้าในบิลปัจจุบัน กรุณาพักบิลหรือล้างตะกร้าก่อนเปิดบิลคืนเงินมาแก้");
      return;
    }
    setPending({ kind: reopen ? "refund-reopen" : "refund", order });
  };

  const refundOrder = async (order: Order, reason: string, reopen = false) => {
    try {
      const refunded = await updateOrderStatus(order.id, "REFUNDED", reason.trim());
      toast.success(`คืนเงินบิล #${order.id} แล้ว · อย่าลืมจ่ายเงินคืนลูกค้า ${formatMoney(order.total)}`);
      await refresh();
      void refreshShift().catch(() => {});
      if (reopen) await reopenOrder(refunded);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <main className="container" style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto", height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="orders-heading">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", gap: 12 }}>
            <ShoppingBag size={28} style={{ color: "var(--brand)" }} /> ศูนย์รวมออเดอร์
          </h1>
          <p className="muted" style={{ marginTop: 8 }}>
            {activeBranch?.name} · {activeShift ? `กะปัจจุบัน #${activeShift.id}` : "รายการของวันนี้"} · ติดตามบิลที่รอจัดเตรียม เสร็จสิ้น ยกเลิก และคืนเงิน
          </p>
        </div>
        <div className="orders-tools">
          <div style={{ position: "relative" }}>
            <Search size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              className="input"
              placeholder="ค้นหาเลขออเดอร์ / สินค้า"
              aria-label="ค้นหาเลขออเดอร์หรือสินค้า"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 40, width: 260, borderRadius: 12 }}
            />
          </div>
          <button className="btn btn--ghost" style={{ borderRadius: 12 }} onClick={refresh} disabled={loading}>
            <RefreshCw size={18} /> รีเฟรช
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
            {status === "ALL" ? `ทั้งหมด (${operationalOrders.length})` : `${STATUS_COLORS[status].label} (${statusCounts[status] ?? 0})`}
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
              }} data-testid={`order-card-${order.id}`}>
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
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
                      <span>{item.qty}x {item.name}
                        {describeModifiers(item.modifiers) && <small style={{ display: "block", color: "var(--text-muted)", fontSize: 12 }}>{describeModifiers(item.modifiers)}</small>}
                        {item.note && <small style={{ display: "block", color: "var(--brand)", fontSize: 12 }}>หมายเหตุ: {item.note}</small>}
                      </span>
                      <strong>{formatMoney(item.lineTotal)}</strong>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{formatMoney(order.total)}</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn btn--ghost" style={{ padding: "8px 14px", borderRadius: 8 }} onClick={() => reprint(order)}>
                      <Printer size={16} /> พิมพ์ซ้ำ
                    </button>
                    {order.status === "PAID" && (
                      <button className="btn btn--primary" style={{ padding: "8px 14px", borderRadius: 8 }} onClick={() => guarded(setReady)(order)} disabled={busyId !== null}>
                        <CheckCircle2 size={16} /> เสร็จสิ้น
                      </button>
                    )}
                    {canRefund && (order.status === "PAID" || order.status === "READY") && (
                      <>
                      <button className="btn btn--ghost" style={{ padding: "8px 14px", borderRadius: 8 }} onClick={() => askRefund(order, false)} disabled={busyId !== null}>
                        <RotateCcw size={16} /> คืนเงิน
                      </button>
                      <button className="btn btn--ghost" style={{ padding: "8px 14px", borderRadius: 8 }} onClick={() => askRefund(order, true)} disabled={busyId !== null}>
                        <RotateCcw size={16} /> คืนเงินและแก้บิล
                      </button>
                      </>
                    )}
                    {canRefund && order.status === "REFUNDED" && (
                      <button className="btn btn--ghost" style={{ padding: "8px 14px", borderRadius: 8 }} onClick={() => guarded(reopenOrder)(order)} disabled={busyId !== null} title="นำสินค้าและตัวเลือกมาใส่บิลใหม่ บิลเดิมยังคงคืนเงินแล้ว">
                        <RotateCcw size={16} /> เปิดเป็นบิลใหม่
                      </button>
                    )}
                    {order.status !== "CANCELLED" && order.status !== "REFUNDED" && (
                      <button className="btn btn--danger" style={{ padding: "8px 14px", borderRadius: 8 }} onClick={() => setPending({ kind: "cancel", order })} disabled={busyId !== null} data-testid={`cancel-order-${order.id}`}>
                        <Ban size={16} /> ยกเลิกบิล
                      </button>
                    )}
                  </div>
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

      {pending && (
        <ConfirmReasonDialog
          title={pending.kind === "cancel" ? `ยกเลิกบิล #${pending.order.id}` : `คืนเงินบิล #${pending.order.id}`}
          detail={pending.kind === "cancel"
            ? `ยอด ${formatMoney(pending.order.total)}\nระบบจะคืนสต็อกและหักยอดขายของกะออกให้ · ยกเลิกแล้วย้อนกลับไม่ได้${pending.order.paymentMethod !== "CASH" ? "\nการยกเลิกใน POS ไม่โอนเงินคืนลูกค้าอัตโนมัติ ต้องตรวจและดำเนินการคืนเงินจริงแยกต่างหาก" : ""}`
            : `ยอด ${formatMoney(pending.order.total)} (${PAYMENT_LABELS[pending.order.paymentMethod]})\nระบบจะคืนสต็อก หักยอดขายของกะ และย้ายบิลไปแท็บ "คืนเงินแล้ว"${pending.kind === "refund-reopen" ? "\nจากนั้นเปิดรายการเดิมเป็นบิลใหม่ให้แก้" : ""}`}
          confirmLabel={pending.kind === "cancel" ? "ยืนยันยกเลิกบิล" : `ยืนยันคืนเงิน ${formatMoney(pending.order.total)}`}
          busy={busyId === pending.order.id}
          onConfirm={(reason) => {
            const { kind, order } = pending;
            void guarded(async (item) => {
              if (kind === "cancel") await cancelOrder(item, reason);
              else await refundOrder(item, reason, kind === "refund-reopen");
              setPending(null);
            })(order);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </main>
  );
}
