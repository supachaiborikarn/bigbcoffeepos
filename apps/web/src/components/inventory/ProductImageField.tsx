import { useId, useState, type ChangeEvent } from "react";
import { ImagePlus, Trash2, Link2 } from "lucide-react";
import { compressProductImage, isUploadedImageUrl, resolveMenuImageUrl } from "../../utils/menuImage";

interface ProductImageFieldProps {
  value: string;
  onChange: (nextValue: string) => void;
  fallbackCode?: string | null;
  fallbackLabel?: string | null;
  disabled?: boolean;
  onError?: (message: string) => void;
}

export default function ProductImageField({
  value,
  onChange,
  fallbackCode,
  fallbackLabel,
  disabled,
  onError
}: ProductImageFieldProps) {
  const fileInputId = useId();
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [lastSizeKb, setLastSizeKb] = useState<number | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(() => Boolean(value.trim()) && !isUploadedImageUrl(value));

  const resolvedSrc = resolveMenuImageUrl(value);
  const hasImage = Boolean(resolvedSrc) && !previewError;
  const uploaded = isUploadedImageUrl(value);

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const { dataUrl, sizeKb } = await compressProductImage(file);
      setPreviewError(false);
      setLastSizeKb(sizeKb);
      setShowUrlInput(false);
      onChange(dataUrl);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "อ่านไฟล์รูปภาพไม่ได้");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="product-image-field">
      <div className="product-image-field__preview" aria-label="ตัวอย่างรูปสินค้า">
        {hasImage ? (
          <img
            src={resolvedSrc ?? ""}
            alt="รูปสินค้า"
            onError={() => setPreviewError(true)}
          />
        ) : (
          <span className="product-image-field__fallback">
            {fallbackCode ? (
              <strong>{fallbackCode.toUpperCase()}</strong>
            ) : fallbackLabel ? (
              <strong style={{ fontSize: 13 }}>{fallbackLabel}</strong>
            ) : (
              <ImagePlus size={22} aria-hidden="true" />
            )}
            <small>{fallbackCode ? "แสดงรหัสแทนรูป" : fallbackLabel ? "แสดงชื่อเมนูแทนรูป" : "ยังไม่มีรูป"}</small>
          </span>
        )}
      </div>

      <div className="product-image-field__controls">
        <div className="product-image-field__head">
          <strong>รูปสินค้า</strong>
          <small>
            {busy
              ? "กำลังย่อขนาดรูป..."
              : uploaded
                ? `ใช้รูปที่อัปโหลด${lastSizeKb ? ` (${lastSizeKb} KB)` : ""}`
                : value.trim()
                  ? "ใช้รูปจากลิงก์ภายนอก"
                  : fallbackCode
                    ? "ถ้ายังไม่ใส่รูป การ์ดจะแสดงรหัสสินค้าแทน"
                    : "ถ้ายังไม่ใส่รูป การ์ดจะแสดงชื่อเมนูแทน"}
          </small>
        </div>

        <div className="product-image-field__actions">
          <label
            htmlFor={fileInputId}
            className={`btn btn--ghost product-image-field__pick${disabled || busy ? " is-disabled" : ""}`}
          >
            <ImagePlus size={16} aria-hidden="true" />
            <span>{busy ? "กำลังประมวลผล..." : hasImage ? "เปลี่ยนรูป / ถ่ายใหม่" : "เลือกรูป / ถ่ายรูป"}</span>
          </label>
          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            className="visually-hidden"
            disabled={disabled || busy}
            onChange={(e) => void handleFileSelect(e)}
          />

          <button
            type="button"
            className="btn btn--ghost"
            disabled={disabled || busy}
            onClick={() => setShowUrlInput((open) => !open)}
          >
            <Link2 size={15} aria-hidden="true" />
            <span>ใส่ลิงก์</span>
          </button>

          {value.trim() && (
            <button
              type="button"
              className="btn btn--ghost product-image-field__remove"
              disabled={disabled || busy}
              onClick={() => {
                setPreviewError(false);
                setLastSizeKb(null);
                onChange("");
              }}
              aria-label="ลบรูปสินค้า"
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>ลบรูป</span>
            </button>
          )}
        </div>

        {showUrlInput && (
          <input
            className="input product-image-field__url"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={uploaded ? "" : value}
            disabled={disabled || busy}
            onChange={(e) => {
              setPreviewError(false);
              setLastSizeKb(null);
              onChange(e.target.value);
            }}
            placeholder="วาง URL รูปสินค้า (https://...)"
            aria-label="URL รูปสินค้า"
          />
        )}
      </div>
    </div>
  );
}
