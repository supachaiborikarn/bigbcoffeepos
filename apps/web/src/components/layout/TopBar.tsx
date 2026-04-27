import { useState } from "react";
import { useBranch } from "../../contexts/BranchContext";
import { useShift } from "../../contexts/ShiftContext";
import { useToast } from "../../contexts/ToastContext";

const formatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
function formatMoney(v: number) { return formatter.format(v); }

export default function TopBar() {
  const { branches, activeBranch, setBranchId } = useBranch();
  const { activeShift, openShift, closeShift, loading } = useShift();
  const toast = useToast();
  const [showShiftModal, setShowShiftModal] = useState<"open" | "close" | null>(null);
  const [cashInput, setCashInput] = useState("");
  const [closedSummary, setClosedSummary] = useState<any>(null);

  const handleOpenShift = async () => {
    try {
      await openShift(Number(cashInput) || 0);
      toast.success("เปิดกะขายเรียบร้อย");
      setShowShiftModal(null);
      setCashInput("");
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleCloseShift = async () => {
    try {
      const closed = await closeShift(Number(cashInput) || 0);
      setClosedSummary(closed);
      toast.success("ปิดกะขายเรียบร้อย");
      setShowShiftModal(null);
      setCashInput("");
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <select
            className="input topbar__branch-select"
            value={activeBranch?.id ?? ""}
            onChange={(e) => setBranchId(Number(e.target.value))}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="topbar__right">
          {activeShift ? (
            <button className="btn btn--ghost" onClick={() => { setCashInput(""); setShowShiftModal("close"); }}>
              🔒 ปิดกะ
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => { setCashInput(""); setShowShiftModal("open"); }}>
              🟢 เปิดกะ
            </button>
          )}
        </div>
      </header>

      {/* Shift Open Modal */}
      {showShiftModal === "open" && (
        <div className="modal-backdrop" onClick={() => setShowShiftModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3>🟢 เปิดกะขาย</h3>
              <button className="modal__close" onClick={() => setShowShiftModal(null)}>×</button>
            </div>
            <p className="muted">ใส่จำนวนเงินทอนเริ่มต้นในลิ้นชัก</p>
            <input className="input" type="number" min={0} placeholder="เงินทอนเริ่มต้น (บาท)"
              value={cashInput} onChange={(e) => setCashInput(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleOpenShift(); }}
              style={{ fontSize: 20, textAlign: "center", margin: "16px 0" }} />
            <button className="btn btn--primary btn--full" onClick={handleOpenShift} disabled={loading}>
              {loading ? "กำลังเปิดกะ..." : "ยืนยันเปิดกะ"}
            </button>
          </div>
        </div>
      )}

      {/* Shift Close Modal */}
      {showShiftModal === "close" && activeShift && (
        <div className="modal-backdrop" onClick={() => setShowShiftModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3>🔒 ปิดกะ #{activeShift.id}</h3>
              <button className="modal__close" onClick={() => setShowShiftModal(null)}>×</button>
            </div>
            <div className="summary-grid" style={{ marginBottom: 16 }}>
              <div className="summary-card"><span>ยอดขายรวม</span><strong>{formatMoney(activeShift.totalSales)}</strong></div>
              <div className="summary-card"><span>ออเดอร์</span><strong>{activeShift.totalOrders}</strong></div>
              <div className="summary-card"><span>เงินสดรับ</span><strong>{formatMoney(activeShift.cashSales)}</strong></div>
            </div>
            <p className="muted">ยอดเงินสดที่ควรมี: <strong>{formatMoney(activeShift.openingCash + activeShift.cashSales)}</strong></p>
            <input className="input" type="number" min={0} placeholder="นับเงินจริงในลิ้นชัก (บาท)"
              value={cashInput} onChange={(e) => setCashInput(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCloseShift(); }}
              style={{ fontSize: 20, textAlign: "center", margin: "16px 0" }} />
            <button className="btn btn--primary btn--full" onClick={handleCloseShift} disabled={loading}>
              {loading ? "กำลังปิดกะ..." : "ยืนยันปิดกะ"}
            </button>
          </div>
        </div>
      )}

      {/* Closed Shift Summary */}
      {closedSummary && (
        <div className="modal-backdrop" onClick={() => setClosedSummary(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3>✅ สรุปกะ #{closedSummary.id}</h3>
              <button className="modal__close" onClick={() => setClosedSummary(null)}>×</button>
            </div>
            <div className="summary-grid" style={{ marginBottom: 16 }}>
              <div className="summary-card"><span>ยอดขายรวม</span><strong>{formatMoney(closedSummary.totalSales)}</strong></div>
              <div className="summary-card"><span>ออเดอร์</span><strong>{closedSummary.totalOrders}</strong></div>
              <div className="summary-card"><span>เงินสดรับ</span><strong>{formatMoney(closedSummary.cashSales)}</strong></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>เงินทอนเริ่มต้น</span><strong>{formatMoney(closedSummary.openingCash)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>เงินสดที่ควรมี</span><strong>{formatMoney(closedSummary.expectedCash ?? 0)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>เงินจริงในลิ้นชัก</span><strong>{formatMoney(closedSummary.closingCash ?? 0)}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
                <span>ส่วนต่าง</span>
                <strong className={(closedSummary.difference ?? 0) >= 0 ? "positive" : "negative"}>
                  {(closedSummary.difference ?? 0) >= 0 ? "+" : ""}{formatMoney(closedSummary.difference ?? 0)}
                </strong>
              </div>
            </div>
            <button className="btn btn--primary btn--full" onClick={() => setClosedSummary(null)}>ปิด</button>
          </div>
        </div>
      )}
    </>
  );
}
