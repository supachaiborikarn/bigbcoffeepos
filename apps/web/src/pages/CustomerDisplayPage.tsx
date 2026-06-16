import { useEffect, useState } from "react";
import { getCustomerDisplay } from "../api";
import { useBranch } from "../contexts/BranchContext";

const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });

export default function CustomerDisplayPage() {
  const { activeBranch } = useBranch();
  const [display, setDisplay] = useState<{ orderId: number; total: number; status: string; items: Array<{ name: string; qty: number; lineTotal: number }> } | null>(null);

  useEffect(() => {
    if (!activeBranch?.id) return;
    const load = () => getCustomerDisplay(activeBranch.id).then(setDisplay).catch(() => setDisplay(null));
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [activeBranch?.id]);

  return (
    <main style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 32, background: "#111827", color: "#fff" }}>
      <section style={{ width: "min(760px, 100%)", display: "grid", gap: 24, textAlign: "center" }}>
        <div>
          <h1 style={{ fontSize: 42, margin: 0 }}>{activeBranch?.name ?? "Big B Coffee"}</h1>
          <p style={{ opacity: 0.72 }}>จอแสดงผลลูกค้า</p>
        </div>
        {display ? (
          <>
            <div style={{ fontSize: 24 }}>บิล #{display.orderId}</div>
            <div style={{ fontSize: 72, fontWeight: 800 }}>{money.format(display.total)}</div>
            <div style={{ display: "grid", gap: 10 }}>
              {display.items.map((item, index) => (
                <div key={index} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.18)", paddingBottom: 8 }}>
                  <span>{item.name} x {item.qty}</span>
                  <span>{money.format(item.lineTotal)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 36, opacity: 0.72 }}>ยังไม่มีบิลล่าสุด</div>
        )}
      </section>
    </main>
  );
}
