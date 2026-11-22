// Epson TM Print Assistant uses ePOS-Print XML, matching the companion app used
// by credit billing on Pad 7. Translate only the command subset our slip builders
// emit so receipts, copies and shift summaries retain the same amounts/content.
const COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ['\x1b@', '<text align="left" em="false" width="1" height="1" />'],
  ['\x1ba\x00', '<text align="left" />'],
  ['\x1ba\x01', '<text align="center" />'],
  ['\x1bE\x01', '<text em="true" />'],
  ['\x1bE\x00', '<text em="false" />'],
  ['\x1d!\x11', '<text width="2" height="2" />'],
  ['\x1d!\x00', '<text width="1" height="1" />'],
  ['\x1dVB\x00', '<cut type="feed" />'],
];

function escapeText(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\n/g, '&#10;');
}

export function buildEpsonPrintXml(escpos: string): string {
  if (!escpos.trim()) throw new Error('ไม่มีข้อมูลใบเสร็จสำหรับพิมพ์');
  const parts = [
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    '<text lang="mul" font="font_a" smooth="true" linespc="24" />',
  ];
  let cursor = 0;
  while (cursor < escpos.length) {
    if (escpos[cursor] === '\x1b' || escpos[cursor] === '\x1d') {
      const command = COMMANDS.find(([bytes]) => escpos.startsWith(bytes, cursor));
      if (!command) throw new Error('รูปแบบใบเสร็จนี้ยังส่งไป Epson ไม่ได้ เลือกพิมพ์ผ่านเบราว์เซอร์');
      parts.push(command[1]);
      cursor += command[0].length;
    } else {
      const start = cursor;
      while (cursor < escpos.length && escpos[cursor] !== '\x1b' && escpos[cursor] !== '\x1d') cursor++;
      parts.push(`<text>${escapeText(escpos.slice(start, cursor))}</text>`);
    }
  }
  parts.push('</epos-print>');
  return parts.join('');
}

export function buildEpsonPrintUrl(escpos: string): string {
  const url = 'tmprintassistant://tmprintassistant.epson.com/print?ver=1&data-type=eposprintxml&data=' + encodeURIComponent(buildEpsonPrintXml(escpos));
  // Epson documents a 200 KB Android URL limit; leave room for OS overhead.
  if (url.length > 190_000) throw new Error('ใบเสร็จยาวเกินกว่าจะส่งเข้าแอป Epson กรุณาเลือกพิมพ์ผ่านเบราว์เซอร์');
  return url;
}

/** True means handed to the OS; only the Epson app/printer can confirm paper output. */
export function sendEpsonPrint(escpos: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const anchor = document.createElement('a');
  anchor.href = buildEpsonPrintUrl(escpos);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); }
  return true;
}
