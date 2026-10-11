import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBranch } from '../contexts/BranchContext';
import { buildPassPrntUrl, passPrntError, registerPrintReceiver, type ReceiptPrintJob } from '../utils/printJob';
import { getPrinterMode, printerLabels, type PrinterMode } from '../utils/printerSettings';
import { sendReceiptToNative } from '../utils/nativePrinter';
import { sendRawbtText } from '../utils/rawbtPrinter';
import { createReceiptJob, printWhenReady } from './ReceiptPrinter';
import PrinterDeviceSettings from './settings/PrinterDeviceSettings';
import { useDialogFocus } from '../utils/useDialogFocus';

type Session = { job: ReceiptPrintJob; mode: PrinterMode; copy: number; attempt: string; message: string; awaiting: boolean; clearAt?: number };
const COMPLETED_STATUS_MS = 8_000;
export default function PrintCenter() {
  const { user } = useAuth();
  const { activeBranch } = useBranch();
  const routeLocation = useLocation();
  const receiptPage = routeLocation.pathname === '/pos' || routeLocation.pathname === '/orders';
  const key = `bbpos.print.job:${user?.id}:${activeBranch?.id}`;
  const [session, setSession] = useState<Session | null>(null);
  const current = useRef<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const timeout = useRef<number>();
  const save = (value: Session | null) => {
    current.current = value; setSession(value);
    try { value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key); } catch { /* still usable in this tab */ }
  };
  const update = (message: string, awaiting = false) => { if (current.current) save({ ...current.current, message, awaiting, clearAt: undefined }); };
  const clearCompleted = (value: Session) => {
    save(value);
    window.clearTimeout(timeout.current);
    timeout.current = window.setTimeout(() => {
      if (current.current?.attempt === value.attempt && !current.current.awaiting) save(null);
    }, Math.max(0, (value.clearAt ?? Date.now()) - Date.now()));
  };
  const complete = (message: string) => {
    const value = current.current;
    if (value) clearCompleted({ ...value, message, awaiting: false, clearAt: Date.now() + COMPLETED_STATUS_MS });
  };
  const launch = (value: Session, popup?: Window | null) => {
    save(value);
    window.clearTimeout(timeout.current);
    try {
      if (value.mode === 'passprnt') { popup?.close(); setOpen(true); return; }
      if (value.mode === 'native') {
        popup?.close();
        const sent = sendReceiptToNative({ type:'receipt',html:value.job.html,documents:value.job.documents.slice(value.copy),widthMm:value.job.widthMm,copies:value.job.documents.length-value.copy,baseUrl:location.origin,billId:value.job.billId,requestId:value.attempt });
        if (!sent) throw new Error('ส่งไปเครื่องพิมพ์ไม่ได้');
        update('กำลังพิมพ์ กรุณารอผลจากเครื่อง', true);
        timeout.current = window.setTimeout(() => update('ยังไม่ได้รับผลพิมพ์ ตรวจใบที่ออกก่อนพิมพ์ซ้ำ'), 90_000);
        return;
      }
      if (value.mode === 'rawbt') {
        popup?.close();
        if (!sendRawbtText(value.job.escpos)) throw new Error('เปิด RawBT ไม่สำเร็จ');
        update('ส่งไป RawBT แล้ว กรุณาตรวจใบเสร็จที่เครื่อง'); return;
      }
      const win = popup || window.open('', 'bbpos_receipt', 'width=420,height=700');
      if (!win) { update('เปิดหน้าพิมพ์ไม่ได้ อนุญาตหน้าต่างป๊อปอัปแล้วกดพิมพ์อีกครั้ง'); setOpen(true); return; }
      win.document.open(); win.document.write(value.job.html); win.document.close();
      win.onafterprint = () => {
        win.close();
        if (current.current?.attempt !== value.attempt) return;
        complete('ปิดหน้าต่างพิมพ์แล้ว กรุณาตรวจว่าใบเสร็จออกครบ');
      };
      printWhenReady(win, win.document, () => {
        if (current.current?.attempt !== value.attempt) return;
        update('เปิดหน้าพิมพ์ไม่สำเร็จ · บิลยังบันทึกอยู่ กดพิมพ์อีกครั้ง'); setOpen(true);
      });
      update('เปิดหน้าต่างพิมพ์แล้ว กรุณาเลือกเครื่องพิมพ์');
    } catch (error) { popup?.close(); update(`พิมพ์ไม่สำเร็จ: ${(error as Error).message} · บิลยังบันทึกอยู่`); setOpen(true); }
  };
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || 'null') as Session | null;
      if (raw && raw.job.branchId === activeBranch?.id && Date.now()-raw.job.createdAt < 30*60_000) {
        const url = new URL(location.href);
        const code = url.searchParams.get('passprnt_code');
        if (code !== null && url.searchParams.get('print_attempt') === raw.attempt && raw.awaiting) {
          if (code === '0') {
            raw.copy += 1;
            raw.message = raw.copy < raw.job.documents.length ? `พิมพ์แล้ว ${raw.copy}/${raw.job.documents.length} ใบ · กดพิมพ์ใบถัดไป` : 'Star PassPRNT แจ้งว่าพิมพ์ครบแล้ว';
          } else raw.message = passPrntError(code);
          raw.attempt = crypto.randomUUID();
          raw.awaiting = false;
          if (code === '0' && raw.copy === raw.job.documents.length) raw.clearAt = Date.now() + COMPLETED_STATUS_MS;
          else setOpen(true);
        } else if (raw.awaiting) {
          raw.awaiting = false; raw.message = 'ยังไม่มีผลยืนยันการพิมพ์ ตรวจใบที่ออกก่อนส่งซ้ำ';
        }
        if (!raw.awaiting && !raw.clearAt && /^(เครื่องพิมพ์แจ้งว่าพิมพ์ครบแล้ว|Star PassPRNT แจ้งว่าพิมพ์ครบแล้ว|ปิดหน้าต่างพิมพ์แล้ว)/.test(raw.message)) {
          raw.clearAt = raw.job.createdAt + COMPLETED_STATUS_MS;
        }
        if (raw.clearAt) {
          if (raw.clearAt <= Date.now()) save(null);
          else clearCompleted(raw);
        } else save(raw);
      } else save(null);
    } catch { save(null); }
    const url = new URL(location.href);
    for (const field of ['passprnt_code','passprnt_message','print_attempt']) url.searchParams.delete(field);
    if (url.href !== location.href) history.replaceState(history.state, '', url.pathname+url.search+url.hash);
    const unregister = registerPrintReceiver((job, popup) => {
      if (job.branchId !== activeBranch?.id) { popup?.close(); return; }
      if (current.current?.awaiting) {
        popup?.close();
        throw new Error('มีใบเสร็จที่ยังรอผลพิมพ์ ตรวจใบเดิมก่อน แล้วเปิดบิลนี้จากหน้าออเดอร์เพื่อพิมพ์');
      }
      setSettings(false);
      launch({job,mode:getPrinterMode(),copy:0,attempt:crypto.randomUUID(),message:job.title?'พร้อมพิมพ์':job.billId===0?'ใบเสร็จทดสอบ · ไม่มีการขายหรือรับเงิน':'บิลบันทึกแล้ว พร้อมพิมพ์ใบเสร็จ',awaiting:false},popup);
    });
    const nativeResult = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const value = current.current;
      if (!value || detail?.requestId !== value.attempt || !value.awaiting) return;
      window.clearTimeout(timeout.current);
      const completed = Math.max(0, Math.min(value.job.documents.length-value.copy, Number(detail.completedCopies)||0));
      save({...value,copy:value.copy+completed,awaiting:false,clearAt:undefined,message:detail.success ? 'เครื่องพิมพ์แจ้งว่าพิมพ์ครบแล้ว' : `พิมพ์แล้ว ${value.copy+completed}/${value.job.documents.length} ใบ · ตรวจสาย USB กระดาษ และฝาเครื่องก่อนลองอีกครั้ง`});
      if (detail.success) complete('เครื่องพิมพ์แจ้งว่าพิมพ์ครบแล้ว');
      else setOpen(true);
    };
    const showSettings = () => {setSettings(true);setOpen(true);};
    const changeSettings = () => {
      const value = current.current;
      if (!value || value.awaiting) return;
      const source = value.job.source;
      const job = source ? {...createReceiptJob(source.data, source.branchName), id:value.job.id, createdAt:value.job.createdAt} : value.job;
      save({...value,job,mode:getPrinterMode(),attempt:crypto.randomUUID()});
    };
    window.addEventListener('bbpos-native-print-result',nativeResult);
    window.addEventListener('bbpos-open-printer-settings',showSettings);
    window.addEventListener('bbpos-printer-settings',changeSettings);
    return () => { unregister(); window.clearTimeout(timeout.current); window.removeEventListener('bbpos-native-print-result',nativeResult);window.removeEventListener('bbpos-open-printer-settings',showSettings);window.removeEventListener('bbpos-printer-settings',changeSettings); };
  }, [key]);

  const retry = () => {
    if (!session || session.awaiting) return;
    const next = {...session,mode:getPrinterMode(),attempt:crypto.randomUUID(),clearAt:undefined,copy:session.copy >= session.job.documents.length ? 0 : session.copy};
    launch(next);
  };
  const copyIndex = session ? Math.min(session.copy,session.job.documents.length-1) : 0;
  const callback = new URL('/pos',location.origin);
  if (session) callback.searchParams.set('print_attempt',session.attempt);
  const href = session ? buildPassPrntUrl(session.job.documents[copyIndex],session.job.widthMm,callback.href) : '';
  return <>
    {session && receiptPage && <div className="printer-status" role="status"><p>{session.job.title ?? `บิล #${session.job.billId}`} · {session.message}</p><button className="btn btn--ghost" onClick={()=>{setSettings(false);setOpen(true);}}>ใบเสร็จ / พิมพ์ซ้ำ</button><button className="studio-icon-button" aria-label="ปิดสถานะการพิมพ์" disabled={session.awaiting} onClick={()=>save(null)}>×</button></div>}
    {open && (settings || (session && (receiptPage || session.job.title))) && <PrintDialog onClose={()=>{setOpen(false);setSettings(false);}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16}}><h2 id="print-title">{settings?'ตั้งค่าเครื่องพิมพ์':session?.job.title ?? `ใบเสร็จ #${session?.job.billId ?? ''}`}</h2><button className="btn btn--ghost" aria-label="ปิดหน้าพิมพ์" onClick={()=>{setOpen(false);setSettings(false);}}>ปิด</button></div>
      {settings ? <><PrinterDeviceSettings />{session && <button className="btn btn--ghost" onClick={()=>setSettings(false)}>กลับไปใบเสร็จ</button>}</> : session && <>
        <p role="status">{session.message}</p><p className="muted">{printerLabels[session.mode]} · กระดาษ {session.job.widthMm} มม.</p>
        <div className="print-actions">
          {session.mode === 'passprnt' ? session.copy < session.job.documents.length && <a className="btn btn--primary" href={href} aria-disabled={session.awaiting} onClick={event=>{
            if (session.awaiting) {event.preventDefault();return;}
            save({...session,awaiting:true,message:'กำลังเปิด Star PassPRNT · หากแอปไม่เปิด ให้ติดตั้งและตั้งค่าเครื่องพิมพ์ก่อน'});
          }}>พิมพ์ {session.job.labels[copyIndex]} ({copyIndex+1}/{session.job.documents.length})</a> : <button className="btn btn--primary" onClick={retry} disabled={session.awaiting}>พิมพ์{session.copy>0 && session.copy<session.job.documents.length?'ใบที่เหลือ':'อีกครั้ง'}</button>}
          {session.mode === 'passprnt' && (session.awaiting || session.copy === session.job.documents.length) && <button className="btn btn--ghost" onClick={()=>save({...session,copy:session.copy===session.job.documents.length?0:session.copy,attempt:crypto.randomUUID(),awaiting:false,message:'พร้อมพิมพ์ · ตรวจใบที่ออกแล้วก่อนส่งซ้ำ'})}>เตรียมพิมพ์อีกครั้ง</button>}
          <button className="btn btn--ghost" onClick={()=>setSettings(true)}>ตั้งค่าเครื่องพิมพ์</button>
        </div>
        {session.mode==='passprnt' && <p>เลือก TSP143IIIU ใน Star PassPRNT และต่อสาย USB ก่อนพิมพ์; ระบบจะกลับมาที่ POS หลังพิมพ์แต่ละใบ</p>}
        <iframe className="print-preview" title={session.job.title ?? "ตัวอย่างใบเสร็จ"} sandbox="" srcDoc={session.job.documents[copyIndex]} />
        {!session.job.title && <p className="muted">การพิมพ์ซ้ำใช้บิลเดิมและไม่รับเงินซ้ำ</p>}
      </>}
    </PrintDialog>}
  </>;
}
function PrintDialog({children,onClose}:{children:React.ReactNode;onClose:()=>void}) {
  const ref=useDialogFocus(onClose);
  return <div className="modal-backdrop" style={{position:'fixed',inset:0,zIndex:10002,display:'flex',alignItems:'center',justifyContent:'center',background:'#0007'}}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="print-title" className="panel print-dialog">{children}</div></div>;
}
