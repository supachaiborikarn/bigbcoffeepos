import { API_URL } from "../api";

const MAX_RAW_FILE_BYTES = 12 * 1024 * 1024;
const MAX_ENCODED_CHARS = 420_000;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;

export function isUploadedImageUrl(value?: string | null): boolean {
  const trimmed = value?.trim() ?? "";
  return (
    trimmed.startsWith("data:image/") ||
    /^(?:https?:\/\/[^/]+)?(?:\/api)?\/menu\/\d+\/image(?:\?.*)?$/i.test(trimmed)
  );
}

export function resolveMenuImageUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/") || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/menu/")) {
    return `${API_URL.replace(/\/$/, "")}${trimmed}`;
  }
  if (trimmed.startsWith("/api/")) {
    const apiBase = API_URL.replace(/\/api\/?$/, "");
    return `${apiBase}${trimmed}`;
  }
  return trimmed;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("อ่านไฟล์รูปภาพไม่ได้ กรุณาเลือกรูปอื่น"));
    img.src = url;
  });
}

function renderJpeg(img: HTMLImageElement, maxSide: number, quality: number): string {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error("ขนาดรูปภาพไม่ถูกต้อง");
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("เบราว์เซอร์ไม่รองรับการย่อรูปภาพ");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function compressProductImage(file: File): Promise<{ dataUrl: string; sizeKb: number }> {
  const isImageMime = file.type.startsWith("image/");
  if (!isImageMime && !IMAGE_EXT_RE.test(file.name)) {
    throw new Error("รองรับเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP)");
  }
  if (!file.size) {
    throw new Error("ไฟล์รูปภาพว่าง กรุณาเลือกใหม่");
  }
  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error("ไฟล์ต้นฉบับใหญ่เกิน 12 MB กรุณาเลือกรูปที่เล็กลง");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    let dataUrl = renderJpeg(img, 480, 0.8);
    if (dataUrl.length > 220_000) dataUrl = renderJpeg(img, 440, 0.7);
    if (dataUrl.length > MAX_ENCODED_CHARS) dataUrl = renderJpeg(img, 360, 0.62);
    if (dataUrl.length > MAX_ENCODED_CHARS) {
      throw new Error("ย่อขนาดรูปไม่สำเร็จ กรุณาเลือกรูปอื่น");
    }
    const approxBytes = Math.round((dataUrl.length * 3) / 4);
    return { dataUrl, sizeKb: Math.max(1, Math.round(approxBytes / 1024)) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
