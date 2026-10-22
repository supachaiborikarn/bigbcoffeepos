import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PackageCheck, Plus, Search, Truck, Warehouse } from "lucide-react";
import { adjustWarehouseStock, dispatchRestock, getInventory, getRestockRequests, getWarehouseInventory, getWarehouses, restockRequestAction, setupWarehouse } from "../api";
import type { CentralWarehouse, InventoryItem, RestockRequest, WarehouseStockItem } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { useToast } from "../contexts/ToastContext";
import { needsRestock } from "../utils/stockAlert";
import { RESTOCK_STATUS } from "../components/inventory/restockLabels";

// Central warehouse for the oil-change business: branches ask (เบิกจากคลังกลาง in
// their stock page), the warehouse reserves, picks and ships; the branch counts
// what arrived. Stock is booked into the warehouse here with "รับเข้าคลัง".

const fmt = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
const outstanding = (i: RestockRequest["items"][number]) => Math.max(0, i.requestedQty - i.shippedQty - i.reservedQty);

export default function WarehousePage() {
  const { user } = useAuth();
  const { branches } = useBranch();
  const toast = useToast();
  const isAdmin = user?.role === "admin";
  const [warehouse, setWarehouse] = useState<CentralWarehouse | null | undefined>(undefined);
  const [tab, setTab] = useState<"requests" | "stock" | "settings">("requests");

  const load = useCallback(() => getWarehouses()
    .then((rows) => setWarehouse(rows.find((w) => w.active) ?? null))
    .catch((err) => { setWarehouse(null); toast.error((err as Error).message); }), [toast]);
  useEffect(() => { void load(); }, [load]);

  const canOperate = Boolean(warehouse) && (isAdmin || (warehouse!.managerBranchId !== null && user?.branchId === warehouse!.managerBranchId));
  // managers only have their own branch loaded, so fall back to names the API sent along
  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name ?? (warehouse?.managerBranch?.id === id ? warehouse?.managerBranch?.name : undefined) ?? (id ? `สาขา #${id}` : "ยังไม่ได้เลือก");

  return <main className="studio-inventory">
    <div className="studio-page-heading"><div><span className="studio-eyebrow">CENTRAL WAREHOUSE</span><h1>คลังกลาง</h1><p>{warehouse ? `${warehouse.name} · ดูแลโดย ${branchName(warehouse.managerBranchId)}` : "ของเข้าคลังที่เดียว แล้วส่งให้สาขาตามใบขอเบิก"}</p></div><Warehouse size={30} strokeWidth={1.4} /></div>
    {warehouse === undefined ? <div className="empty">กำลังโหลด...</div>
      : !warehouse ? (isAdmin ? <WarehouseSettings onSaved={load} /> : <div className="empty">ยังไม่ได้ตั้งคลังกลาง · ให้ผู้ดูแลระบบตั้งค่าก่อน</div>)
      : !canOperate ? <div className="empty">หน้านี้สำหรับผู้ดูแลคลัง ({branchName(warehouse.managerBranchId)}) · สาขาขอเบิกของได้ที่ <Link to="/inventory">สต็อก &gt; เบิกจากคลังกลาง</Link></div>
      : <>
        <div className="studio-inventory-toolbar"><div className="studio-tabs">
          <button className={tab === "requests" ? "is-active" : ""} onClick={() => setTab("requests")}>ใบขอเบิกจากสาขา</button>
          <button className={tab === "stock" ? "is-active" : ""} onClick={() => setTab("stock")}>สต็อกคลัง</button>
          {isAdmin && <button className={tab === "settings" ? "is-active" : ""} onClick={() => setTab("settings")}>ตั้งค่า</button>}
        </div></div>
        {tab === "requests" ? <RequestQueue warehouse={warehouse} branchName={branchName} />
          : tab === "stock" ? <WarehouseStock warehouse={warehouse} />
          : <WarehouseSettings warehouse={warehouse} onSaved={load} />}
      </>}
  </main>;
}

function RequestQueue({ warehouse, branchName: knownName }: { warehouse: CentralWarehouse; branchName: (id: number) => string }) {
  const toast = useToast();
  const [requests, setRequests] = useState<RestockRequest[] | null>(null);
  const [ship, setShip] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const load = useCallback(() => getRestockRequests({ warehouseId: warehouse.id }).then(setRequests).catch((err) => { setRequests([]); toast.error((err as Error).message); }), [warehouse.id, toast]);
  useEffect(() => { void load(); }, [load]);

  const branchName = (id: number) => (requests ?? []).find((r) => r.branchId === id)?.branch?.name ?? knownName(id);
  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); toast.success(done); setCancelling(null); setShip({}); await load(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  function dispatch(r: RestockRequest) {
    const lines = r.items.map((i) => ({ requestItemId: i.id, qty: Number(ship[i.id] ?? i.reservedQty) })).filter((l) => l.qty > 0);
    if (!lines.length) { toast.error("ยังไม่มีของที่จองไว้ให้ส่ง"); return; }
    void act(() => dispatchRestock(r.id, { items: lines }), `ส่งของให้ ${branchName(r.branchId)} แล้ว · รอสาขากดรับ`);
  }

  const open = (requests ?? []).filter((r) => ["SUBMITTED", "PICKING", "PARTIAL", "IN_TRANSIT"].includes(r.status));
  const closed = (requests ?? []).filter((r) => r.status === "RECEIVED" || r.status === "CANCELLED").slice(0, 15);
  if (requests === null) return <div className="empty">กำลังโหลด...</div>;

  return <div className="xfer">
    <section className="xfer-card">
      <h3><Truck size={17} /> รอจัดส่ง ({open.length})</h3>
      {!open.length && <p className="stk-hint">ไม่มีใบขอเบิกค้าง</p>}
      {open.map((r) => {
        const status = RESTOCK_STATUS[r.status];
        const reserved = r.items.some((i) => i.reservedQty > 0);
        const short = r.items.some((i) => outstanding(i) > 0);
        const onTheRoad = (r.shipments ?? []).filter((s) => s.status === "IN_TRANSIT");
        return <div key={r.id} className="rst-request">
          <div className="rst-request__head">
            <div><strong>#{r.id} · {branchName(r.branchId)}</strong><small>ขอเมื่อ {when(r.submittedAt ?? r.createdAt)}{r.note ? ` · ${r.note}` : ""}</small></div>
            <span className={`stk-badge ${status.tone}`}>{status.label}</span>
          </div>
          <div className="rst-lines" role="table" aria-label={`รายการในใบเบิก #${r.id}`}>
            <div className="rst-line rst-line--head" role="row"><span>สินค้า</span><span>ขอ</span><span>จองแล้ว</span><span>ส่งแล้ว</span><span>รับแล้ว</span><span>ส่งรอบนี้</span></div>
            {r.items.map((i) => <div key={i.id} className="rst-line" role="row">
              <span><strong>{i.ingredient?.name ?? `#${i.ingredientId}`}</strong>{outstanding(i) > 0 && <small className="negative">ยังขาด {fmt(outstanding(i))} · คลังไม่พอ</small>}</span>
              <span data-label="ขอ">{fmt(i.requestedQty)}</span><span data-label="จองแล้ว">{fmt(i.reservedQty)}</span><span data-label="ส่งแล้ว">{fmt(i.shippedQty)}</span><span data-label="รับแล้ว">{fmt(i.receivedQty)}</span>
              <input className="input" type="number" inputMode="decimal" min="0" max={i.reservedQty} step="any" disabled={i.reservedQty <= 0} aria-label={`จำนวนส่ง ${i.ingredient?.name ?? ""}`} value={ship[i.id] ?? String(i.reservedQty)} onChange={(e) => setShip((s) => ({ ...s, [i.id]: e.target.value }))} />
            </div>)}
          </div>
          {onTheRoad.length > 0 && <p className="stk-hint">กำลังส่ง {onTheRoad.length} รอบ · รอ {branchName(r.branchId)} กดรับของ</p>}
          <div className="rst-actions">
            {short && <button className="btn btn--ghost" disabled={busy} onClick={() => act(() => restockRequestAction(r.id, "reserve"), `จองของเพิ่มให้ใบ #${r.id} แล้ว`)}>จองของที่เพิ่งเข้าคลัง</button>}
            {(r.status === "SUBMITTED" || r.status === "PARTIAL") && <button className="btn btn--ghost" disabled={busy} onClick={() => act(() => restockRequestAction(r.id, "picking"), `เริ่มจัดของใบ #${r.id}`)}><PackageCheck size={15} /> เริ่มจัดของ</button>}
            {!onTheRoad.length && (cancelling === r.id
              ? <><button className="btn btn--ghost" disabled={busy} onClick={() => setCancelling(null)}>ไม่ใช่</button><button className="btn btn--danger" disabled={busy} onClick={() => act(() => restockRequestAction(r.id, "cancel"), `ยกเลิกใบ #${r.id} แล้ว · คืนของที่จองไว้เข้าคลัง`)}>ยืนยันยกเลิก</button></>
              : <button className="btn btn--ghost" disabled={busy} onClick={() => setCancelling(r.id)}>ยกเลิก…</button>)}
            <button className="btn btn--primary" disabled={busy || !reserved} onClick={() => dispatch(r)}><Truck size={15} /> ส่งของ</button>
          </div>
        </div>;
      })}
    </section>
    {closed.length > 0 && <section className="xfer-card">
      <h3>ปิดแล้ว</h3>
      {closed.map((r) => <div key={r.id} className="xfer-row"><div><strong>#{r.id} · {branchName(r.branchId)}</strong><small>{when(r.submittedAt ?? r.createdAt)}</small></div><span className={`stk-badge ${RESTOCK_STATUS[r.status].tone}`}>{RESTOCK_STATUS[r.status].label}</span></div>)}
    </section>}
  </div>;
}

function WarehouseStock({ warehouse }: { warehouse: CentralWarehouse }) {
  const toast = useToast();
  const [rows, setRows] = useState<WarehouseStockItem[] | null>(null);
  const [catalog, setCatalog] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ ingredientId: number; name: string; unit: string; mode: "in" | "out"; qty: string; reorder: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => getWarehouseInventory(warehouse.id).then(setRows).catch((err) => { setRows([]); toast.error((err as Error).message); }), [warehouse.id, toast]);
  useEffect(() => { void load(); }, [load]);
  // items the managing branch stocks are the ones the warehouse can carry
  useEffect(() => { if (warehouse.managerBranchId) getInventory(warehouse.managerBranchId).then(setCatalog).catch(() => setCatalog([])); }, [warehouse.managerBranchId]);

  const q = search.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  const newItems = useMemo(() => q ? catalog.filter((c) => c.name.toLowerCase().includes(q) && !(rows ?? []).some((r) => r.ingredientId === c.ingredientId)).slice(0, 6) : [], [q, catalog, rows]);

  async function save() {
    if (!editing || busy) return;
    const qty = Number(editing.qty);
    const reorder = editing.reorder === "" ? undefined : Number(editing.reorder);
    if (!(qty > 0)) { toast.error("ใส่จำนวนมากกว่า 0"); return; }
    setBusy(true);
    try {
      await adjustWarehouseStock(warehouse.id, { ingredientId: editing.ingredientId, qty: editing.mode === "in" ? qty : -qty, reorderLevel: reorder, reason: `${editing.mode === "in" ? "WAREHOUSE_RECEIVE" : "WAREHOUSE_OUT"}${editing.note.trim() ? `: ${editing.note.trim()}` : ""}` });
      toast.success(`${editing.mode === "in" ? "รับเข้า" : "ตัดออก"} ${editing.name} ${fmt(qty)} ${editing.unit} แล้ว`);
      setEditing(null);
      await load();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  return <div className="xfer">
    <label className="studio-search"><Search size={18} /><input aria-label="ค้นหาสินค้าในคลังกลาง" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา หรือพิมพ์ชื่อสินค้าเพื่อรับเข้าคลังครั้งแรก" /></label>
    {newItems.length > 0 && <div className="xfer-matches">{newItems.map((c) => <button type="button" key={c.ingredientId} onClick={() => setEditing({ ingredientId: c.ingredientId, name: c.name, unit: c.unit, mode: "in", qty: "", reorder: "", note: "" })}><Plus size={14} /> รับ {c.name} เข้าคลังครั้งแรก <small>{c.unit}</small></button>)}</div>}

    {editing && <section className="xfer-card is-incoming">
      <h3>{editing.name}</h3>
      <div className="stk-seg" role="tablist" aria-label="ประเภทการปรับ">
        <button role="tab" aria-selected={editing.mode === "in"} className={editing.mode === "in" ? "is-active" : ""} onClick={() => setEditing({ ...editing, mode: "in" })}>รับเข้าคลัง</button>
        <button role="tab" aria-selected={editing.mode === "out"} className={editing.mode === "out" ? "is-active" : ""} onClick={() => setEditing({ ...editing, mode: "out" })}>ตัดออก (เสีย/หาย)</button>
      </div>
      <label className="stk-field"><span>จำนวน ({editing.unit})</span><input className="input" type="number" inputMode="decimal" min="0" step="any" value={editing.qty} onChange={(e) => setEditing({ ...editing, qty: e.target.value })} autoFocus /></label>
      <label className="stk-field"><span>จุดสั่งซื้อของคลัง (ไม่บังคับ)</span><input className="input" type="number" inputMode="decimal" min="0" step="any" value={editing.reorder} placeholder="แจ้งเตือนเมื่อเหลือเท่านี้" onChange={(e) => setEditing({ ...editing, reorder: e.target.value })} /></label>
      <label className="stk-field"><span>หมายเหตุ</span><input className="input" value={editing.note} maxLength={120} placeholder={editing.mode === "in" ? "เช่น บิลผู้ขาย / เลขที่ใบส่งของ" : "เช่น ถังรั่ว"} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></label>
      <div className="rst-actions"><button className="btn btn--ghost" disabled={busy} onClick={() => setEditing(null)}>ยกเลิก</button><button className="btn btn--primary" disabled={busy} onClick={save}>บันทึก</button></div>
    </section>}

    {rows === null ? <div className="empty">กำลังโหลด...</div> : <div className="stk-table" role="table" aria-label="สต็อกคลังกลาง">
      <div className="rst-stock rst-stock--head" role="row"><span>สินค้า</span><span>คงเหลือ</span><span>จองให้สาขา</span><span>พร้อมส่ง</span><span>จุดสั่งซื้อ</span><span /></div>
      {visible.map((r) => <div key={r.ingredientId} className={`rst-stock${needsRestock(r) ? " is-low" : ""}`} role="row">
        <span><strong>{r.name}</strong><small>{needsRestock(r) ? "ถึงจุดสั่งซื้อแล้ว" : r.unit}</small></span>
        <span data-label="คงเหลือ">{fmt(r.stockQty)}</span><span data-label="จองให้สาขา">{fmt(r.reservedQty)}</span><span data-label="พร้อมส่ง"><strong>{fmt(r.availableQty)}</strong></span>
        <span data-label="จุดสั่งซื้อ">{r.reorderLevel > 0 ? fmt(r.reorderLevel) : <em>ไม่ได้ตั้ง</em>}</span>
        <button className="btn btn--ghost" onClick={() => setEditing({ ingredientId: r.ingredientId, name: r.name, unit: r.unit, mode: "in", qty: "", reorder: r.reorderLevel ? String(r.reorderLevel) : "", note: "" })}>รับเข้า / ปรับ</button>
      </div>)}
      {!visible.length && <div className="empty">{rows.length ? "ไม่พบสินค้าที่ค้นหา" : "คลังยังว่าง · พิมพ์ชื่อสินค้าด้านบนเพื่อรับเข้าคลังครั้งแรก"}</div>}
    </div>}
  </div>;
}

function WarehouseSettings({ warehouse, onSaved }: { warehouse?: CentralWarehouse; onSaved: () => void }) {
  const toast = useToast();
  const { branches } = useBranch();
  const oilBranches = branches.filter((b) => b.branchType === "oil_service" && b.active !== false);
  const [name, setName] = useState(warehouse?.name ?? "คลังกลางบ่อถ่ายน้ำมัน");
  const [managerBranchId, setManagerBranchId] = useState<number>(warehouse?.managerBranchId ?? oilBranches[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!managerBranchId && oilBranches[0]) setManagerBranchId(oilBranches[0].id); }, [managerBranchId, oilBranches]);

  async function save() {
    if (!name.trim() || !managerBranchId || busy) return;
    setBusy(true);
    try { await setupWarehouse({ name: name.trim(), managerBranchId }); toast.success("บันทึกคลังกลางแล้ว"); onSaved(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  return <section className="xfer-card" style={{ maxWidth: 560 }}>
    <h3><Warehouse size={17} /> {warehouse ? "ตั้งค่าคลังกลาง" : "ตั้งคลังกลาง"}</h3>
    <p className="stk-hint">คลังกลางใช้กับบ่อถ่ายน้ำมันเท่านั้น · ผู้จัดการของสาขาที่ดูแลคลังจะจัดของและส่งให้สาขาอื่นได้</p>
    <label className="stk-field"><span>ชื่อคลัง</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
    <label className="stk-field"><span>สาขาที่ดูแลคลัง</span>
      <select className="input" value={managerBranchId} onChange={(e) => setManagerBranchId(Number(e.target.value))}>{oilBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
    </label>
    <button className="btn btn--primary" disabled={busy || !name.trim() || !managerBranchId} onClick={save}>{warehouse ? "บันทึก" : "ตั้งคลังกลาง"}</button>
  </section>;
}
