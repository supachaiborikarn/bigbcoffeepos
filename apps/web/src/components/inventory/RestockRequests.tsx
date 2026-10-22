import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, Plus, Search, Send, Trash2 } from "lucide-react";
import { createRestockRequest, getRestockRequests, getWarehouseInventory, getWarehouses, receiveRestockShipment, restockRequestAction, submitRestockRequest } from "../../api";
import type { CentralWarehouse, InventoryItem, RestockRequest, RestockShipment, WarehouseStockItem } from "../../types";
import { useBranch } from "../../contexts/BranchContext";
import { useToast } from "../../contexts/ToastContext";
import { RESTOCK_STATUS, restockLineSummary } from "./restockLabels";

// Branch side of the central warehouse: ask for stock, follow the request, and
// count what actually arrived. Stock enters this branch only on "รับของ".

const fmt = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

export default function RestockRequests({ branchId, items, onChanged }: { branchId: number; items: InventoryItem[]; onChanged: () => void }) {
  const toast = useToast();
  const { branches } = useBranch();
  const branchType = branches.find((b) => b.id === branchId)?.branchType;
  const [warehouse, setWarehouse] = useState<CentralWarehouse | null | undefined>(undefined);
  const [stock, setStock] = useState<WarehouseStockItem[]>([]);
  const [requests, setRequests] = useState<RestockRequest[] | null>(null);
  const [lines, setLines] = useState<Array<{ ingredientId: number; qty: string }>>([]);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [receiving, setReceiving] = useState<Record<number, string>>({});
  const onHand = useMemo(() => new Map(items.map((item) => [item.ingredientId, item])), [items]);
  const byId = useMemo(() => new Map(stock.map((row) => [row.ingredientId, row])), [stock]);

  const load = useCallback(async () => {
    try {
      const all = await getWarehouses();
      // the warehouse serves the business of the branch that runs it
      const mine = all.find((w) => w.active && (!w.managerBranch || w.managerBranch.branchType === branchType)) ?? null;
      setWarehouse(mine);
      if (!mine) { setRequests([]); return; }
      const [rows, inv] = await Promise.all([
        getRestockRequests({ warehouseId: mine.id, branchId }),
        getWarehouseInventory(mine.id).catch(() => [] as WarehouseStockItem[])
      ]);
      setRequests(rows.filter((r) => r.branchId === branchId));
      setStock(inv);
    } catch (err) { setRequests([]); toast.error((err as Error).message); }
  }, [branchId, branchType, toast]);
  useEffect(() => { void load(); }, [load]);

  const matches = useMemo(() => {
    const q = pick.trim().toLowerCase();
    if (!q) return [];
    return stock.filter((row) => row.name.toLowerCase().includes(q) && !lines.some((l) => l.ingredientId === row.ingredientId)).slice(0, 8);
  }, [pick, stock, lines]);
  const valid = Boolean(warehouse) && lines.length > 0 && lines.every((l) => Number(l.qty) > 0);

  async function send() {
    if (!warehouse || !valid || busy) return;
    setBusy(true);
    try {
      const request = await createRestockRequest({ warehouseId: warehouse.id, branchId, note: note.trim() || undefined, items: lines.map((l) => ({ ingredientId: l.ingredientId, requestedQty: Number(l.qty) })) });
      toast.success(`ส่งใบขอเบิก #${request.id} ไปคลังกลางแล้ว`);
      setLines([]); setNote("");
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); await load(); }
  }
  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); toast.success(done); setCancelling(null); await load(); onChanged(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  async function receive(shipment: RestockShipment) {
    const counted = shipment.items.map((item) => ({ shipmentItemId: item.id, receivedQty: Number(receiving[item.id] ?? item.shippedQty) }));
    if (counted.some((c) => !Number.isFinite(c.receivedQty) || c.receivedQty < 0)) { toast.error("จำนวนที่รับต้องไม่ติดลบ"); return; }
    const short = counted.some((c, i) => c.receivedQty !== shipment.items[i].shippedQty);
    await act(() => receiveRestockShipment(shipment.id, counted), short ? `รับของรอบ #${shipment.id} แล้ว · บันทึกว่าได้ของไม่ครบ` : `รับของรอบ #${shipment.id} เข้าสต็อกแล้ว`);
    setReceiving({});
  }

  if (warehouse === undefined) return <div className="empty">กำลังโหลด...</div>;
  if (!warehouse) return <div className="empty">ยังไม่ได้ตั้งคลังกลางสำหรับธุรกิจนี้ · ให้ผู้ดูแลระบบตั้งที่เมนู "คลังกลาง"</div>;

  const inTransit = (requests ?? []).flatMap((r) => (r.shipments ?? []).filter((s) => s.status === "IN_TRANSIT").map((s) => ({ request: r, shipment: s })));
  const open = (requests ?? []).filter((r) => r.status !== "RECEIVED" && r.status !== "CANCELLED");
  const closed = (requests ?? []).filter((r) => r.status === "RECEIVED" || r.status === "CANCELLED").slice(0, 15);

  return <div className="xfer">
    {inTransit.length > 0 && <section className="xfer-card is-incoming">
      <h3><PackageCheck size={17} /> ของจากคลังกลาง รอรับเข้าสาขา ({inTransit.length})</h3>
      <p className="stk-hint">นับของที่ได้จริง แก้ตัวเลขถ้าไม่ครบ แล้วกดรับของ · สต็อกสาขาเพิ่มตามที่กรอก</p>
      {inTransit.map(({ request, shipment }) => <div key={shipment.id} className="rst-ship">
        <strong>รอบส่ง #{shipment.id} · ใบเบิก #{request.id}</strong><small>ส่งเมื่อ {when(shipment.dispatchedAt)}{shipment.note ? ` · ${shipment.note}` : ""}</small>
        {shipment.items.map((item) => <label key={item.id} className="xfer-line">
          <span><strong>{item.ingredient?.name ?? `#${item.ingredientId}`}</strong><small>ส่งมา {fmt(item.shippedQty)} {item.ingredient?.unit}</small></span>
          <input className="input" type="number" inputMode="decimal" min="0" max={item.shippedQty} step="any" aria-label={`จำนวนที่ได้รับ ${item.ingredient?.name ?? ""}`} value={receiving[item.id] ?? String(item.shippedQty)} onChange={(e) => setReceiving((r) => ({ ...r, [item.id]: e.target.value }))} />
          <span />
        </label>)}
        <button className="btn btn--primary" disabled={busy} onClick={() => receive(shipment)}>รับของเข้าสาขา</button>
      </div>)}
    </section>}

    <section className="xfer-card">
      <h3><Send size={17} /> ขอเบิกจาก {warehouse.name}</h3>
      <div className="stk-field"><span>เพิ่มสินค้า</span>
        <label className="studio-search"><Search size={18} /><input value={pick} onChange={(e) => setPick(e.target.value)} placeholder="พิมพ์ชื่อสินค้าที่มีในคลังกลาง" aria-label="ค้นหาสินค้าในคลังกลาง" /></label>
        {matches.length > 0 && <div className="xfer-matches">{matches.map((row) => <button type="button" key={row.ingredientId} onClick={() => { setLines((l) => [...l, { ingredientId: row.ingredientId, qty: "" }]); setPick(""); }}>
          <Plus size={14} /> {row.name} <small>คลังพร้อมส่ง {fmt(row.availableQty)} {row.unit}</small></button>)}</div>}
        {pick.trim() && !matches.length && <small>ไม่พบในคลังกลาง</small>}
      </div>
      {lines.length > 0 && <div className="xfer-lines">{lines.map((line) => {
        const row = byId.get(line.ingredientId);
        const short = Number(line.qty) > (row?.availableQty ?? 0);
        return <div key={line.ingredientId} className="xfer-line">
          <span><strong>{row?.name}</strong><small className={short ? "negative" : undefined}>สาขามี {fmt(onHand.get(line.ingredientId)?.stockQty ?? 0)} · คลังพร้อมส่ง {fmt(row?.availableQty ?? 0)} {row?.unit}{short ? " · ส่วนที่เกินจะรอของเข้าคลัง" : ""}</small></span>
          <input className="input" type="number" inputMode="decimal" min="0" step="any" value={line.qty} placeholder="จำนวน" aria-label={`จำนวนขอเบิก ${row?.name}`} onChange={(e) => setLines((ls) => ls.map((l) => l.ingredientId === line.ingredientId ? { ...l, qty: e.target.value } : l))} />
          <button type="button" className="studio-icon-button" aria-label={`เอา ${row?.name} ออก`} onClick={() => setLines((ls) => ls.filter((l) => l.ingredientId !== line.ingredientId))}><Trash2 size={16} /></button>
        </div>;
      })}</div>}
      <label className="stk-field"><span>หมายเหตุ (ไม่บังคับ)</span><input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ต้องใช้ก่อนวันเสาร์" /></label>
      <button className="btn btn--primary btn--full" disabled={!valid || busy} onClick={send}>ส่งใบขอเบิก {lines.length ? `(${lines.length} รายการ)` : ""}</button>
    </section>

    <section className="xfer-card">
      <h3>ใบขอเบิกที่ยังไม่เสร็จ ({open.length})</h3>
      {requests === null ? <p className="stk-hint">กำลังโหลด...</p> : open.length ? open.map((r) => {
        const status = RESTOCK_STATUS[r.status];
        const onTheRoad = (r.shipments ?? []).some((s) => s.status === "IN_TRANSIT");
        return <div key={r.id} className="xfer-row">
          <div><strong>#{r.id} · {when(r.submittedAt ?? r.createdAt)}</strong><small>{status.hint}{r.note ? ` · ${r.note}` : ""}</small><p>{restockLineSummary(r)}</p></div>
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className={`stk-badge ${status.tone}`}>{status.label}</span>
            {r.status === "DRAFT" && <button className="btn btn--primary" disabled={busy} onClick={() => act(() => submitRestockRequest(r.id), `ส่งใบขอเบิก #${r.id} แล้ว`)}>ส่งคำขอ</button>}
            {!onTheRoad && (cancelling === r.id
              ? <><button className="btn btn--ghost" disabled={busy} onClick={() => setCancelling(null)}>ไม่ใช่</button><button className="btn btn--danger" disabled={busy} onClick={() => act(() => restockRequestAction(r.id, "cancel"), `ยกเลิกใบขอเบิก #${r.id} แล้ว`)}>ยืนยันยกเลิก</button></>
              : <button className="btn btn--ghost" disabled={busy} onClick={() => setCancelling(r.id)}>ยกเลิก…</button>)}
          </span>
        </div>;
      }) : <p className="stk-hint">ไม่มีใบขอเบิกค้าง</p>}
    </section>

    {closed.length > 0 && <section className="xfer-card">
      <h3>ประวัติใบขอเบิก</h3>
      {closed.map((r) => <div key={r.id} className="xfer-row">
        <div><strong>#{r.id} · {when(r.submittedAt ?? r.createdAt)}</strong><p>{restockLineSummary(r)}</p></div>
        <span className={`stk-badge ${RESTOCK_STATUS[r.status].tone}`}>{RESTOCK_STATUS[r.status].label}</span>
      </div>)}
    </section>}
  </div>;
}
