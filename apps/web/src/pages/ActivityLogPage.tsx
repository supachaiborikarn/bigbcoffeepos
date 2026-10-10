import { useCallback, useEffect, useMemo, useState } from "react";
import { History, RefreshCw, Search } from "lucide-react";
import { getAuditEvents, type AuditEvent } from "../api";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";

// Who did what, when — backed by the audit_events table (admin only).

const LABELS: Record<string, string> = {
  "auth.pin.succeeded": "เข้าสู่ระบบ", "auth.pin.failed": "ใส่ PIN ผิด", "auth.pin.rate_limited": "ล็อกการเข้าสู่ระบบชั่วคราว",
  "shift.opened": "เปิดกะ", "shift.closed": "ปิดกะ",
  "cash_drawer.entry_added": "บันทึกเงินเข้า/ออกลิ้นชัก", "cash_drawer.entry_voided": "ยกเลิกรายการเงินเข้า/ออก",
  "order.created": "เปิดบิลขาย", "order.status_updated": "เปลี่ยนสถานะบิล",
  "stock.adjusted": "ปรับสต็อก", "inventory.updated": "แก้ยอด/ตั้งค่าสต็อก", "stock_count.created": "สร้างรอบนับสต็อก", "stock_count.posted": "บันทึกผลนับสต็อก",
  "stock_transfer.created": "สร้างใบโอนสต็อก", "stock_transfer.received": "รับของจากใบโอน",
  "ingredient.created": "เพิ่มสินค้า/วัตถุดิบ", "ingredient.updated": "แก้ไขสินค้า/วัตถุดิบ", "recipe.updated": "แก้สูตรตัดสต็อก", "cup_stock_settings.updated": "แก้การตัดสต็อกแก้ว",
  "menu.created": "เพิ่มเมนู", "menu.updated": "แก้ไขเมนู", "menu.deactivated": "ปิดขายเมนู", "menu.restored": "เปิดขายเมนู",
  "purchase.created": "สร้างใบสั่งซื้อ", "purchase.approved": "อนุมัติใบสั่งซื้อ",
  "promotion.updated": "แก้โปรโมชั่น", "promotion.deleted": "ลบโปรโมชั่น", "coupon.updated": "แก้คูปอง", "coupon.deleted": "ลบคูปอง",
  "customer.branch_assigned": "ย้ายสาขาลูกค้า", "user.created": "เพิ่มพนักงาน", "user.updated": "แก้ไขพนักงาน", "user.deactivated": "ปิดบัญชีพนักงาน",
  "settings.store.updated": "แก้ตั้งค่าร้าน", "tax_invoice.created": "ออกใบกำกับภาษี", "migration.pospos_sync_queued": "สั่งดึงข้อมูล POSPOS",
  "import.products": "นำเข้าสินค้า", "import.customers": "นำเข้าลูกค้า", "import.historical_orders": "นำเข้าบิลย้อนหลัง",
  "system.audit_log_enabled": "เริ่มเก็บบันทึกกิจกรรม"
};
const GROUPS: Array<{ key: string; label: string }> = [
  { key: "", label: "ทั้งหมด" }, { key: "shift", label: "กะ" }, { key: "cash_drawer", label: "เงินลิ้นชัก" }, { key: "stock", label: "สต็อก" },
  { key: "order", label: "บิล" }, { key: "menu", label: "เมนู" }, { key: "user", label: "พนักงาน" }, { key: "auth", label: "เข้าสู่ระบบ" }
];
const HIDDEN_KEYS = new Set(["id", "ts", "action", "actor", "branchId", "requestId", "type", "ip"]);
const money = (v: unknown) => typeof v === "number" ? v.toLocaleString("th-TH", { maximumFractionDigits: 2 }) : String(v);
const DETAIL_LABELS: Record<string, string> = { shiftId: "กะ", orderId: "บิล", amount: "จำนวนเงิน", category: "หมวด", qty: "จำนวน", reason: "เหตุผล", closingCash: "นับเงินได้", difference: "ส่วนต่าง", openingCash: "เงินต้นกะ", ingredientId: "สินค้า#", transferId: "ใบโอน", status: "สถานะ", type: "ประเภท", toBranchId: "ไปสาขา" };

function describe(row: AuditEvent) {
  return Object.entries(row).filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 6).map(([k, v]) => `${DETAIL_LABELS[k] ?? k}: ${money(v)}`).join(" · ");
}

export default function ActivityLogPage() {
  const toast = useToast();
  const { branches } = useBranch();
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [group, setGroup] = useState("");
  const [branchId, setBranchId] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const load = useCallback(() => {
    setRows(null);
    getAuditEvents({ limit: 300, action: group || undefined, branchId: branchId || undefined })
      .then(setRows).catch((err) => { setRows([]); toast.error((err as Error).message); });
  }, [group, branchId, toast]);
  useEffect(() => { load(); }, [load]);
  const branchName = (id: number | null) => (id ? branches.find((b) => b.id === id)?.name : null) ?? "";
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || `${LABELS[r.action] ?? r.action} ${r.actor?.name ?? ""} ${describe(r)}`.toLowerCase().includes(q));
  }, [rows, search]);

  return <main className="studio-inventory activity">
    <div className="studio-page-heading"><div><span className="studio-eyebrow">ACTIVITY</span><h1>บันทึกกิจกรรม</h1><p>ใคร ทำอะไร เมื่อไหร่ · ล่าสุด 300 รายการ</p></div><History size={30} strokeWidth={1.4} /></div>
    <div className="activity-tools">
      <div className="stk-seg" role="tablist" aria-label="ประเภทกิจกรรม">{GROUPS.map((g) => <button key={g.key} role="tab" aria-selected={group === g.key} className={group === g.key ? "is-active" : ""} onClick={() => setGroup(g.key)}>{g.label}</button>)}</div>
      <select className="input" aria-label="สาขา" value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : "")}><option value="">ทุกสาขา</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <label className="studio-search stk-search"><Search size={18} /><input aria-label="ค้นหากิจกรรม" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อพนักงาน รายการ" /></label>
      <button className="btn btn--ghost" onClick={load} aria-label="รีเฟรช"><RefreshCw size={16} /></button>
    </div>
    {rows === null ? <div className="empty">กำลังโหลด...</div> : visible.length ? <ul className="stk-log activity-log">
      {visible.map((r) => <li key={r.id} className="stk-log__row">
        <span className="stk-log__when">{new Date(r.ts).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        <span className="stk-log__what"><strong>{LABELS[r.action] ?? r.action}</strong><span>{[r.actor?.name ?? (r.actor ? `ผู้ใช้ #${r.actor.id}` : "ระบบ"), branchName(r.branchId), describe(r)].filter(Boolean).join(" · ")}</span></span>
      </li>)}
    </ul> : <div className="empty">ยังไม่มีกิจกรรม · ระบบเริ่มเก็บบันทึกลงฐานข้อมูลตั้งแต่ 10 ต.ค. 2569</div>}
  </main>;
}
