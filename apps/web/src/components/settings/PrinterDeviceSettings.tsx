import { useState } from "react";
import { isRawbtEnabled, setRawbtEnabled } from "../../utils/rawbtPrinter";

// Per-device printing options (stored locally, not on the server). Lets the
// Android tablet route receipts through RawBT to its Bluetooth printer while
// other devices (e.g. a desktop with a USB 58mm printer) keep normal printing.
export default function PrinterDeviceSettings() {
  const [enabled, setEnabled] = useState(() => isRawbtEnabled());

  const toggle = (value: boolean) => {
    setRawbtEnabled(value);
    setEnabled(value);
  };

  return (
    <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>เครื่องพิมพ์ (เฉพาะอุปกรณ์นี้)</h3>
      <p className="muted" style={{ marginTop: 4, marginBottom: 14 }}>
        ตั้งค่าเฉพาะเครื่องที่กำลังเปิดใช้งานอยู่ — บันทึกไว้ในเครื่องนี้ ไม่กระทบอุปกรณ์อื่น
      </p>
      <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          style={{ marginTop: 4, width: 18, height: 18, flexShrink: 0 }}
        />
        <span>
          <strong>พิมพ์ผ่าน RawBT (เครื่องพิมพ์บลูทูธบน Android)</strong>
          <span className="muted" style={{ display: "block", fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
            เปิดบนแท็บเล็ต/มือถือ Android ที่ต่อเครื่องพิมพ์บลูทูธไว้ เวลาเปิดบิลระบบจะส่งใบเสร็จเข้าแอป RawBT
            ให้อัตโนมัติ (ต้องติดตั้งแอป RawBT และจับคู่เครื่องพิมพ์ในแอปก่อน) — บนคอมพิวเตอร์ให้ปิดไว้
            เพื่อใช้การพิมพ์ปกติของเบราว์เซอร์
          </span>
        </span>
      </label>
    </section>
  );
}
