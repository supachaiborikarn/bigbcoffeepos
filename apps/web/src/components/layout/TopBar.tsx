import { useMemo, useState } from "react";
import { Menu, Moon, Sun, MapPin, Printer, Wallet, Clock, ChevronDown } from "lucide-react";
import { businessProfile, roleLabels } from "../../utils/business";
import { getShiftSummary } from "../../api";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import { useShift } from "../../contexts/ShiftContext";
import { useToast } from "../../contexts/ToastContext";
import type { ShiftSummary } from "../../types";
import Numpad from "../ui/Numpad";
import OfflineStatus from "../OfflineStatus";
import CashDrawerDialog from "../shift/CashDrawerDialog";
import TimeClockDialog from "../shift/TimeClockDialog";

const formatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0, maximumFractionDigits: 2
});

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;
const OPENING_PRESETS = [0, 1000, 2000, 3000, 5000];
const paymentLabels: Record<string, string> = {
  CASH: "เงินสด",
  QR: "QR",
  CARD: "บัตร",
  EWALLET: "E-Wallet"
};

type CashCounts = Record<string, string>;
type PrintableShiftSummary = ShiftSummary & {
  cashCountLines?: Array<{ denomination: number; count: number; total: number }>;
  closingNote?: string;
};

function formatMoney(v: number) {
  return formatter.format(v);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins} นาที`;
  return `${hours} ชม. ${mins} นาที`;
}

function emptyCashCounts(): CashCounts {
  return Object.fromEntries(DENOMINATIONS.map((denomination) => [String(denomination), ""]));
}

function cashCountLines(counts: CashCounts) {
  return DENOMINATIONS.map((denomination) => {
    const count = Math.max(0, Math.floor(Number(counts[String(denomination)]) || 0));
    return { denomination, count, total: denomination * count };
  }).filter((line) => line.count > 0);
}

/** Mirrors the server: cash short/over by this much needs a reason to close the shift. */
const VARIANCE_REASON_THRESHOLD = 100;

export default function TopBar({ onOpenMenu, mobileOpen, appearance, onToggleAppearance }: { onOpenMenu: () => void; mobileOpen: boolean; appearance: string; onToggleAppearance: () => void }) {
  const { user } = useAuth();
  const { branches, activeBranch, setBranchId } = useBranch();
  const profile = businessProfile(activeBranch?.branchType);
  const { activeShift, openShift, closeShift, loading, loaded: shiftLoaded } = useShift();
  const toast = useToast();
  const [showShiftModal, setShowShiftModal] = useState<"open" | "close" | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [closeCounts, setCloseCounts] = useState<CashCounts>(() => emptyCashCounts());
  const [closingNote, setClosingNote] = useState("");
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [closedSummary, setClosedSummary] = useState<PrintableShiftSummary | null>(null);
  const [showCashDrawer, setShowCashDrawer] = useState(false);
  const [showTimeClock, setShowTimeClock] = useState(false);
  const reloadCloseSummary = () => { if (showShiftModal === "close" && activeShift) getShiftSummary(activeShift.id).then(setShiftSummary).catch(() => {}); };

  const countedCash = useMemo(() => {
    return cashCountLines(closeCounts).reduce((sum, line) => sum + line.total, 0);
  }, [closeCounts]);

  const expectedCash = shiftSummary?.cash.expectedCash ?? (activeShift ? activeShift.openingCash + activeShift.cashSales : 0);
  const liveDifference = countedCash - expectedCash;

  async function handleOpenShift() {
    const amount = Number(openingCash) || 0;
    if (amount < 0) {
      toast.error("เงินต้นกะต้องไม่ติดลบ");
      return;
    }

    try {
      await openShift(amount);
      toast.success("เปิดกะขายเรียบร้อย");
      setShowShiftModal(null);
      setOpeningCash("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function openCloseModal() {
    if (!activeShift) return;
    setShowShiftModal("close");
    setCloseCounts(emptyCashCounts());
    setClosingNote("");
    setShiftSummary(null);
    setSummaryLoading(true);
    try {
      setShiftSummary(await getShiftSummary(activeShift.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleCloseShift() {
    if (!activeShift) return;
    if (Math.abs(liveDifference) >= VARIANCE_REASON_THRESHOLD && !closingNote.trim()) {
      toast.error(`เงิน${liveDifference < 0 ? "ขาด" : "เกิน"} ${formatMoney(Math.abs(liveDifference))} ต้องระบุเหตุผลในหมายเหตุก่อนปิดกะ`);
      return;
    }
    if (Math.round(liveDifference * 100) !== 0 && !window.confirm(`ยืนยันปิดกะ\nเงินที่ควรมี ${formatMoney(expectedCash)}\nนับได้ ${formatMoney(countedCash)}\nส่วนต่าง ${liveDifference > 0 ? "+" : ""}${formatMoney(liveDifference)}`)) return;
    const lines = cashCountLines(closeCounts);
    const cashCounts = Object.fromEntries(lines.map((line) => [String(line.denomination), line.count]));

    try {
      const result = await closeShift(countedCash, { cashCounts, note: closingNote.trim() || undefined });
      const summary = result.summary ?? shiftSummary;
      if (summary) {
        setClosedSummary({
          ...summary,
          cashCountLines: lines,
          closingNote: closingNote.trim() || undefined
        });
      }
      toast.success("ปิดกะขายเรียบร้อย");
      setShowShiftModal(null);
      setCloseCounts(emptyCashCounts());
      setClosingNote("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function handlePrintSummary() {
    window.print();
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <button className="studio-menu-toggle" onClick={onOpenMenu} aria-label="เปิดเมนู" aria-expanded={mobileOpen} aria-controls="main-navigation"><Menu size={22} /></button>
          <div className="studio-location"><MapPin size={17} /><div><small>{profile.title}</small>
          {branches.length > 1 ? <label className="studio-branch-picker">
            <strong aria-hidden="true">{activeBranch?.name}</strong><ChevronDown size={14} aria-hidden="true" />
            <select aria-label="เลือกสาขา" className="studio-branch-select" value={activeBranch?.id ?? ""} onChange={(e) => setBranchId(Number(e.target.value))}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></label> : <strong>{activeBranch?.name}</strong>}</div></div>
          {activeShift && (
            <div className="shift-status-pill">
              <span className="shift-status-dot" />
              <span>กะ #{activeShift.id}</span>
              {/* this is the shift's sales, not the drawer cash (which includes the opening float) */}
              <strong title={`ยอดขายในกะนี้ ${activeShift.totalOrders} บิล`}>ขาย {formatMoney(Math.max(0, activeShift.totalSales))}</strong>
            </div>
          )}
        </div>

        <div className="topbar__right">
          <OfflineStatus />
          <button className="studio-icon-button" aria-label="ตั้งค่าเครื่องพิมพ์" title="ตั้งค่าเครื่องพิมพ์" onClick={() => window.dispatchEvent(new Event("bbpos-open-printer-settings"))}><Printer size={18} /></button>
          <button className="studio-icon-button" onClick={onToggleAppearance} aria-label={appearance === "light" ? "ใช้โหมดมืด" : "ใช้โหมดสว่าง"} title={appearance === "light" ? "โหมดมืด" : "โหมดสว่าง"}>{appearance === "light" ? <Moon size={18} /> : <Sun size={18} />}</button>
          <div className="topbar__item" style={{ gap: 12, cursor: "default" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <strong style={{ fontSize: 14 }}>{user?.name}</strong>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{roleLabels[user?.role ?? ""]}</span>
            </div>
            <div style={{ width: 32, height: 32, background: "var(--brand-subtle)", color: "var(--brand-hover)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>
              {user?.name?.charAt(0) || "U"}
            </div>
          </div>

          {activeBranch && (
            <button className="btn btn--ghost topbar-cash-btn" onClick={() => setShowTimeClock(true)} title="ลงเวลาเข้า/ออกงานด้วย PIN">
              <Clock size={17} /><span>ลงเวลา</span>
            </button>
          )}
          {activeShift && (
            <button className="btn btn--ghost topbar-cash-btn" onClick={() => setShowCashDrawer(true)} title="บันทึกเงินจ่ายออก / เติมเข้าลิ้นชัก">
              <Wallet size={17} /><span>เงินเข้า/ออก</span>
            </button>
          )}
          {!shiftLoaded ? (
            <button className="btn btn--ghost" disabled>กำลังตรวจกะ...</button>
          ) : activeShift ? (
            <button className="btn btn--ghost" onClick={openCloseModal}>
              ปิดกะ
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => { setOpeningCash(""); setShowShiftModal("open"); }}>
              เปิดกะ
            </button>
          )}
        </div>
      </header>

      {showShiftModal === "open" && (
        <div className="modal-backdrop" onClick={() => setShowShiftModal(null)}>
          <div className="modal shift-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <h3>เปิดกะขาย</h3>
                <p className="muted" style={{ margin: "4px 0 0" }}>{activeBranch?.name}</p>
              </div>
              <button className="modal__close" onClick={() => setShowShiftModal(null)}>×</button>
            </div>

            <div className="shift-step-note">
              <strong>เงินต้นกะ</strong>
              <span>บันทึกเงินทอนเริ่มต้นในลิ้นชักก่อนเริ่มขาย</span>
            </div>

            <div className="shift-preset-row">
              {OPENING_PRESETS.map((preset) => (
                <button key={preset} className="btn btn--ghost" onClick={() => setOpeningCash(String(preset))}>
                  {formatMoney(preset)}
                </button>
              ))}
            </div>

            <input
              className="input shift-cash-display"
              type="text"
              readOnly
              value={openingCash}
              placeholder="0"
            />

            <Numpad
              value={openingCash}
              onChange={setOpeningCash}
              onEnter={() => !loading && handleOpenShift()}
              enterLabel={loading ? "กำลังเปิดกะ..." : "ยืนยันเปิดกะ"}
            />
          </div>
        </div>
      )}

      {showShiftModal === "close" && activeShift && (
        <div className="modal-backdrop" onClick={() => setShowShiftModal(null)}>
          <div className="modal shift-modal shift-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <h3>ปิดกะ #{activeShift.id}</h3>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  เปิดเมื่อ {formatDateTime(activeShift.openedAt)}
                </p>
              </div>
              <button className="modal__close" onClick={() => setShowShiftModal(null)}>×</button>
            </div>

            <div className="shift-close-layout">
              <section>
                <div className="summary-grid shift-summary-grid">
                  <div className="summary-card"><span>ยอดขาย</span><strong>{formatMoney(shiftSummary?.totals.totalSales ?? activeShift.totalSales)}</strong></div>
                  <div className="summary-card"><span>จำนวนบิล</span><strong>{shiftSummary?.totals.totalOrders ?? activeShift.totalOrders}</strong></div>
                  <div className="summary-card"><span>เฉลี่ย/บิล</span><strong>{formatMoney(shiftSummary?.totals.averageTicket ?? 0)}</strong></div>
                </div>

                <div className="shift-money-panel">
                  <div><span>เงินต้นกะ</span><strong>{formatMoney(activeShift.openingCash)}</strong></div>
                  <div><span>เงินสดจากยอดขาย</span><strong>{formatMoney(shiftSummary?.cash.cashSales ?? activeShift.cashSales)}</strong></div>
                  <div><span>จ่ายออกจากลิ้นชัก</span><strong className={(shiftSummary?.cash.paidOut ?? 0) > 0 ? "negative" : ""}>−{formatMoney(shiftSummary?.cash.paidOut ?? 0)}</strong></div>
                  {(shiftSummary?.cash.paidIn ?? 0) > 0 && <div><span>เติมเข้าลิ้นชัก</span><strong>+{formatMoney(shiftSummary?.cash.paidIn ?? 0)}</strong></div>}
                  <button type="button" className="btn btn--ghost shift-cash-link" onClick={() => setShowCashDrawer(true)}><Wallet size={15} /> บันทึก/ดูรายการเงินเข้า-ออก</button>
                  <div><span>เงินสดที่ควรมี</span><strong>{formatMoney(expectedCash)}</strong></div>
                  <div><span>นับเงินจริง</span><strong>{formatMoney(countedCash)}</strong></div>
                  <div className="shift-money-panel__total">
                    <span>ส่วนต่าง</span>
                    <strong className={liveDifference >= 0 ? "positive" : "negative"}>
                      {liveDifference >= 0 ? "+" : ""}{formatMoney(liveDifference)}
                    </strong>
                  </div>
                </div>

                <div className="shift-payment-list">
                  {summaryLoading && <p className="muted">กำลังโหลดสรุปยอด...</p>}
                  {(shiftSummary?.payments ?? []).map((payment) => (
                    <div key={payment.method}>
                      <span>{paymentLabels[payment.method] ?? payment.method}</span>
                      <strong>{formatMoney(payment.total)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="shift-count-header">
                  <strong>นับเงินสดในลิ้นชัก</strong>
                  <button className="btn btn--ghost" onClick={() => setCloseCounts(emptyCashCounts())}>ล้าง</button>
                </div>
                <div className="cash-count-grid">
                  {DENOMINATIONS.map((denomination) => (
                    <label key={denomination} className="cash-count-row">
                      <span>{formatMoney(denomination)}</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={closeCounts[String(denomination)] ?? ""}
                        onChange={(event) => setCloseCounts((prev) => ({
                          ...prev,
                          [String(denomination)]: event.target.value.replace(/[^\d]/g, "")
                        }))}
                        placeholder="0"
                      />
                      <strong>{formatMoney(denomination * (Number(closeCounts[String(denomination)]) || 0))}</strong>
                    </label>
                  ))}
                </div>
                <textarea
                  className="input"
                  style={{ minHeight: 72, marginTop: 12, resize: "vertical" }}
                  value={closingNote}
                  onChange={(event) => setClosingNote(event.target.value)}
                  placeholder="หมายเหตุปิดกะ เช่น ฝากเงินธนาคาร, เงินขาด/เกิน"
                  aria-invalid={Math.abs(liveDifference) >= VARIANCE_REASON_THRESHOLD && !closingNote.trim()}
                />
                {Math.abs(liveDifference) >= VARIANCE_REASON_THRESHOLD && <p className={closingNote.trim() ? "muted" : "negative"} style={{ fontSize: 12, marginTop: 6 }}>
                  เงิน{liveDifference < 0 ? "ขาด" : "เกิน"} {formatMoney(Math.abs(liveDifference))} · ต้องระบุเหตุผลก่อนปิดกะ
                </p>}
              </section>
            </div>

            <div className="shift-modal-actions">
              <button className="btn btn--ghost" onClick={() => setShowShiftModal(null)}>ยกเลิก</button>
              <button className="btn btn--primary" onClick={handleCloseShift} disabled={loading || summaryLoading}>
                {loading ? "กำลังปิดกะ..." : "ยืนยันปิดกะ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {closedSummary && (
        <div className="modal-backdrop" onClick={() => setClosedSummary(null)}>
          <div className="modal shift-modal shift-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <h3>สรุปปิดกะ #{closedSummary.shift.id}</h3>
                <p className="muted" style={{ margin: "4px 0 0" }}>{closedSummary.branch.name}</p>
              </div>
              <button className="modal__close" onClick={() => setClosedSummary(null)}>×</button>
            </div>

            <div className="summary-grid shift-summary-grid">
              <div className="summary-card"><span>ยอดขายรวม</span><strong>{formatMoney(closedSummary.totals.totalSales)}</strong></div>
              <div className="summary-card"><span>จำนวนบิล</span><strong>{closedSummary.totals.totalOrders}</strong></div>
              <div className="summary-card"><span>ส่วนต่างเงินสด</span><strong className={(closedSummary.cash.difference ?? 0) >= 0 ? "positive" : "negative"}>{(closedSummary.cash.difference ?? 0) >= 0 ? "+" : ""}{formatMoney(closedSummary.cash.difference ?? 0)}</strong></div>
            </div>

            <div className="shift-close-layout">
              <section className="shift-money-panel">
                <div><span>เปิดกะ</span><strong>{formatDateTime(closedSummary.openedAt)} · {closedSummary.user?.name ?? "-"}</strong></div>
                <div><span>ปิดกะ</span><strong>{formatDateTime(closedSummary.closedAt)} · {closedSummary.closeDetails?.closedBy?.name ?? "-"}</strong></div>
                <div><span>ระยะเวลา</span><strong>{formatDuration(closedSummary.durationMinutes)}</strong></div>
                <div><span>เงินต้นกะ</span><strong>{formatMoney(closedSummary.cash.openingCash)}</strong></div>
                <div><span>เงินสดที่ควรมี</span><strong>{formatMoney(closedSummary.cash.expectedCash)}</strong></div>
                <div><span>เงินจริงในลิ้นชัก</span><strong>{formatMoney(closedSummary.cash.closingCash ?? 0)}</strong></div>
              </section>

              <section className="shift-payment-list">
                {closedSummary.payments.map((payment) => (
                  <div key={payment.method}>
                    <span>{paymentLabels[payment.method] ?? payment.method}</span>
                    <strong>{formatMoney(payment.total)}</strong>
                  </div>
                ))}
              </section>
            </div>

            <div className="shift-modal-actions">
              <button className="btn btn--ghost" onClick={() => setClosedSummary(null)}>ปิด</button>
              <button className="btn btn--primary" onClick={handlePrintSummary}>พิมพ์สรุปกะ</button>
            </div>
          </div>
        </div>
      )}

      {closedSummary && (
        <section className="shift-print">
          <div className="shift-print__header">
            <h1>Big B Coffee POS</h1>
            <p>รายงานปิดกะ / Z Report</p>
            <p>{closedSummary.branch.name}</p>
          </div>
          <div className="shift-print__row"><span>กะ</span><strong>#{closedSummary.shift.id}</strong></div>
          <div className="shift-print__row"><span>ผู้เปิดกะ</span><strong>{closedSummary.user?.name ?? "-"}</strong></div>
          <div className="shift-print__row"><span>ผู้ปิดกะ</span><strong>{closedSummary.closeDetails?.closedBy?.name ?? "-"}</strong></div>
          <div className="shift-print__row"><span>เปิด</span><strong>{formatDateTime(closedSummary.openedAt)}</strong></div>
          <div className="shift-print__row"><span>ปิด</span><strong>{formatDateTime(closedSummary.closedAt)}</strong></div>
          <div className="shift-print__row"><span>ระยะเวลา</span><strong>{formatDuration(closedSummary.durationMinutes)}</strong></div>
          <hr />
          <div className="shift-print__row"><span>ยอดขายรวม</span><strong>{formatMoney(closedSummary.totals.totalSales)}</strong></div>
          <div className="shift-print__row"><span>จำนวนบิล</span><strong>{closedSummary.totals.totalOrders}</strong></div>
          <div className="shift-print__row"><span>เฉลี่ย/บิล</span><strong>{formatMoney(closedSummary.totals.averageTicket)}</strong></div>
          <div className="shift-print__row"><span>ส่วนลด</span><strong>{formatMoney(closedSummary.totals.discountAmount)}</strong></div>
          <hr />
          {closedSummary.payments.map((payment) => (
            <div className="shift-print__row" key={payment.method}>
              <span>{paymentLabels[payment.method] ?? payment.method}</span>
              <strong>{formatMoney(payment.total)}</strong>
            </div>
          ))}
          <hr />
          <div className="shift-print__row"><span>เงินต้นกะ</span><strong>{formatMoney(closedSummary.cash.openingCash)}</strong></div>
          <div className="shift-print__row"><span>เงินสดรับ</span><strong>{formatMoney(closedSummary.cash.cashSales)}</strong></div>
          <div className="shift-print__row"><span>จ่ายออกจากลิ้นชัก</span><strong>-{formatMoney(closedSummary.cash.paidOut ?? 0)}</strong></div>
          {(closedSummary.cash.paidIn ?? 0) > 0 && <div className="shift-print__row"><span>เติมเข้าลิ้นชัก</span><strong>+{formatMoney(closedSummary.cash.paidIn ?? 0)}</strong></div>}
          {(closedSummary.cash.entries ?? []).map((entry) => <div className="shift-print__row" key={entry.id}><span>· {entry.category}{entry.note ? ` (${entry.note})` : ""}</span><strong>{entry.type === "OUT" ? "-" : "+"}{formatMoney(entry.amount)}</strong></div>)}
          <div className="shift-print__row"><span>เงินสดที่ควรมี</span><strong>{formatMoney(closedSummary.cash.expectedCash)}</strong></div>
          <div className="shift-print__row"><span>นับเงินจริง</span><strong>{formatMoney(closedSummary.cash.closingCash ?? 0)}</strong></div>
          <div className="shift-print__row shift-print__total"><span>ส่วนต่าง</span><strong>{formatMoney(closedSummary.cash.difference ?? 0)}</strong></div>
          {closedSummary.cashCountLines && closedSummary.cashCountLines.length > 0 && (
            <>
              <hr />
              <p className="shift-print__section">รายละเอียดเงินสด</p>
              {closedSummary.cashCountLines.map((line) => (
                <div className="shift-print__row" key={line.denomination}>
                  <span>{formatMoney(line.denomination)} x {line.count}</span>
                  <strong>{formatMoney(line.total)}</strong>
                </div>
              ))}
            </>
          )}
          {closedSummary.closingNote && (
            <>
              <hr />
              <p className="shift-print__section">หมายเหตุ</p>
              <p>{closedSummary.closingNote}</p>
            </>
          )}
          <div className="shift-print__footer">
            <p>ลงชื่อผู้ปิดกะ ____________________</p>
            <p>พิมพ์เมื่อ {formatDateTime(new Date().toISOString())}</p>
          </div>
        </section>
      )}
      {showTimeClock && activeBranch && <TimeClockDialog branchId={activeBranch.id} onClose={() => setShowTimeClock(false)} />}
      {showCashDrawer && activeShift && <CashDrawerDialog shiftId={activeShift.id} onClose={() => setShowCashDrawer(false)} onChanged={reloadCloseSummary} />}
    </>
  );
}
