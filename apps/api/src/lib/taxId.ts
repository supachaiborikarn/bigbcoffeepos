/**
 * Thai tax ID / citizen ID: 13 digits whose last digit is a mod-11 check digit
 * (sum of digit[i] * (13 - i) for the first 12, check = (11 - sum % 11) % 10).
 */
export function isValidThaiTaxId(raw: string) {
  if (!/^\d{13}$/.test(raw)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(raw[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(raw[12]);
}

/** Digits only; throws a Thai message when it isn't a valid 13-digit tax ID. */
export function normalizeThaiTaxId(raw: unknown, what = "เลขผู้เสียภาษี") {
  const digits = String(raw ?? "").replace(/[\s-]/g, "");
  if (!isValidThaiTaxId(digits)) throw new Error(`${what}ต้องเป็นตัวเลข 13 หลักที่ถูกต้อง`);
  return digits;
}
