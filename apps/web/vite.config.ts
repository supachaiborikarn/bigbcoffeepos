import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Android app (native/android-wrapper) runs the POS in the tablet's system WebView,
// which on the oil bay's HUAWEI MatePad T8 is far older than the browsers Vite targets by
// default: it ignored every `@media (width<=999px)` rule Vite wrote, so no tablet layout
// applied. Build for Chromium 80 so CSS and JS keep the older, widely-read syntax.
const LEGACY_BROWSERS = ["chrome80", "safari14"];

export default defineConfig({
  plugins: [react()],
  build: {
    target: ["es2020", ...LEGACY_BROWSERS],
    cssTarget: LEGACY_BROWSERS,
  },
  server: {
    port: 5173
  }
});
