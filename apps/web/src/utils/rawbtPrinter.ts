// ─── RawBT print bridge (Android Bluetooth thermal printers) ────────────────
// A classic-Bluetooth ESC/POS printer paired in Android is invisible to the web
// platform, so a normal browser print can't reach it. RawBT — a free Android
// print service (https://rawbt.ru) — bridges that gap: a web page hands it the
// receipt through the `rawbt:` URL scheme and RawBT relays the bytes to the
// paired printer. We send the receipt as ESC/POS *text* (data:text/plain;base64)
// so RawBT converts the UTF-8 Thai to the printer's code page automatically.

const RAWBT_PACKAGE = "ru.a402d.rawbtprinter";
const STORAGE_KEY = "bbpos.print.rawbt"; // "1" = on, "0" = off, unset = auto

function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Whether receipts on THIS device should be routed to RawBT. The choice is
 * per-device (localStorage). When unset we auto-enable on Android — that's where
 * a paired Bluetooth printer + RawBT live — while desktops keep window.print().
 */
export function isRawbtEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* localStorage blocked — fall through to auto-detect */
  }
  return isAndroid();
}

/** Persist the per-device choice. Pass null to clear it (back to auto-detect). */
export function setRawbtEnabled(value: boolean | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Base64 of a UTF-8 string (so Thai characters survive the round-trip). */
function base64Utf8(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/**
 * Hand an ESC/POS text payload to RawBT via the Android intent scheme. If RawBT
 * isn't installed, the intent's package fallback opens its Play Store page.
 * Returns false only when we couldn't even attempt the hand-off.
 */
export function sendRawbtText(escposText: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const data = "data:text/plain;base64," + base64Utf8(escposText);
    const intentUrl =
      "intent:" + encodeURI(data) +
      "#Intent;scheme=rawbt;package=" + RAWBT_PACKAGE + ";end;";
    // Trigger inside the current user gesture (checkout click) via a transient
    // anchor so we don't disturb the SPA's history/navigation.
    const anchor = document.createElement("a");
    anchor.href = intentUrl;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => anchor.remove(), 1000);
    return true;
  } catch (error) {
    console.error("[POS] RawBT print failed", error);
    return false;
  }
}
