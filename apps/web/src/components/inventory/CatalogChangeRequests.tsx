import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, RotateCcw, X } from "lucide-react";
import { approveCatalogChange, cancelCatalogChange, getCatalogChanges, rejectCatalogChange, type CatalogChangeRequest, type CatalogChangeStatus } from "../../api";
import { useToast } from "../../contexts/ToastContext";
import { resolveMenuImageUrl } from "../../utils/menuImage";
import "./CatalogChangeRequests.css";

const KIND_LABEL: Record<CatalogChangeRequest["kind"], string> = {
  "menu.update": "แก้เมนู",
  "ingredient.update": "แก้วัตถุดิบ",
  "inventory.update": "แก้วัตถุดิบ",
  "recipe.update": "แก้สูตรตัดสต็อก",
  "cup_stock.update": "แก้การตัดสต็อกแก้ว"
};
const STATUS_LABEL: Record<CatalogChangeStatus, string> = {
  PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", REJECTED: "ไม่อนุมัติ", CANCELLED: "ยกเลิกแล้ว"
};
const BRANCH_TYPE_LABEL: Record<string, string> = { coffee: "ร้านกาแฟ", oil_service: "ศูนย์บริการน้ำมัน" };

function renderValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "imageUrl" && typeof value === "string") {
    const src = resolveMenuImageUrl(value);
    if (src) {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <img src={src} alt="รูปสินค้า" style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
          <span>{value.startsWith("data:image/") || value.includes("/menu/") ? "รูปภาพที่อัปโหลด" : value}</span>
        </span>
      );
    }
  }
  if (typeof value === "boolean") return value ? "เปิด" : "ปิด";
  if (typeof value === "number") return value.toLocaleString("th-TH", { maximumFractionDigits: 4 });
  if (field === "branchType") return BRANCH_TYPE_LABEL[String(value)] ?? String(value);
  return String(value);
}

function formatTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "";
}

/** Admins approve or reject managers' catalog edits; a manager follows (and may withdraw) their own. */
export default function CatalogChangeRequests({ isAdmin, onResolved }: { isAdmin: boolean; onResolved?: () => void }) {
  const toast = useToast();
  // The toast context is a new object on every render; keep it out of load's deps.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [filter, setFilter] = useState<CatalogChangeStatus | "ALL">("PENDING");
  const [items, setItems] = useState<CatalogChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await getCatalogChanges(filter === "ALL" ? undefined : filter)); }
    catch (err) { toastRef.current.error((err as Error).message); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const act = async (request: CatalogChangeRequest, action: "approve" | "reject" | "cancel") => {
    if (action === "approve" && request.outdated && !window.confirm(`"${request.targetName}" ถูกแก้ไปแล้วหลังส่งคำขอนี้\nถ้าอนุมัติ ค่าในคำขอจะเขียนทับค่าปัจจุบัน ต้องการอนุมัติหรือไม่?`)) return;
    if (action === "cancel" && !window.confirm("ยกเลิกคำขอแก้ไขนี้?")) return;
    setBusyId(request.id);
    try {
      const note = (notes[request.id] ?? "").trim();
      if (action === "approve") await approveCatalogChange(request.id, note);
      else if (action === "reject") await rejectCatalogChange(request.id, note);
      else await cancelCatalogChange(request.id);
      toast.success(action === "approve" ? `อนุมัติแล้ว · ${request.targetName} ถูกแก้ตามคำขอ` : action === "reject" ? "ไม่อนุมัติคำขอแล้ว" : "ยกเลิกคำขอแล้ว");
      await load();
      onResolved?.();
    } catch (err) {
      toast.error((err as Error).message);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return <section className="panel ccr">
    <div className="panel__header ccr__header">
      <div>
        <h2>{isAdmin ? "คำขอแก้ไขจากผู้จัดการ" : "คำขอแก้ไขของฉัน"}</h2>
        <p className="muted">{isAdmin
          ? "ผู้จัดการเพิ่มเมนูและวัตถุดิบใหม่ได้ทันที แต่การแก้ของเดิมต้องรอคุณอนุมัติที่นี่"
          : "เพิ่มเมนูและวัตถุดิบใหม่บันทึกได้ทันที · การแก้ของเดิมจะรอผู้ดูแลระบบอนุมัติ"}</p>
      </div>
      <div className="ccr__filters" role="group" aria-label="กรองสถานะคำขอ">
        {(["PENDING", "APPROVED", "REJECTED", "ALL"] as const).map((value) => (
          <button key={value} type="button" className={`btn ${filter === value ? "btn--primary" : "btn--ghost"}`} onClick={() => setFilter(value)}>
            {value === "ALL" ? "ทั้งหมด" : STATUS_LABEL[value]}
          </button>
        ))}
        <button type="button" className="btn btn--ghost" onClick={() => void load()} aria-label="โหลดใหม่"><RotateCcw size={16} /></button>
      </div>
    </div>
    <div className="panel__body">
      {loading && !items.length ? <p className="muted">กำลังโหลด...</p> : null}
      {!loading && !items.length ? <p className="ccr__empty">{filter === "PENDING" ? "ไม่มีคำขอที่รออนุมัติ" : "ยังไม่มีคำขอ"}</p> : null}
      <ul className="ccr__list">
        {items.map((request) => (
          <li key={request.id} className={`ccr__card is-${request.status.toLowerCase()}`}>
            <div className="ccr__top">
              <div>
                <span className="ccr__kind">{KIND_LABEL[request.kind] ?? request.kind}</span>
                <strong className="ccr__target">{request.targetName}</strong>
                <small className="muted">
                  {request.requestedByName ?? `ผู้ใช้ #${request.requestedByUserId}`}
                  {request.branchName ? ` · ${request.branchName}` : ""} · {formatTime(request.createdAt)}
                </small>
              </div>
              <span className={`ccr__status is-${request.status.toLowerCase()}`}>{STATUS_LABEL[request.status]}</span>
            </div>

            <table className="ccr__changes">
              <thead><tr><th>รายการ</th><th>เดิม</th><th>ขอเปลี่ยนเป็น</th></tr></thead>
              <tbody>
                {request.changes.map((change) => (
                  <tr key={change.field}>
                    <th scope="row">{change.label}</th>
                    <td className="ccr__before">{renderValue(change.field, change.before)}</td>
                    <td className="ccr__after">{renderValue(change.field, change.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {request.status === "PENDING" && request.outdated && (
              <p className="ccr__warning"><AlertTriangle size={15} /> ข้อมูลนี้ถูกแก้ไปแล้วหลังส่งคำขอ ตรวจค่าปัจจุบันก่อนอนุมัติ</p>
            )}
            {request.status !== "PENDING" && (request.reviewNote || request.reviewedByName) && (
              <p className="ccr__review">
                {request.reviewedByName ? `${STATUS_LABEL[request.status]}โดย ${request.reviewedByName} · ${formatTime(request.reviewedAt)}` : formatTime(request.reviewedAt)}
                {request.reviewNote ? ` · “${request.reviewNote}”` : ""}
              </p>
            )}

            {request.status === "PENDING" && isAdmin && (
              <div className="ccr__actions">
                <input
                  className="input"
                  aria-label={`หมายเหตุถึงผู้ขอ ${request.targetName}`}
                  placeholder="หมายเหตุถึงผู้จัดการ (ไม่บังคับ)"
                  value={notes[request.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                />
                <button type="button" className="btn btn--ghost" disabled={busyId !== null} onClick={() => void act(request, "reject")}><X size={16} /> ไม่อนุมัติ</button>
                <button type="button" className="btn btn--primary" disabled={busyId !== null} onClick={() => void act(request, "approve")}><Check size={16} /> อนุมัติ</button>
              </div>
            )}
            {request.status === "PENDING" && !isAdmin && (
              <div className="ccr__actions">
                <button type="button" className="btn btn--ghost" disabled={busyId !== null} onClick={() => void act(request, "cancel")}><X size={16} /> ยกเลิกคำขอ</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  </section>;
}
