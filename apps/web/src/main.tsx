import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { flushOfflineOrders } from "./api";
import { preloadRoutes, reloadForNewBuild } from "./utils/lazyRoute";
import "./styles.css";
import "./studio.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

// A stale tab after a deploy: Vite fires this when a preloaded chunk 404s.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewBuild()) event.preventDefault();
});
window.addEventListener("load", preloadRoutes);

// Offline order sync: flush on load, when the network returns, and periodically.
window.addEventListener("load", () => {
  flushOfflineOrders().catch(() => undefined);
});
window.addEventListener("online", () => {
  flushOfflineOrders().catch(() => undefined);
});
window.setInterval(() => {
  if (navigator.onLine) flushOfflineOrders().catch(() => undefined);
}, 25_000);
