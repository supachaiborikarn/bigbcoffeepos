import { useCallback, useEffect, useState } from "react";
import { getStoreSetting, updateStoreSetting } from "../../api";
import { useBranch } from "../../contexts/BranchContext";
import { useToast } from "../../contexts/ToastContext";
import type { PaymentMethod, StoreSetting, VatMode } from "../../types";

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 42,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface, #fff)",
  fontSize: 14
};

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 6 };

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "เงินสด" },
  { value: "QR", label: "QR พร้อมเพย์" },
  { value: "CARD", label: "บัตรเครดิต/เดบิต" },
  { value: "EWALLET", label: "e-Wallet" }
];

const VAT_MODES: { value: VatMode; label: string }[] = [
  { value: "INCLUSIVE", label: "ราคารวม VAT แล้ว" },
  { value: "EXCLUSIVE", label: "ราคายังไม่รวม VAT (บวกเพิ่ม)" },
  { value: "NONE", label: "ไม่คิด VAT" }
];

export default function StoreSettingsPanel() {
  const { branches, activeBranch } = useBranch();
  const toast = useToast();
  const [branchId, setBranchId] = useState<number | null>(activeBranch?.id ?? null);
  const [form, setForm] = useState<StoreSetting | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (branchId === null && activeBranch?.id) setBranchId(activeBranch.id);
  }, [activeBranch, branchId]);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const settings = await getStoreSetting(id);
      setForm(settings);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (branchId !== null) load(branchId);
  }, [branchId, load]);

  function setField<K extends keyof StoreSetting>(key: K, value: StoreSetting[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function togglePayment(method: PaymentMethod) {
    setForm((prev) => {
      if (!prev) return prev;
      const has = prev.paymentMethods.includes(method);
      const next = has
        ? prev.paymentMethods.filter((m) => m !== method)
        : [...prev.paymentMethods, method];
      return { ...prev, paymentMethods: next.length > 0 ? next : prev.paymentMethods };
    });
  }

  async function handleSave() {
    if (!form || branchId === null) return;
    setSaving(true);
    try {
      const saved = await updateStoreSetting(branchId, {
        shopName: form.shopName,
        taxId: form.taxId,
        branchLabel: form.branchLabel,
        addressLine: form.addressLine,
        phone: form.phone,
        receiptHeader: form.receiptHeader,
        receiptFooter: form.receiptFooter,
        vatMode: form.vatMode,
        vatRate: form.vatRate,
        paymentMethods: form.paymentMethods
      });
      setForm(saved);
      toast.success("บันทึกข้อมูลร้านแล้ว");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>ข้อมูลร้าน / ใบเสร็จ</h3>
          <p className="muted" style={{ marginTop: 6 }}>ใช้แสดงบนใบเสร็จ/ใบกำกับภาษีอย่างย่อ และกำหนดวิธีชำระเงินที่เปิดใช้</p>
        </div>
        {branches.length > 1 && (
          <select
            style={{ ...inputStyle, width: "auto", minWidth: 180 }}
            value={branchId ?? ""}
            onChange={(e) => setBranchId(Number(e.target.value))}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {loading || !form ? (
        <p className="muted" style={{ marginTop: 16 }}>{loading ? "กำลังโหลด..." : "เลือกสาขาเพื่อตั้งค่า"}</p>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>ชื่อร้าน</label>
              <input style={inputStyle} value={form.shopName} onChange={(e) => setField("shopName", e.target.value)} placeholder="เช่น Big B Coffee" />
            </div>
            <div>
              <label style={labelStyle}>เลขประจำตัวผู้เสียภาษี (13 หลัก)</label>
              <input style={inputStyle} value={form.taxId} inputMode="numeric" onChange={(e) => setField("taxId", e.target.value.replace(/[^0-9]/g, "").slice(0, 13))} placeholder="0000000000000" />
            </div>
            <div>
              <label style={labelStyle}>ชื่อ/รหัสสาขา</label>
              <input style={inputStyle} value={form.branchLabel} onChange={(e) => setField("branchLabel", e.target.value)} placeholder="สำนักงานใหญ่ / สาขา 00001" />
            </div>
            <div>
              <label style={labelStyle}>เบอร์โทร</label>
              <input style={inputStyle} value={form.phone} onChange={(e) => setField("phone", e.target.value)} placeholder="0xx-xxx-xxxx" />
            </div>
          </div>

          <div>
            <label style={labelStyle}>ที่อยู่ร้าน</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.addressLine} onChange={(e) => setField("addressLine", e.target.value)} placeholder="ที่อยู่สำหรับออกใบกำกับภาษี" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>ข้อความหัวใบเสร็จ</label>
              <input style={inputStyle} value={form.receiptHeader} onChange={(e) => setField("receiptHeader", e.target.value)} placeholder="(ถ้ามี)" />
            </div>
            <div>
              <label style={labelStyle}>ข้อความท้ายใบเสร็จ</label>
              <input style={inputStyle} value={form.receiptFooter} onChange={(e) => setField("receiptFooter", e.target.value)} placeholder="ขอบคุณที่ใช้บริการ" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>โหมด VAT</label>
              <select style={inputStyle} value={form.vatMode} onChange={(e) => setField("vatMode", e.target.value as VatMode)}>
                {VAT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>อัตรา VAT (%)</label>
              <input
                style={inputStyle}
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={form.vatRate}
                disabled={form.vatMode === "NONE"}
                onChange={(e) => setField("vatRate", Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>วิธีชำระเงินที่เปิดใช้</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {PAYMENT_METHODS.map((m) => (
                <label key={m.value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.paymentMethods.includes(m.value)} onChange={() => togglePayment(m.value)} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? "กำลังบันทึก..." : "บันทึกข้อมูลร้าน"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
