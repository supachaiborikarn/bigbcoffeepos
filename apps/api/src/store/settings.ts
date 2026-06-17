import prisma from "../prisma.js";

export type VatMode = "INCLUSIVE" | "EXCLUSIVE" | "NONE";

export interface StoreSettingDTO {
  branchId: number;
  shopName: string;
  taxId: string;
  branchLabel: string;
  addressLine: string;
  phone: string;
  receiptHeader: string;
  receiptFooter: string;
  vatMode: VatMode;
  vatRate: number;
  paymentMethods: string[];
  allowNegativeStock: boolean;
}

export interface StoreSettingInput {
  shopName?: string;
  taxId?: string;
  branchLabel?: string;
  addressLine?: string;
  phone?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  vatMode?: VatMode;
  vatRate?: number;
  paymentMethods?: string[];
  allowNegativeStock?: boolean;
}

const DEFAULT_PAYMENT_METHODS = ["CASH", "QR", "CARD"];
const VALID_PAYMENT_METHODS = new Set(["CASH", "QR", "CARD", "EWALLET"]);

function parsePaymentMethods(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      const filtered = arr.filter((x): x is string => typeof x === "string" && VALID_PAYMENT_METHODS.has(x));
      if (filtered.length > 0) return filtered;
    }
  } catch {
    // fall through to default
  }
  return [...DEFAULT_PAYMENT_METHODS];
}

function normalizeVatMode(value: string): VatMode {
  return value === "EXCLUSIVE" || value === "NONE" ? value : "INCLUSIVE";
}

type StoreSettingRow = {
  branchId: number;
  shopName: string;
  taxId: string;
  branchLabel: string;
  addressLine: string;
  phone: string;
  receiptHeader: string;
  receiptFooter: string;
  vatMode: string;
  vatRate: number;
  paymentMethods: string;
  allowNegativeStock?: boolean;
};

function toDTO(row: StoreSettingRow): StoreSettingDTO {
  return {
    branchId: row.branchId,
    shopName: row.shopName,
    taxId: row.taxId,
    branchLabel: row.branchLabel,
    addressLine: row.addressLine,
    phone: row.phone,
    receiptHeader: row.receiptHeader,
    receiptFooter: row.receiptFooter,
    vatMode: normalizeVatMode(row.vatMode),
    vatRate: row.vatRate,
    paymentMethods: parsePaymentMethods(row.paymentMethods),
    allowNegativeStock: Boolean(row.allowNegativeStock)
  };
}

function defaults(branchId: number): StoreSettingDTO {
  return {
    branchId,
    shopName: "",
    taxId: "",
    branchLabel: "",
    addressLine: "",
    phone: "",
    receiptHeader: "",
    receiptFooter: "ขอบคุณที่ใช้บริการ",
    vatMode: "INCLUSIVE",
    vatRate: 7,
    paymentMethods: [...DEFAULT_PAYMENT_METHODS],
    allowNegativeStock: false
  };
}

export async function getStoreSetting(branchId: number): Promise<StoreSettingDTO> {
  const row = await prisma.storeSetting.findUnique({ where: { branchId } });
  if (!row) return defaults(branchId);
  return toDTO(row);
}

export async function updateStoreSetting(branchId: number, input: StoreSettingInput): Promise<StoreSettingDTO> {
  const data: Record<string, unknown> = {};
  if (input.shopName !== undefined) data.shopName = input.shopName;
  if (input.taxId !== undefined) data.taxId = input.taxId;
  if (input.branchLabel !== undefined) data.branchLabel = input.branchLabel;
  if (input.addressLine !== undefined) data.addressLine = input.addressLine;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.receiptHeader !== undefined) data.receiptHeader = input.receiptHeader;
  if (input.receiptFooter !== undefined) data.receiptFooter = input.receiptFooter;
  if (input.vatMode !== undefined) data.vatMode = normalizeVatMode(input.vatMode);
  if (input.vatRate !== undefined) data.vatRate = input.vatRate;
  if (input.paymentMethods !== undefined) {
    const cleaned = input.paymentMethods.filter((x) => VALID_PAYMENT_METHODS.has(x));
    data.paymentMethods = JSON.stringify(cleaned.length > 0 ? cleaned : DEFAULT_PAYMENT_METHODS);
  }
  if (input.allowNegativeStock !== undefined) data.allowNegativeStock = input.allowNegativeStock;

  // Cast to any so the build passes before `prisma generate` adds the new column type.
  const row = await (prisma as any).storeSetting.upsert({
    where: { branchId },
    create: { branchId, ...data },
    update: data
  });
  return toDTO(row);
}
