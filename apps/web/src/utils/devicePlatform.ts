/** Android tablets can hide "Android" when Chrome requests the desktop site. */
export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/Android/i.test(navigator.userAgent)) return true;
  if (/CrOS/i.test(navigator.userAgent)) return false;
  return navigator.maxTouchPoints > 1 && /Linux/i.test(`${navigator.userAgent} ${navigator.platform}`);
}
