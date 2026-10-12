import { useRouteError } from "react-router-dom";
import { isChunkLoadError } from "../utils/lazyRoute";

/** Replaces React Router's default "Unexpected Application Error!" screen. */
export default function RouteErrorPage() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const title = chunk ? (offline ? "ไม่มีอินเทอร์เน็ต โหลดหน้านี้ไม่ได้" : "มีเวอร์ชันใหม่ของระบบ") : "เกิดข้อผิดพลาด";
  const detail = chunk
    ? offline ? "ตรวจการเชื่อมต่อแล้วกดโหลดใหม่" : "กดโหลดใหม่เพื่อใช้เวอร์ชันล่าสุด ข้อมูลที่บันทึกแล้วไม่หาย"
    : error instanceof Error ? error.message : "กรุณาโหลดหน้าใหม่อีกครั้ง";

  return (
    <div role="alert" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg-page, #f4f4ef)", color: "var(--text-primary, #1d1d1b)" }}>
      <div style={{ maxWidth: 420, textAlign: "center", display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>{title}</h1>
        <p style={{ margin: 0, color: "var(--text-secondary, #555)" }}>{detail}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="btn btn--primary" onClick={() => window.location.reload()}>โหลดใหม่</button>
          <button className="btn btn--ghost" onClick={() => window.location.assign("/pos")}>ไปหน้าขาย</button>
        </div>
      </div>
    </div>
  );
}
