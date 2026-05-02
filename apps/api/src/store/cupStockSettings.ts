import prisma from "../prisma.js";

export const CUP_OPTIONS = ["แก้วเย็น", "แก้วเดินทาง", "แก้วทานร้าน", "แก้วมาเอง"] as const;
export type CupOption = typeof CUP_OPTIONS[number];

const CUP_OPTION_SET = new Set<string>(CUP_OPTIONS);
const DEFAULT_CUP_STOCK_INGREDIENTS: Record<CupOption, string[]> = {
  "แก้วเย็น": ["แก้วพลาสติก 16oz", "แก้วกาแฟป่าว"],
  "แก้วเดินทาง": ["แก้วร้อนแยก"],
  "แก้วทานร้าน": [],
  "แก้วมาเอง": []
};

type CupStockSettingInput = {
  cupOption: string;
  deductStock: boolean;
  items: Array<{ ingredientId: number; qty: number }>;
};

type CupStockRequirement = { ingredientId: number; qty: number };

export function isCupOption(value: string): value is CupOption {
  return CUP_OPTION_SET.has(value);
}

function roundQty(value: number) {
  return Math.round(value * 1000) / 1000;
}

function isMissingCupStockTableError(error: unknown) {
  const message = String((error as Error)?.message ?? error);
  return message.includes("cup_stock_settings") || message.includes("cup_stock_setting_items");
}

function normalizeSetting(setting: any, branchId: number) {
  return {
    cupOption: setting.cupOption as CupOption,
    deductStock: Boolean(setting.deductStock),
    configured: true,
    items: setting.items.map((item: any) => {
      const stock = item.ingredient.stocks?.[0];
      return {
        ingredientId: item.ingredientId,
        ingredientName: item.ingredient.name,
        unit: item.ingredient.unit,
        stockQty: stock?.stockQty ?? 0,
        reorderLevel: stock?.reorderLevel ?? 0,
        qty: item.qty
      };
    }),
    branchId
  };
}

async function getDefaultCupStockItems(branchId: number, cupOption: CupOption) {
  const names = DEFAULT_CUP_STOCK_INGREDIENTS[cupOption];
  let firstMatch: any = null;
  for (const name of names) {
    const ingredient = await prisma.ingredient.findFirst({
      where: { name },
      include: {
        stocks: {
          where: { branchId },
          select: { stockQty: true, reorderLevel: true }
        }
      }
    });
    if (!ingredient) continue;
    firstMatch ??= ingredient;
    if (ingredient.stocks?.[0]) break;
  }
  if (!firstMatch) return [];
  const stock = firstMatch.stocks?.[0];
  return [{
    ingredientId: firstMatch.id,
    ingredientName: firstMatch.name,
    unit: firstMatch.unit,
    stockQty: stock?.stockQty ?? 0,
    reorderLevel: stock?.reorderLevel ?? 0,
    qty: 1
  }];
}

export async function getCupStockSettings(branchId: number) {
  let settings: any[] = [];
  try {
    settings = await prisma.cupStockSetting.findMany({
      where: { branchId },
      include: {
        items: {
          include: {
            ingredient: {
              include: {
                stocks: {
                  where: { branchId },
                  select: { stockQty: true, reorderLevel: true }
                }
              }
            }
          },
          orderBy: { id: "asc" }
        }
      },
      orderBy: { id: "asc" }
    });
  } catch (error) {
    if (!isMissingCupStockTableError(error)) throw error;
  }

  const byCupOption = new Map(settings.map((setting) => [setting.cupOption, setting]));
  const result = [];
  for (const cupOption of CUP_OPTIONS) {
    const setting = byCupOption.get(cupOption);
    if (setting) {
      result.push(normalizeSetting(setting, branchId));
      continue;
    }
    const items = await getDefaultCupStockItems(branchId, cupOption);
    result.push({
      cupOption,
      deductStock: items.length > 0,
      configured: false,
      items,
      branchId
    });
  }
  return result;
}

export async function setCupStockSettings(branchId: number, settings: CupStockSettingInput[]) {
  const normalized = new Map<CupOption, CupStockSettingInput>();
  for (const setting of settings) {
    if (!isCupOption(setting.cupOption)) throw new Error("ชนิดแก้วไม่ถูกต้อง");
    const items = setting.items
      .map((item) => ({
        ingredientId: Number(item.ingredientId),
        qty: roundQty(Number(item.qty))
      }))
      .filter((item) => Number.isInteger(item.ingredientId) && item.ingredientId > 0 && Number.isFinite(item.qty) && item.qty > 0);
    if (setting.deductStock && items.length === 0) throw new Error(`เลือกวัตถุดิบสำหรับ ${setting.cupOption}`);
    normalized.set(setting.cupOption, {
      cupOption: setting.cupOption,
      deductStock: setting.deductStock,
      items
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const cupOption of CUP_OPTIONS) {
      const setting = normalized.get(cupOption) ?? { cupOption, deductStock: false, items: [] };
      const saved = await tx.cupStockSetting.upsert({
        where: {
          branchId_cupOption: {
            branchId,
            cupOption
          }
        },
        update: {
          deductStock: setting.deductStock
        },
        create: {
          branchId,
          cupOption,
          deductStock: setting.deductStock
        }
      });

      await tx.cupStockSettingItem.deleteMany({ where: { settingId: saved.id } });
      if (setting.deductStock && setting.items.length > 0) {
        await tx.cupStockSettingItem.createMany({
          data: setting.items.map((item) => ({
            settingId: saved.id,
            ingredientId: item.ingredientId,
            qty: item.qty
          })),
          skipDuplicates: true
        });
      }
    }
  });

  return getCupStockSettings(branchId);
}

async function resolveIngredientByNames(tx: any, names: string[], branchId: number) {
  let firstMatch: { id: number; name: string } | null = null;
  for (const name of names) {
    const ingredient = await tx.ingredient.findFirst({ where: { name }, select: { id: true, name: true } });
    if (!ingredient) continue;
    firstMatch ??= ingredient;
    const branchStock = await tx.ingredientStock.findUnique({
      where: {
        branchId_ingredientId: {
          branchId,
          ingredientId: ingredient.id
        }
      },
      select: { ingredientId: true }
    });
    if (branchStock) return ingredient;
  }
  return firstMatch;
}

export async function getCupStockRequirements(tx: any, branchId: number, cupOption: string) {
  const requirementsByOption = await getCupStockRequirementsByOption(tx, branchId, [cupOption]);
  return isCupOption(cupOption) ? requirementsByOption.get(cupOption) ?? [] : [];
}

export async function getCupStockRequirementsByOption(tx: any, branchId: number, cupOptions: string[]) {
  const validOptions = Array.from(new Set(cupOptions.filter(isCupOption)));
  const result = new Map<CupOption, CupStockRequirement[]>();
  validOptions.forEach((cupOption) => result.set(cupOption, []));
  if (validOptions.length === 0) return result;

  let settings: any[] = [];
  try {
    settings = await tx.cupStockSetting.findMany({
      where: {
        branchId,
        cupOption: { in: validOptions }
      },
      include: { items: true }
    });
  } catch (error) {
    if (!isMissingCupStockTableError(error)) throw error;
  }

  const configuredOptions = new Set<CupOption>();
  for (const setting of settings) {
    if (!isCupOption(setting.cupOption)) continue;
    configuredOptions.add(setting.cupOption);
    result.set(
      setting.cupOption,
      setting.deductStock
        ? setting.items
          .filter((item: any) => item.qty > 0)
          .map((item: any) => ({ ingredientId: item.ingredientId, qty: item.qty }))
        : []
    );
  }

  for (const cupOption of validOptions) {
    if (configuredOptions.has(cupOption)) continue;
    const ingredientNames = DEFAULT_CUP_STOCK_INGREDIENTS[cupOption];
    if (ingredientNames.length === 0) continue;
    const ingredient = await resolveIngredientByNames(tx, ingredientNames, branchId);
    if (!ingredient) throw new Error(`ไม่พบวัตถุดิบสำหรับตัวเลือกแก้ว: ${cupOption}`);
    result.set(cupOption, [{ ingredientId: ingredient.id, qty: 1 }]);
  }

  return result;
}
