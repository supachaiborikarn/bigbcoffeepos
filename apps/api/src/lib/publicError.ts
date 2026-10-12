import { log } from "../logger.js";

/**
 * The message a user may see for a failed request. Our own thrown errors are
 * already written for people (Thai, specific). Database/driver errors (Prisma
 * "Invalid `prisma.x.create()` invocation … Unique constraint failed …") are
 * mapped to a plain Thai sentence and logged in full instead of being shown.
 */
export function publicError(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown; name?: unknown; meta?: { target?: unknown; field_name?: unknown } };
  const message = typeof e?.message === "string" ? e.message : "";
  const code = typeof e?.code === "string" ? e.code : "";
  const isDb = /^P\d{4}$/.test(code) || String(e?.name ?? "").startsWith("Prisma") || /prisma\.|Invalid `|invocation/i.test(message);
  if (!isDb) return message || "ทำรายการไม่สำเร็จ";

  log("error", "db_error_hidden_from_user", { code, message: message.slice(0, 2000) });
  switch (code) {
    case "P2002": return "ข้อมูลนี้มีอยู่แล้ว (ซ้ำกับรายการเดิม)";
    case "P2003": return "ข้อมูลที่อ้างถึงไม่มีอยู่ เช่น ยังไม่ได้เลือกสาขาหรือสินค้า";
    case "P2025": return "ไม่พบรายการนี้ อาจถูกลบหรือเปลี่ยนไปแล้ว";
    case "P2028": return "ระบบบันทึกใช้เวลานานเกินไป กรุณาลองส่งบิลเดิมใหม่";
    case "P2000": return "ข้อความยาวเกินกำหนด";
    default: return "บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่ หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ";
  }
}
