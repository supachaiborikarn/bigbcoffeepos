// Self-contained Code 128 (Set B) barcode renderer — no external dependencies.
// Produces an inline SVG string that scans on standard 1D scanners.

const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112"
];

const START_B = 104;
const STOP = 106;

/** Sanitize to printable ASCII (32..126) that Code 128 Set B can encode. */
export function sanitizeBarcodeValue(raw: string): string {
  let out = "";
  for (const ch of String(raw ?? "")) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out += ch;
  }
  return out;
}

/** Encode text into the sequence of Code 128 symbol values (Set B). */
function encodeValues(text: string): number[] {
  const values: number[] = [START_B];
  for (const ch of text) values.push(ch.charCodeAt(0) - 32);
  let checksum = START_B;
  for (let i = 1; i < values.length; i++) checksum += values[i] * i;
  checksum %= 103;
  values.push(checksum);
  values.push(STOP);
  return values;
}

export interface BarcodeSvgOptions {
  moduleWidth?: number; // px per narrowest module
  height?: number; // bar height in px
}

/**
 * Render a Code 128 (Set B) barcode as an SVG string.
 * Returns empty string when there is no encodable content.
 */
export function code128Svg(value: string, opts: BarcodeSvgOptions = {}): string {
  const text = sanitizeBarcodeValue(value);
  if (!text) return "";
  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 60;

  const values = encodeValues(text);
  let x = 0;
  const rects: string[] = [];
  for (const v of values) {
    const pattern = PATTERNS[v];
    for (let i = 0; i < pattern.length; i++) {
      const w = Number(pattern[i]) * moduleWidth;
      // even index = bar (black), odd index = space
      if (i % 2 === 0) {
        rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000" />`);
      }
      x += w;
    }
  }
  const totalWidth = x;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="xMidYMid meet">${rects.join("")}</svg>`;
}

export interface BarcodeLabel {
  name: string;
  code: string;
  price?: number | null;
  shopName?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/**
 * Open a print window with a grid of barcode stickers.
 * `copies` repeats each label. Returns false if the window was blocked.
 */
export function printBarcodeLabels(labels: BarcodeLabel[], copies = 1): boolean {
  const printable = labels.filter((l) => sanitizeBarcodeValue(l.code));
  if (printable.length === 0) return false;

  const reps = Math.max(1, Math.floor(copies));
  const cards: string[] = [];
  for (const label of printable) {
    const svg = code128Svg(label.code, { moduleWidth: 2, height: 48 });
    const priceHtml = label.price != null && Number.isFinite(label.price)
      ? `<div class="lbl-price">฿${formatPrice(Number(label.price))}</div>`
      : "";
    const shopHtml = label.shopName ? `<div class="lbl-shop">${escapeHtml(label.shopName)}</div>` : "";
    const card = `<div class="label">
      ${shopHtml}
      <div class="lbl-name">${escapeHtml(label.name)}</div>
      <div class="lbl-bc">${svg}</div>
      <div class="lbl-code">${escapeHtml(sanitizeBarcodeValue(label.code))}</div>
      ${priceHtml}
    </div>`;
    for (let i = 0; i < reps; i++) cards.push(card);
  }

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>พิมพ์บาร์โค้ด</title>
  <style>
    @page { margin: 6mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif; }
    .sheet { display: flex; flex-wrap: wrap; gap: 3mm; padding: 4mm; }
    .label {
      width: 48mm; height: 30mm;
      border: 1px dashed #bbb;
      padding: 1.5mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; overflow: hidden;
      page-break-inside: avoid;
    }
    .lbl-shop { font-size: 8px; color: #444; line-height: 1.1; }
    .lbl-name { font-size: 10px; font-weight: 600; line-height: 1.15; max-height: 22px; overflow: hidden; }
    .lbl-bc { margin: 1mm 0 0; }
    .lbl-bc svg { width: 100%; height: 12mm; }
    .lbl-code { font-size: 9px; letter-spacing: 1px; font-family: 'Courier New', monospace; }
    .lbl-price { font-size: 12px; font-weight: 700; }
    @media screen {
      body { background: #f3f4f6; }
      .sheet { background: #fff; max-width: 210mm; margin: 16px auto; box-shadow: 0 1px 6px rgba(0,0,0,0.15); }
    }
  </style>
</head>
<body>
  <div class="sheet">${cards.join("")}</div>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.focus(); window.print(); }, 150);
    });
  </script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=720,height=600");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}
