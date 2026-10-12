import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeftRight, Check, ClipboardList, Plus, Search, Trash2, X } from "lucide-react";
import { createInventoryDocument, getInventoryDocuments, postInventoryDocument, voidInventoryDocument } from "../../api";
import type { InventoryDocument, InventoryDocumentKind, InventoryItem } from "../../types";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import "./StockDocuments.css";

const qty = (value: number) => value.toLocaleString("th-TH", { maximumFractionDigits: 4 });
const when = (value: string) => new Date(value).toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const labels: Record<InventoryDocumentKind, string> = { MOVE: "ย้ายที่เก็บ", USE: "เบิกใช้", GIFT: "แจก / ชิม", LOSS: "ของเสีย / หมดอายุ" };
type Line = { ingredientId: number; qty: string };

export default function StockDocuments({ branchId, items, onChanged }: { branchId: number; items: InventoryItem[]; onChanged: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const canPost = user?.role === "admin" || user?.role === "manager";
  const [documents, setDocuments] = useState<InventoryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<InventoryDocumentKind>("MOVE");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [postImmediately, setPostImmediately] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voidId, setVoidId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InventoryDocument["status"]>("all");
  const busyRef = useRef(false);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const loadVersion = useRef(0);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadVersion.current += 1; }; }, []);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const rows = await getInventoryDocuments(branchId);
      if (mounted.current && version === loadVersion.current) setDocuments(rows);
    } catch (err) {
      if (mounted.current && version === loadVersion.current) setLoadError((err as Error).message);
    } finally {
      if (mounted.current && version === loadVersion.current) setLoading(false);
    }
  }, [branchId]);
  useEffect(() => { setDocuments([]); void load(); }, [load]);
  const byId = useMemo(() => new Map(items.map((item) => [item.ingredientId, item])), [items]);
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return items.filter((item) => !lines.some((line) => line.ingredientId === item.ingredientId) && `${item.name} ${item.barcode ?? ""}`.toLowerCase().includes(query)).slice(0, 10);
  }, [items, lines, search]);
  const invalidQty = (line: Line) => !line.qty.trim() || !Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0;
  const overStock = (line: Line) => Number(line.qty) > (byId.get(line.ingredientId)?.stockQty ?? 0);
  const locationsValid = fromLocation.trim() && toLocation.trim() && fromLocation.trim() !== toLocation.trim();
  const valid = lines.length > 0 && lines.every((line) => byId.has(line.ingredientId) && !invalidQty(line)) && (kind === "MOVE" ? !!locationsValid : !!reason.trim());
  const visible = documents.filter((document) => statusFilter === "all" || document.status === statusFilter);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || busyRef.current) return;
    if (postImmediately && lines.some(overStock)) return setError("จำนวนเกินยอดคงเหลือ ให้ตรวจสต็อกก่อนบันทึกทันที");
    const payload = { branchId, kind, reason: kind === "MOVE" ? reason.trim() || "ย้ายที่เก็บภายในสาขา" : reason.trim(), note: note.trim() || undefined, fromLocation: fromLocation.trim() || undefined, toLocation: toLocation.trim() || undefined, items: lines.map((line) => ({ ingredientId: line.ingredientId, qty: Number(line.qty) })), postImmediately: canPost && postImmediately };
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const document = await createInventoryDocument({ ...payload, requestKey: request.current.key });
      if (!mounted.current) return;
      toast.success(document.status === "POSTED" ? (kind === "MOVE" ? "บันทึกย้ายที่เก็บแล้ว ยอดรวมสาขาคงเดิม" : "บันทึกและตัดสต็อกแล้ว") : "สร้างใบเบิกแล้ว รออนุมัติ");
      setLines([]); setReason(""); setNote(""); setSearch(""); request.current = null;
      await load();
      onChanged();
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  async function post(document: InventoryDocument) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      await postInventoryDocument(document.id);
      if (!mounted.current) return;
      toast.success(document.kind === "MOVE" ? `บันทึกใบ #${document.id} แล้ว ยอดรวมสาขาคงเดิม` : `อนุมัติใบ #${document.id} และตัดสต็อกแล้ว`);
      await load(); onChanged();
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  async function cancel(document: InventoryDocument) {
    if (!voidReason.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      await voidInventoryDocument(document.id, { reason: voidReason.trim() });
      if (!mounted.current) return;
      toast.success(document.status === "POSTED" && document.kind !== "MOVE" ? `ยกเลิกใบ #${document.id} และคืนสต็อกแล้ว` : `ยกเลิกใบ #${document.id} แล้ว`);
      setVoidId(null); setVoidReason(""); await load(); onChanged();
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  return <div className="stock-docs">
    <form className="stock-docs__card" onSubmit={save}>
      <h3><ClipboardList size={18} /> สร้างใบเบิก / ย้ายที่เก็บ</h3>
      <div className="stock-docs__guide" role="note">
        <strong>ย้ายนมจากคลังมาหน้าเคาน์เตอร์ เลือก “ย้ายที่เก็บ” เพื่อคงยอดรวมสาขา</strong>
        <span>ขายเมนูแล้วระบบตัดวัตถุดิบตามสูตร ส่วน “เบิกใช้” ใช้กับของที่ใช้หมดจริงนอกการขาย เช่น ชงให้พนักงาน</span>
      </div>
      <fieldset disabled={busy} className="stock-docs__fields">
        <legend className="sr-only">ข้อมูลใบเบิก</legend>
        <div className="stk-chips" aria-label="ประเภทใบเบิก">{(Object.keys(labels) as InventoryDocumentKind[]).map((value) => <button key={value} type="button" aria-pressed={kind === value} className={kind === value ? "is-active" : ""} onClick={() => { setKind(value); setError(""); }}>{value === "MOVE" && <ArrowLeftRight size={14} />} {labels[value]}</button>)}</div>
        <p className="stk-hint">ผู้ขอเบิก: <strong>{user?.name ?? "ผู้ใช้งานปัจจุบัน"}</strong> · {kind === "MOVE" ? "บันทึกตำแหน่งที่ย้ายโดยไม่ลดจำนวนรวม" : "ลดสต็อกเมื่ออนุมัติเท่านั้น"}</p>
        <div className="stock-docs__pair">
          <label className="stk-field"><span>จากที่เก็บ {kind === "MOVE" ? "*" : "(ไม่บังคับ)"}</span><input className="input" maxLength={80} required={kind === "MOVE"} value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} placeholder="เช่น คลังหลังร้าน" /></label>
          <label className="stk-field"><span>ไปที่เก็บ {kind === "MOVE" ? "*" : "(ไม่บังคับ)"}</span><input className="input" maxLength={80} required={kind === "MOVE"} value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="เช่น เคาน์เตอร์กาแฟ" /></label>
        </div>
        {kind === "MOVE" && fromLocation.trim() && fromLocation.trim() === toLocation.trim() && <p className="negative" role="alert">ต้นทางกับปลายทางต้องคนละที่</p>}
        <label className="stk-field"><span>เหตุผล {kind === "MOVE" ? "(ไม่บังคับ)" : "*"}</span><input className="input" required={kind !== "MOVE"} maxLength={160} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "LOSS" ? "เช่น นมหมดอายุวันที่ 12 ต.ค." : kind === "USE" ? "เช่น ชงเครื่องดื่มให้พนักงาน" : kind === "GIFT" ? "เช่น ให้ลูกค้าชิมสินค้า" : "เช่น เติมของหน้าเคาน์เตอร์"} /></label>
        <div className="stk-field"><span>เพิ่มสินค้า / วัตถุดิบ *</span>
          <label className="studio-search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ / บาร์โค้ด" aria-label="ค้นหาสินค้าในใบเบิก" /></label>
          {matches.length > 0 && <div className="stock-docs__matches">{matches.map((item) => <button type="button" key={item.ingredientId} onClick={() => { setLines((current) => [...current, { ingredientId: item.ingredientId, qty: "" }]); setSearch(""); }}><Plus size={14} /><span>{item.name}</span><small>{qty(item.stockQty)} {item.unit}</small></button>)}</div>}
          {search.trim() && matches.length === 0 && <p className="stk-hint">ไม่พบสินค้า หรือเพิ่มสินค้านี้ในใบแล้ว</p>}
        </div>
        <div className="stock-docs__lines">{lines.map((line) => {
          const item = byId.get(line.ingredientId);
          return <div key={line.ingredientId} className="stock-docs__line">
            <div><strong>{item?.name ?? `สินค้า #${line.ingredientId}`}</strong><small className={overStock(line) ? "negative" : ""}>คงเหลือ {qty(item?.stockQty ?? 0)} {item?.unit}{overStock(line) ? " · จำนวนเกินคงเหลือ" : ""}</small></div>
            <label><span className="sr-only">จำนวน {item?.name}</span><input className="input" type="number" inputMode="decimal" min="0.0001" step="any" value={line.qty} required aria-invalid={!!line.qty && invalidQty(line)} onChange={(e) => setLines((current) => current.map((candidate) => candidate.ingredientId === line.ingredientId ? { ...candidate, qty: e.target.value } : candidate))} placeholder="จำนวน" /></label>
            <span>{item?.unit}</span><button type="button" className="studio-icon-button" aria-label={`ลบ ${item?.name} ออกจากใบเบิก`} onClick={() => setLines((current) => current.filter((candidate) => candidate.ingredientId !== line.ingredientId))}><Trash2 size={16} /></button>
          </div>;
        })}{lines.length === 0 && <p className="stk-hint">เลือกสินค้าได้หลายรายการในใบเดียว</p>}</div>
        <label className="stk-field"><span>หมายเหตุ (ไม่บังคับ)</span><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {canPost && <label className="stock-docs__check"><input type="checkbox" checked={postImmediately} onChange={(e) => setPostImmediately(e.target.checked)} /><span>{kind === "MOVE" ? "บันทึกย้ายที่เก็บทันที" : "อนุมัติและตัดสต็อกทันที"}</span></label>}
        <p className="stk-hint">{postImmediately ? (kind === "MOVE" ? "ยอดรวมสาขาคงเดิม และบันทึกประวัติการย้าย" : "ระบบตรวจยอดคงเหลือก่อนตัด และบันทึกผู้อนุมัติ") : "บันทึกเป็นใบที่รออนุมัติ ยอดคงเหลือยังเท่าเดิม"}</p>
        {error && <p role="alert" className="negative">{error}</p>}
        <button className="btn btn--primary" disabled={!valid || busy || (postImmediately && lines.some(overStock))}>{busy ? "กำลังบันทึก..." : postImmediately ? "บันทึกทันที" : "ส่งใบขออนุมัติ"}</button>
      </fieldset>
    </form>
    <section className="stock-docs__card">
      <div className="stock-docs__head"><h3>ใบเบิกของสาขานี้</h3><label className="stk-field"><span className="sr-only">กรองสถานะใบเบิก</span><select className="input" aria-label="กรองสถานะใบเบิก" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">ทุกสถานะ</option><option value="PENDING">รออนุมัติ</option><option value="POSTED">บันทึกแล้ว</option><option value="VOID">ยกเลิกแล้ว</option></select></label></div>
      {error && <p role="alert" className="negative">{error}</p>}
      {loadError && <div role="alert"><p className="negative">{loadError}</p><button type="button" className="btn btn--ghost" onClick={() => void load()}>โหลดใบเบิกอีกครั้ง</button></div>}
      {loading ? <div className="empty">กำลังโหลดใบเบิก...</div> : visible.length === 0 && !loadError ? <div className="empty">ยังไม่มีใบเบิกในสถานะนี้</div> : visible.map((document) => <article key={document.id} className="stock-docs__document">
        <div className="stock-docs__head"><strong>#{document.id} · {labels[document.kind]}</strong><span className={`stk-badge ${document.status === "PENDING" ? "is-low" : document.status === "VOID" ? "is-out" : "is-ok"}`}>{document.status === "PENDING" ? "รออนุมัติ" : document.status === "VOID" ? "ยกเลิกแล้ว" : "บันทึกแล้ว"}</span></div>
        <p className="stk-hint">{when(document.createdAt)} · ผู้ขอ {document.requestedByName ?? "ไม่ระบุ"}{document.approvedByName ? ` · ผู้อนุมัติ ${document.approvedByName}` : ""}{document.postedAt ? ` · บันทึก ${when(document.postedAt)}` : ""}</p>
        {(document.fromLocation || document.toLocation) && <p className="stock-docs__locations">{document.fromLocation || "ไม่ระบุต้นทาง"} → {document.toLocation || "ไม่ระบุปลายทาง"}</p>}
        <p>{document.reason}{document.note ? ` · ${document.note}` : ""}</p>
        {document.status === "VOID" && document.voidReason && <p className="stk-hint">เหตุผลที่ยกเลิก: {document.voidReason}</p>}
        <ul className="stock-docs__items">{document.items.map((item) => <li key={item.ingredientId}><span>{item.ingredientName ?? byId.get(item.ingredientId)?.name ?? `สินค้า #${item.ingredientId}`}</span><strong>{qty(item.qty)} {item.unit ?? byId.get(item.ingredientId)?.unit}</strong></li>)}</ul>
        {document.kind === "MOVE" && <p className="stk-hint">ย้ายที่เก็บ · ยอดรวมสาขาคงเดิม</p>}
        {canPost && document.status !== "VOID" && <div className="stock-docs__actions">
          {document.status === "PENDING" && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void post(document)}><Check size={15} />{document.kind === "MOVE" ? "อนุมัติการย้าย" : "อนุมัติและตัดสต็อก"}</button>}
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setVoidId(document.id); setVoidReason(""); setError(""); }}><X size={15} />ยกเลิกใบ</button>
        </div>}
        {voidId === document.id && <div className="stock-docs__void">
          <p className="stk-hint">{document.status === "POSTED" && document.kind !== "MOVE" ? "ยกเลิกใบนี้แล้วระบบจะคืนจำนวนที่ตัดไปกลับสต็อก" : "ยกเลิกใบนี้โดยยอดรวมสาขาคงเดิม"}</p>
          <label className="stk-field"><span>เหตุผลที่ยกเลิก *</span><input className="input" disabled={busy} maxLength={300} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} /></label>
          <div className="stock-docs__actions"><button type="button" className="btn btn--primary" disabled={busy || !voidReason.trim()} onClick={() => void cancel(document)}>ยืนยันยกเลิกใบ</button><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setVoidId(null)}>ปิด</button></div>
        </div>}
      </article>)}
    </section>
  </div>;
}
