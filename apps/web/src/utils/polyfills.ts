// Small polyfills for the older system WebView inside the Android app (HUAWEI MatePad T8).
// Imported first in main.tsx, before any module that might call them.

// crypto.randomUUID: Chromium 92+. Used for checkout idempotency keys and print attempts.
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function" && typeof crypto.getRandomValues === "function") {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    writable: true,
    value: function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
      const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
    },
  });
}

export {};
