import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { flushOfflineOrders } from "./api";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    flushOfflineOrders().catch(() => undefined);
  });
  window.addEventListener("online", () => {
    flushOfflineOrders().catch(() => undefined);
  });
}
