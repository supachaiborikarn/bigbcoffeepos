import { useState, useEffect } from "react";
import { getShifts } from "../api";
import { useBranch } from "../contexts/BranchContext";
import { ShoppingBag, Search, Clock, CheckCircle, ExternalLink, Filter } from "lucide-react";

type OrderStatus = "PENDING" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";
type OrderSource = "WALK_IN" | "GRAB" | "LINEMAN" | "FOODPANDA" | "PRE_ORDER";

// Mock Data
const MOCK_ORDERS = [
  { id: "ORD-001", source: "GRAB" as OrderSource, status: "PENDING" as OrderStatus, customerName: "Grab #A4B2", items: ["Iced Latte (L)", "Croissant"], total: 185, time: new Date(Date.now() - 2 * 60000).toISOString() },
  { id: "ORD-002", source: "WALK_IN" as OrderSource, status: "PREPARING" as OrderStatus, customerName: "คุณสมชาย", items: ["Hot Americano"], total: 65, time: new Date(Date.now() - 5 * 60000).toISOString() },
  { id: "ORD-003", source: "LINEMAN" as OrderSource, status: "READY" as OrderStatus, customerName: "LineMan #998", items: ["Matcha Frappe", "Chocolate Cake"], total: 220, time: new Date(Date.now() - 15 * 60000).toISOString() },
  { id: "ORD-004", source: "PRE_ORDER" as OrderSource, status: "PENDING" as OrderStatus, customerName: "คุณกิ๊บ (รับ 14:00)", items: ["Iced Caramel Macchiato x2"], total: 180, time: new Date(Date.now() - 30 * 60000).toISOString() },
];

const SOURCE_COLORS = {
  WALK_IN: { bg: "var(--bg-muted)", color: "var(--text-primary)", label: "หน้าร้าน" },
  GRAB: { bg: "#ECFDF5", color: "#059669", label: "Grab" },
  LINEMAN: { bg: "#ECFCCB", color: "#4D7C0F", label: "Line Man" },
  FOODPANDA: { bg: "#FCE7F3", color: "#BE185D", label: "Foodpanda" },
  PRE_ORDER: { bg: "#EFF6FF", color: "#1D4ED8", label: "สั่งล่วงหน้า" },
};

const STATUS_COLORS = {
  PENDING: { bg: "#FFFBEB", color: "#B45309", label: "รอรับออเดอร์" },
  PREPARING: { bg: "#EFF6FF", color: "#1D4ED8", label: "กำลังเตรียม" },
  READY: { bg: "#ECFDF5", color: "#047857", label: "พร้อมรับ" },
  COMPLETED: { bg: "var(--bg-muted)", color: "var(--text-muted)", label: "เสร็จสิ้น" },
  CANCELLED: { bg: "#FEF2F2", color: "#B91C1C", label: "ยกเลิก" },
};

export default function OrdersPage() {
  const { activeBranch } = useBranch();
  const [activeTab, setActiveTab] = useState<"ALL" | OrderSource>("ALL");
  const [search, setSearch] = useState("");

  const filteredOrders = MOCK_ORDERS.filter(o => 
    (activeTab === "ALL" || o.source === activeTab) &&
    (o.id.toLowerCase().includes(search.toLowerCase()) || o.customerName.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <main className="container" style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column" }}>
      
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", gap: 12 }}>
            <ShoppingBag size={28} style={{ color: "var(--brand)" }} /> ศูนย์รวมออเดอร์ (Order Center)
          </h1>
          <p className="muted" style={{ marginTop: 8 }}>{activeBranch?.name} · จัดการออเดอร์หน้าร้านและเดลิเวอรี่</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <Search size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input 
              className="input" 
              placeholder="ค้นหาเลขออเดอร์..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 40, width: 250, borderRadius: 12 }} 
            />
          </div>
          <button className="btn btn--ghost" style={{ borderRadius: 12 }}>
            <Filter size={18} /> กรอง
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, overflowX: "auto", paddingBottom: 4 }}>
        <button 
          className={`btn ${activeTab === "ALL" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setActiveTab("ALL")}
          style={{ borderRadius: 20 }}
        >
          ทั้งหมด ({MOCK_ORDERS.length})
        </button>
        {Object.entries(SOURCE_COLORS).map(([key, config]) => (
          <button 
            key={key}
            className={`btn ${activeTab === key ? "btn--primary" : "btn--ghost"}`}
            onClick={() => setActiveTab(key as OrderSource)}
            style={{ borderRadius: 20 }}
          >
            {config.label}
          </button>
        ))}
      </div>

      {/* Orders Grid */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filteredOrders.map(order => {
            const sourceInfo = SOURCE_COLORS[order.source];
            const statusInfo = STATUS_COLORS[order.status];
            
            return (
              <div key={order.id} style={{ 
                background: "var(--bg-surface)", borderRadius: 16, padding: 20, 
                border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)",
                display: "flex", flexDirection: "column", gap: 16
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span style={{ 
                      background: sourceInfo.bg, color: sourceInfo.color, padding: "4px 8px", 
                      borderRadius: 8, fontSize: 12, fontWeight: 600 
                    }}>
                      {sourceInfo.label}
                    </span>
                    <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>{order.id}</h3>
                  </div>
                  <span style={{ 
                    background: statusInfo.bg, color: statusInfo.color, padding: "4px 8px", 
                    borderRadius: 8, fontSize: 12, fontWeight: 600 
                  }}>
                    {statusInfo.label}
                  </span>
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", marginBottom: 8, fontSize: 14 }}>
                    <UserIcon /> <span style={{ fontWeight: 500 }}>{order.customerName}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13 }}>
                    <Clock size={14} /> {new Date(order.time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>

                <div style={{ background: "var(--bg-subtle)", padding: 12, borderRadius: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {order.items.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                      <span>1x {item}</span>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: "1px dashed var(--border)", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 16 }}>฿{order.total}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    {order.status === "PENDING" && (
                      <button className="btn btn--primary" style={{ padding: "8px 16px", borderRadius: 8 }}>รับออเดอร์</button>
                    )}
                    {order.status === "PREPARING" && (
                      <button className="btn" style={{ background: "var(--success)", color: "white", padding: "8px 16px", borderRadius: 8 }}>พร้อมส่ง</button>
                    )}
                    {order.status === "READY" && (
                      <button className="btn btn--ghost" style={{ padding: "8px 16px", borderRadius: 8 }}>ปิดออเดอร์</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {filteredOrders.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
            <ShoppingBag size={48} style={{ opacity: 0.2, margin: "0 auto 16px" }} />
            <p>ไม่พบออเดอร์ในหมวดหมู่นี้</p>
          </div>
        )}
      </div>
    </main>
  );
}

// Simple internal icon since we didn't import User
function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  );
}
