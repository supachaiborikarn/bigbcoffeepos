import { useState } from "react";
import { syncPosposMigration } from "../api";
import { useToast } from "../contexts/ToastContext";
import { useBranch } from "../contexts/BranchContext";

export default function MigrationPage() {
  const toast = useToast();
  const { activeBranch } = useBranch();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);

  const handleAutoSync = async () => {
    if (!activeBranch) {
      toast.error("กรุณาเลือกสาขาก่อน");
      return;
    }
    setIsSyncing(true);
    setSyncLogs([]);
    try {
      setSyncLogs(["เริ่มการเชื่อมต่อกับ POSPOS..."]);
      const data = await syncPosposMigration(activeBranch.id);
      
      setSyncLogs(prev => [...prev, `ดึงข้อมูลสำเร็จ! ได้สินค้า ${data.products} รายการ และลูกค้า ${data.customers} รายการ`]);
      toast.success("ดึงข้อมูลสำเร็จ");
    } catch (e) {
      toast.error((e as Error).message);
      setSyncLogs(prev => [...prev, `เกิดข้อผิดพลาด: ${(e as Error).message}`]);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <main className="app__grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px", maxWidth: "800px" }}>
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>ย้ายข้อมูล (Migration)</h2>
            <p className="muted">ดึงข้อมูลจากระบบเก่า (POSPOS)</p>
          </div>
        </div>
        
        <div style={{ padding: "24px" }}>
          <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "24px" }}>
            <button 
              className="btn btn--primary" 
              onClick={handleAutoSync}
              disabled={isSyncing}
            >
              {isSyncing ? "กำลังดึงข้อมูล..." : "ดึงข้อมูลจาก POSPOS ตอนนี้"}
            </button>
            <span className="muted" style={{ fontSize: "14px" }}>ดึงข้อมูลสินค้าและลูกค้าอัตโนมัติจากหน้าเว็บ POSPOS</span>
          </div>

          <div style={{ background: "var(--bg-alt)", padding: "16px", borderRadius: "8px", minHeight: "200px", fontFamily: "monospace", fontSize: "14px", color: "var(--ink-secondary)" }}>
            <div style={{ marginBottom: "8px", fontWeight: 600 }}>Logs:</div>
            {syncLogs.length === 0 && <div style={{ opacity: 0.5 }}>ยังไม่มีการทำงาน...</div>}
            {syncLogs.map((log, i) => (
              <div key={i} style={{ marginBottom: "4px" }}>{log}</div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
