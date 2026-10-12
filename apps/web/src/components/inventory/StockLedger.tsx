import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import { getStockLedger } from "../../api";
import type { InventoryItem, StockLedgerMovement } from "../../types";
import { useToast } from "../../contexts/ToastContext";
import "./StockDocuments.css";

const qty = (value: number) => value.toLocaleString("th-TH", { maximumFractionDigits: 4 });
const kindLabels: Record<string, string> = { RECEIVE: "รับเข้า", SALE: "ขาย", RETURN: "คืนสต็อก", COUNT: "นับสต็อก", TRANSFER: "โอนระหว่างสาขา", MOVE: "ย้ายที่เก็บ", USE: "เบิกใช้", GIFT: "แจก / ชิม", LOSS: "ของเสีย", ADJUSTMENT: "ปรับยอด" };
const when = (value: string) => new Date(value).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const PAGE_SIZE = 30;

export default function StockLedger({ branchId, items }: { branchId: number; items: InventoryItem[] }) {
  const toast = useToast();
  const [ingredientId, setIngredientId] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: StockLedgerMovement[]; total: number; page: number; limit: number } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const version = useRef(0);
  const mounted = useRef(true);
  const exportBusy = useRef(false);
  const filters = useMemo(() => ({ ingredientId: ingredientId ? Number(ingredientId) : undefined, kind: kind || undefined, from: from || undefined, to: to || undefined }), [ingredientId, kind, from, to]);
  const filtersKey = JSON.stringify({ branchId, ...filters });
  const currentFilters = useRef(filtersKey);
  currentFilters.current = filtersKey;
  const invalidDates = !!from && !!to && from > to;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current += 1; }; }, []);
  useEffect(() => {
    const requestVersion = ++version.current;
    setData(null); setError("");
    if (invalidDates) return;
    getStockLedger(branchId, { ...filters, page, limit: PAGE_SIZE })
      .then((result) => {
        if (!mounted.current || version.current !== requestVersion) return;
        const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        if (page > lastPage) setPage(lastPage);
        else setData(result);
      })
      .catch((err) => { if (mounted.current && version.current === requestVersion) setError((err as Error).message); });
    return () => { version.current += 1; };
  }, [branchId, filters, page, reload, items, invalidDates]);

  async function exportCsv() {
    if (exportBusy.current || invalidDates) return;
    exportBusy.current = true;
    setExporting(true); setExportProgress(0);
    const startedFilters = filtersKey;
    const isCurrent = () => mounted.current && currentFilters.current === startedFilters;
    try {
      const first = await getStockLedger(branchId, { ...filters, page: 1, limit: 100 });
      if (!isCurrent()) return;
      const rows = [...first.items];
      setExportProgress(rows.length);
      const totalPages = Math.ceil(first.total / 100);
      for (let next = 2; next <= totalPages; next += 1) {
        const result = await getStockLedger(branchId, { ...filters, page: next, limit: 100, snapshotId: first.snapshotId });
        if (!isCurrent()) return;
        rows.push(...result.items); setExportProgress(rows.length);
      }
      const escaped = (value: unknown) => {
        const raw = typeof value === "string" && /^[=+@\-\t\r]/.test(value) ? `'${value}` : String(value ?? "");
        return `"${raw.replace(/"/g, '""')}"`;
      };
      const lines = rows.map((row) => [when(row.createdAt), row.ingredientName, row.unit, kindLabels[row.kind] ?? row.kind, row.qty, row.beforeQty, row.afterQty, row.reference, row.reason, row.actorName].map(escaped).join(","));
      const csv = "\uFEFF" + ["วันที่เวลา", "สินค้า", "หน่วย", "ประเภท", "เปลี่ยนแปลง", "ก่อน", "หลัง", "เอกสารอ้างอิง", "เหตุผล", "ผู้ทำรายการ"].map(escaped).join(",") + "\n" + lines.join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `stock-ledger_${branchId}_${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" })}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`ส่งออกประวัติ ${qty(rows.length)} รายการแล้ว`);
    } catch (err) { if (isCurrent()) toast.error(`ส่งออกไม่สำเร็จ: ${(err as Error).message}`); }
    finally { exportBusy.current = false; if (mounted.current) setExporting(false); }
  }

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const changeFilter = (apply: () => void) => { setPage(1); apply(); };
  return <div className="stock-ledger">
    <p className="stk-hint">รวมการขาย รับเข้า เบิกใช้ ของเสีย นับสต็อก และการโอน พร้อมยอดก่อน–หลังและผู้ทำรายการ</p>
    <div className="stock-ledger__filters">
      <label className="stk-field"><span>สินค้า / วัตถุดิบ</span><select className="input" aria-label="สินค้า / วัตถุดิบ" value={ingredientId} onChange={(e) => changeFilter(() => setIngredientId(e.target.value))}><option value="">ทุกรายการ</option>{items.map((item) => <option key={item.ingredientId} value={item.ingredientId}>{item.name}</option>)}</select></label>
      <label className="stk-field"><span>ประเภท</span><select className="input" aria-label="ประเภท" value={kind} onChange={(e) => changeFilter(() => setKind(e.target.value))}><option value="">ทุกประเภท</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="stk-field"><span>ตั้งแต่วันที่</span><input type="date" className="input" value={from} onChange={(e) => changeFilter(() => setFrom(e.target.value))} /></label>
      <label className="stk-field"><span>ถึงวันที่</span><input type="date" className="input" value={to} onChange={(e) => changeFilter(() => setTo(e.target.value))} /></label>
      <div className="stock-ledger__tools"><button type="button" className="btn btn--ghost" onClick={() => setReload((value) => value + 1)} disabled={invalidDates}><RefreshCw size={15} />โหลดใหม่</button><button type="button" className="btn btn--ghost" onClick={() => void exportCsv()} disabled={exporting || invalidDates}><Download size={15} />{exporting ? `ส่งออก ${qty(exportProgress)} รายการ...` : "ส่งออก CSV"}</button></div>
    </div>
    {invalidDates ? <p className="negative" role="alert">วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด</p> : error ? <p className="negative" role="alert">{error}</p> : data === null ? <div className="empty">กำลังโหลดประวัติ...</div> : <>
      <div className="stock-ledger__scroll"><table className="stock-ledger__table">
        <caption className="sr-only">ประวัติสต็อกสาขา</caption>
        <thead><tr><th scope="col">วัน / ผู้ทำรายการ</th><th scope="col">สินค้า / เอกสาร</th><th scope="col">ประเภท / เหตุผล</th><th scope="col">เปลี่ยนแปลง</th><th scope="col">ก่อน</th><th scope="col">หลัง</th></tr></thead>
        <tbody>{data.items.map((row) => <tr key={row.id}>
          <td><span>{when(row.createdAt)}</span><small>{row.actorName || "ไม่มีข้อมูลผู้ทำรายการ"}</small></td>
          <td><strong>{row.ingredientName}</strong><small>{row.reference || (row.documentId ? `ใบ #${row.documentId}` : "ไม่มีเอกสารอ้างอิง")}</small></td>
          <td><span>{kindLabels[row.kind] ?? row.kind}</span><small>{row.reason}</small></td>
          <td className={row.qty > 0 ? "positive" : row.qty < 0 ? "negative" : ""}>{row.kind === "MOVE" ? "ยอดรวมคงเดิม" : `${row.qty > 0 ? "+" : ""}${qty(row.qty)} ${row.unit}`}</td>
          <td>{row.beforeQty == null ? <small>ไม่มีข้อมูล</small> : `${qty(row.beforeQty)} ${row.unit}`}</td>
          <td>{row.afterQty == null ? <small>ไม่มีข้อมูล</small> : `${qty(row.afterQty)} ${row.unit}`}</td>
        </tr>)}{data.items.length === 0 && <tr><td colSpan={6} className="empty">ไม่มีประวัติที่ตรงกับตัวกรอง</td></tr>}</tbody>
      </table></div>
      <div className="stock-ledger__pagination"><span>{data.total ? `${qty((page - 1) * PAGE_SIZE + 1)}–${qty(Math.min(page * PAGE_SIZE, data.total))} จาก ${qty(data.total)} รายการ` : "0 รายการ"}</span><div><button type="button" className="btn btn--ghost" aria-label="ประวัติหน้าก่อน" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><span>หน้า {page} / {pages}</span><button type="button" className="btn btn--ghost" aria-label="ประวัติหน้าถัดไป" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></div>
      {data.items.some((row) => row.beforeQty == null || row.afterQty == null) && <p className="stk-hint">รายการเก่าที่ไม่ได้เก็บยอดก่อน–หลังจะแสดง “ไม่มีข้อมูล”</p>}
    </>}
  </div>;
}
