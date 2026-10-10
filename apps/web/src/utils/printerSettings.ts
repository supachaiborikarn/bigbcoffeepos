import { isNativePrintAvailable } from './nativePrinter';
import { isRawbtEnabled } from './rawbtPrinter';

export type PrinterMode = 'browser' | 'passprnt' | 'native' | 'rawbt';
export function isIOSDevice() {
  return typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}
export function isAndroidDevice() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}
export function getPrinterMode(): PrinterMode {
  if (isNativePrintAvailable()) return 'native';
  let saved: string | null = null;
  try { saved = localStorage.getItem('bbpos.print.mode'); } catch { /* defaults */ }
  if (saved === 'browser') return 'browser';
  if (saved === 'passprnt' && isIOSDevice()) return 'passprnt';
  if (isRawbtEnabled()) return 'rawbt';
  // iOS requires an explicit PassPRNT setup; existing AirPrint users retain their route.
  return 'browser';
}
export function setPrinterMode(mode: PrinterMode) {
  localStorage.setItem('bbpos.print.mode', mode);
  localStorage.setItem('bbpos.print.rawbt', mode === 'rawbt' ? '1' : '0');
  window.dispatchEvent(new Event('bbpos-printer-settings'));
}
// Thermal heads can't print the full roll: a 58 mm roll prints ~48 mm and an
// 80 mm roll ~72 mm. Slips are laid out at the printable width (centred on the
// roll) plus a small inner gutter, otherwise edge characters get clipped.
export const PAPER_SPECS: Record<58 | 80, { printableMm: number; gutterMm: number; label: string; hint: string }> = {
  58: { printableMm: 48, gutterMm: 1.5, label: '58 มม.', hint: 'กระดาษเล็ก · พิมพ์ได้กว้าง 48 มม.' },
  80: { printableMm: 72, gutterMm: 2, label: '80 มม.', hint: 'กระดาษใหญ่ · พิมพ์ได้กว้าง 72 มม.' }
};
export function getPaperWidth(): 58 | 80 {
  try { return localStorage.getItem('bbpos.print.width') === '80' ? 80 : 58; } catch { return 58; }
}
export function setPaperWidth(width: 58 | 80) {
  localStorage.setItem('bbpos.print.width', String(width));
  window.dispatchEvent(new Event('bbpos-printer-settings'));
}
export const printerLabels: Record<PrinterMode, string> = {
  browser: 'พิมพ์ผ่านเบราว์เซอร์ / AirPrint', passprnt: 'Star PassPRNT · iPad USB', native: 'แอป iOS · Star USB', rawbt: 'RawBT · Android'
};
