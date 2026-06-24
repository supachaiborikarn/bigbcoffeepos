// ─── Native print bridge ───────────────────────────────────────────────────
// When this web POS runs inside the native iOS wrapper (WKWebView + Star SDK),
// receipts are printed through the Star printer SDK over USB instead of the
// browser's window.print()/AirPrint. The wrapper exposes a message handler at
// `window.webkit.messageHandlers.starPrint`. In a normal browser this bridge is
// absent, so callers fall back to the existing HTML print path automatically.
//
// See native/ios-wrapper/ for the companion iOS app that consumes this payload.

export interface NativeReceiptPayload {
  type: "receipt";
  /**
   * Fully-rendered receipt HTML (one document, already includes every copy).
   * The native wrapper renders this in an offscreen web view and prints the
   * resulting bitmap to the Star printer — this guarantees Thai text renders
   * exactly as designed, regardless of the printer's built-in fonts.
   */
  html: string;
  /** Width of the paper roll in millimetres (TSP100III = 58 or 80). */
  widthMm: number;
  /** Number of identical copies (e.g. office / shop / customer slips). */
  copies: number;
  /** Origin used as the base URL so receipt assets (logo) resolve in native. */
  baseUrl: string;
  billId: number | string;
}

interface WebkitMessageHandler {
  postMessage: (message: unknown) => void;
}

interface NativeBridgeWindow extends Window {
  webkit?: { messageHandlers?: { starPrint?: WebkitMessageHandler } };
  // Generic fallback hook (e.g. an Android wrapper or a custom shell).
  BBPOSNative?: { printReceipt?: (json: string) => void };
}

/** True when running inside a native wrapper that can drive the Star printer. */
export function isNativePrintAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as NativeBridgeWindow;
  return Boolean(w.webkit?.messageHandlers?.starPrint) || Boolean(w.BBPOSNative?.printReceipt);
}

/** Send a receipt to the native printer bridge. Returns false if unavailable/failed. */
export function sendReceiptToNative(payload: NativeReceiptPayload): boolean {
  if (typeof window === "undefined") return false;
  const w = window as NativeBridgeWindow;
  try {
    if (w.webkit?.messageHandlers?.starPrint) {
      w.webkit.messageHandlers.starPrint.postMessage(payload);
      return true;
    }
    if (w.BBPOSNative?.printReceipt) {
      w.BBPOSNative.printReceipt(JSON.stringify(payload));
      return true;
    }
  } catch (error) {
    console.error("[POS] native print bridge failed", error);
  }
  return false;
}
