import crypto from "crypto";

export const MAX_MENU_IMAGE_BYTES = 600 * 1024;
const DATA_IMAGE_RE = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

export interface ParsedMenuDataImage {
  mime: string;
  buffer: Buffer;
  version: string;
}

export function isDataImageUrl(value?: string | null): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

export function menuImageVersion(raw: string): string {
  // Matches PostgreSQL `left(md5(image_url), 10)` so list queries never need to
  // pull base64 blobs over the DB connection just to compute a cache buster.
  return crypto.createHash("md5").update(raw, "utf8").digest("hex").slice(0, 10);
}

export function publicMenuImageUrl(id: number, raw?: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (isDataImageUrl(trimmed)) {
    return `/menu/${id}/image?v=${menuImageVersion(trimmed)}`;
  }
  return trimmed;
}

export function isSelfMenuImageUrl(id: number, value?: string | null): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  const pattern = new RegExp(`^(?:https?:\\/\\/[^/]+)?(?:\\/api)?\\/menu\\/${id}\\/image(?:\\?.*)?$`, "i");
  return pattern.test(trimmed);
}

export function parseMenuDataImage(raw?: string | null): ParsedMenuDataImage | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = DATA_IMAGE_RE.exec(trimmed);
  if (!match) return null;
  const rawMime = match[1].toLowerCase();
  const mime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  const base64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_MENU_IMAGE_BYTES) return null;
  return {
    mime,
    buffer,
    version: menuImageVersion(trimmed)
  };
}

export function validateMenuImageInput(raw?: string | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith("data:")) {
    const match = DATA_IMAGE_RE.exec(trimmed);
    if (!match) {
      throw new Error("รองรับเฉพาะรูปภาพ JPEG, PNG หรือ WebP");
    }
    const rawMime = match[1].toLowerCase();
    const mime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
    const base64 = match[2].replace(/\s+/g, "");
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) {
      throw new Error("ไฟล์รูปภาพว่าง กรุณาเลือกรูปใหม่");
    }
    if (buffer.length > MAX_MENU_IMAGE_BYTES) {
      throw new Error("รูปภาพต้องมีขนาดไม่เกิน 600 KB");
    }
    return `data:${mime};base64,${base64}`;
  }

  if (trimmed.length > 2048) {
    throw new Error("URL รูปภาพยาวเกินไป");
  }
  if (/^https?:\/\//i.test(trimmed) || (trimmed.startsWith("/") && !trimmed.startsWith("//"))) {
    return trimmed;
  }
  throw new Error("URL รูปภาพไม่ถูกต้อง (ต้องขึ้นต้นด้วย https:// หรืออัปโหลดไฟล์รูป)");
}

export function serializeMenuItem<T extends { id: number; imageUrl?: string | null }>(item: T): T {
  return {
    ...item,
    imageUrl: publicMenuImageUrl(item.id, item.imageUrl)
  };
}
