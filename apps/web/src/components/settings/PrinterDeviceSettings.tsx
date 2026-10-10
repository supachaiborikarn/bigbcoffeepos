import { useState } from "react";
import { getPaperWidth, getPrinterMode, isAndroidDevice, isIOSDevice, PAPER_SPECS, printerLabels, setPaperWidth, setPrinterMode, type PrinterMode } from "../../utils/printerSettings";
import { printReceipt } from "../ReceiptPrinter";
import { useBranch } from "../../contexts/BranchContext";
import { useToast } from "../../contexts/ToastContext";
import type { Order } from "../../types";

export default function PrinterDeviceSettings() {
  const [mode,setMode] = useState(getPrinterMode);
  const [width,setWidth] = useState(getPaperWidth);
  const {activeBranch} = useBranch();
  const toast=useToast();
  const test = () => {
    if (!activeBranch) return;
    const now=new Date().toISOString();
    try {
      const ok=printReceipt({order:{id:0,branchId:activeBranch.id,createdAt:now} as Order,cart:[{id:'test',menuItemId:0,name:'ทดสอบภาษาไทย · กาแฟ น้ำมันเครื่อง ๑๒๓',category:'',basePrice:65,qty:1,modifiers:[]}],discountRules:[],subtotal:65,discountAmount:0,total:65,pointsUsed:0,paymentMethod:'CASH',cashReceived:100,changeAmount:35,storeSetting:{shopName:activeBranch.name,receiptHeader:'ทดสอบเครื่องพิมพ์',receiptFooter:'ไม่มีการขายหรือรับเงินจริง',vatMode:'NONE'} as any},activeBranch.name);
      if (!ok) toast.error('เปิดหน้าทดสอบพิมพ์ไม่ได้');
    } catch { toast.error('เปิดหน้าทดสอบพิมพ์ไม่ได้'); }
  };
  return <section className="printer-settings">
    <p>ตั้งค่าเฉพาะอุปกรณ์นี้ และทดสอบก่อนเริ่มขาย</p>
    <label>วิธีพิมพ์<select className="input" value={mode} disabled={mode==='native'} onChange={e=>{const value=e.target.value as PrinterMode;setPrinterMode(value);setMode(value);}}>
      <option value="browser">{printerLabels.browser}</option>
      {isIOSDevice() && <option value="passprnt">{printerLabels.passprnt}</option>}
      {isAndroidDevice() && <option value="rawbt">{printerLabels.rawbt}</option>}
      {mode==='native' && <option value="native">{printerLabels.native}</option>}
    </select></label>
    <fieldset className="paper-picker">
      <legend>ขนาดกระดาษเครื่องพิมพ์ความร้อน</legend>
      <div className="paper-picker__options">{([58, 80] as const).map(value => <button type="button" key={value} aria-pressed={width===value} className={width===value?'is-active':''} onClick={()=>{setPaperWidth(value);setWidth(value);}}>
        <span className={`paper-picker__roll is-${value}`} aria-hidden="true" />
        <strong>{PAPER_SPECS[value].label}</strong>
        <small>{PAPER_SPECS[value].hint}</small>
      </button>)}</div>
      <small className="muted">ใช้กับใบเสร็จและใบสรุปส่งยอด · ตั้งค่าแยกตามเครื่อง/เบราว์เซอร์นี้</small>
    </fieldset>
    {isIOSDevice() && <p>Star TSP143IIIU ต่อ USB: ติดตั้ง Star PassPRNT บน iPad เลือกเครื่องพิมพ์ในแอป แล้วเลือกวิธีพิมพ์ Star PassPRNT ด้านบน; AirPrint ใช้กับเครื่องพิมพ์ที่รองรับ AirPrint บนเครือข่าย</p>}
    {mode==='rawbt' && <p>ติดตั้ง RawBT และเลือกเครื่องพิมพ์ในแอปก่อนใช้งาน</p>}
    <button className="btn btn--primary" onClick={test}>พิมพ์ทดสอบ · ไม่มีการขาย</button>
  </section>;
}
