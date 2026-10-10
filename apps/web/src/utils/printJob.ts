import type { ReceiptData } from '../components/ReceiptPrinter';
export type ReceiptPrintJob = {
  id: string;
  branchId: number;
  billId: number | string;
  /** Set for non-receipt documents (e.g. daily summary); shown instead of "บิล #id". */
  title?: string;
  html: string;
  documents: string[];
  labels: string[];
  escpos: string;
  widthMm: 58 | 80;
  createdAt: number;
  source?: { data: ReceiptData; branchName: string };
};
let receiver: ((job: ReceiptPrintJob, popup?: Window | null) => void) | undefined;
export function registerPrintReceiver(fn: NonNullable<typeof receiver>) {
  receiver = fn;
  return () => { if (receiver === fn) receiver = undefined; };
}
export function submitPrintJob(job: ReceiptPrintJob, popup?: Window | null) {
  if (!receiver) { popup?.close(); return false; }
  receiver(job, popup);
  return true;
}
export function buildPassPrntUrl(html: string, widthMm: 58 | 80, callback: string) {
  const fields = { back: callback, html, size: widthMm === 80 ? '576' : '406', cut: 'partial', popup: 'enable', drawer: 'off' };
  return 'starpassprnt://v1/print/nopreview?' + Object.entries(fields).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
export function passPrntError(code: string) {
  if (code === '4' || code === '8' || code === '15') return 'เชื่อมต่อเครื่องพิมพ์ไม่ได้ ตรวจสาย USB และเลือกเครื่องใน Star PassPRNT';
  if (code === '5' || code === '7') return 'เครื่องพิมพ์ไม่พร้อม ตรวจฝาเครื่องและกระดาษ';
  if (code === '6') return 'ยังยืนยันการพิมพ์ไม่ได้ ตรวจใบที่ออกก่อนพิมพ์ซ้ำ';
  if (code === '10') return 'ยกเลิกการพิมพ์แล้ว';
  return `พิมพ์ไม่สำเร็จ (รหัส ${code}) ตรวจเครื่องพิมพ์ก่อนลองอีกครั้ง`;
}
