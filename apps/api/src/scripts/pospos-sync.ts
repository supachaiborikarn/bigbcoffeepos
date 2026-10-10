import { chromium as playwrightChromium, type Browser, type Page } from "playwright";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma.js";
import { classifyMenuItem } from "../utils/menu-data-cleaning.js";
import { CUP_STOCK_INGREDIENT_NAMES } from "../store/cupStockSettings.js";
import { decideStock, FAKE_STOCK_THRESHOLD, fromPosposJson, parsePosposQuantity, type PosposStockRow } from "../utils/posposStock.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Paginate through a POSPOS table, extracting rows via `extractFn` */
async function scrapeTable(page: Page, extractFn: () => any[], label: string, maxRows = 10000): Promise<any[]> {
  const allData: any[] = [];

  const selects = await page.locator("select").all();
  for (const sel of selects) {
    if (await sel.isVisible()) {
      try { await sel.selectOption("100"); await page.waitForTimeout(2000); } catch {}
    }
  }

  const searchBtn = page.getByRole("button", { name: /ค้นหา/ }).first();
  if (await searchBtn.isVisible().catch(() => false)) {
    await searchBtn.click();
    await page.waitForTimeout(5000);
  }

  let hasNext = true;
  while (hasNext) {
    const pageData = await page.evaluate(extractFn);
    allData.push(...pageData);
    process.stdout.write(`\r  ${label}: ${allData.length} rows...`);

    const nextBtn = page.getByText("ถัดไป", { exact: true });
    if (await nextBtn.count() > 0) {
      const disabled = await nextBtn.evaluate(
        (b) => b.classList.contains("disabled") || b.hasAttribute("disabled") || b.parentElement?.classList.contains("disabled")
      );
      if (!disabled) { await nextBtn.click(); await page.waitForTimeout(2000); }
      else hasNext = false;
    } else hasNext = false;
    if (allData.length >= maxRows) break;
  }
  console.log(`\n  ✓ ${label}: ${allData.length} rows total`);
  return allData;
}

/** Map POSPOS payment text to our enum */
function mapPayment(text: string): "CASH" | "QR" | "CARD" {
  const t = text.trim().toLowerCase();
  if (t.includes("โอน") || t.includes("qr") || t.includes("พร้อมเพย์")) return "QR";
  if (t.includes("บัตร") || t.includes("credit") || t.includes("card")) return "CARD";
  return "CASH";
}

/** Parse Thai date string "28/04/2026 วันนี้ 07:11:49" → ISO Date */
function parseThaiDate(raw: string): Date | null {
  try {
    const cleaned = raw.replace(/วันนี้|เมื่อวาน|yesterday|today/gi, "").trim();
    const match = cleaned.match(/(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2}:\d{2})?/);
    if (!match) return null;
    const [, dd, mm, yyyy, time] = match;
    return new Date(`${yyyy}-${mm}-${dd}T${time || "00:00:00"}`);
  } catch { return null; }
}

function normalizeStaffName(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

function pickString(input: any, keys: string[]) {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && typeof value.url === "string" && value.url.trim()) return value.url.trim();
    if (value && typeof value === "object" && typeof value.name === "string" && value.name.trim()) return value.name.trim();
  }
  return null;
}

function parseOptionalNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const SALES_ONLY_ITEM_NAME = "POSPOS sales-only record";

// ── Branch Mapping ───────────────────────────────────────────────────────────

const BRANCH_MAP: Record<number, string> = {
  1: "สาขา วัชรเกียรติ",
  3: "BigB Coffee สาขา ศุภชัย",
  4: "บ่อถ่ายน้ำมันเครื่อง",
};

const BRANCH_KEYWORDS: Record<number, string> = {
  1: "วัชรเกียรติ",
  3: "ศุภชัย",
  4: "บ่อถ่าย",
};

const BRANCH_TYPE_MAP: Record<number, string> = {
  1: "coffee",
  3: "coffee",
  4: "oil_service",
};

type PosposPreparedSale = {
  userId: number | null;
  subtotal: number;
  discountAmount: number;
  total: number;
  paymentMethod: "CASH" | "QR" | "CARD";
  createdAt: Date;
  note: string;
};

/**
 * Remove only orders this sync imported earlier (single "POSPOS sales-only
 * record" line) so a re-sync replaces them. Orders rung up in BB POS itself and
 * all shifts are never touched — BB POS now takes real sales alongside POSPOS.
 */
async function deleteImportedPosposOrders(tx: Prisma.TransactionClient, branchId: number, salesOnlyItemId: number) {
  const orders = await tx.order.findMany({
    where: { branchId, items: { some: {}, every: { menuItemId: salesOnlyItemId } } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  if (orderIds.length > 0) {
    await tx.integrationOutbox.deleteMany({ where: { entityType: "order", entityId: { in: orderIds } } });
    await tx.taxInvoice.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  return { orders: orderIds.length, shifts: 0 };
}

/** Page through POSPOS's stock list via the JSON the stock page itself loads. */
async function readStockJson(page: Page): Promise<PosposStockRow[] | null> {
  const rows: PosposStockRow[] = [];
  try {
    const isStockSearch = (r: { url(): string; request(): { method(): string } }) => r.url().includes("/product/pagination/search/v2") && r.request().method() === "POST";
    for (let pageNo = 1; pageNo <= 50; pageNo++) {
      let responsePromise = page.waitForResponse(isStockSearch, { timeout: 8000 });
      await page.goto(`https://go.pospos.co/core/stock?page=${pageNo}&limit=100`);
      let response = await responsePromise.catch(() => null);
      if (!response) {
        // The first visit to the stock page doesn't load until "ค้นหา" is pressed.
        responsePromise = page.waitForResponse(isStockSearch, { timeout: 20000 });
        await page.getByRole("button", { name: /ค้นหา/ }).first().click();
        response = await responsePromise;
      }
      const request = JSON.parse(response.request().postData() || "{}");
      if (Number(request.page) !== pageNo || Number(request.limit) !== 100) return null; // app ignored our paging → use fallback
      const data = ((await response.json())?.data ?? []) as any[];
      data.forEach((p) => { const row = fromPosposJson(p); if (row) rows.push(row); });
      process.stdout.write(`\r  Stock JSON: ${rows.length} rows...`);
      if (data.length < 100) break;
    }
    console.log("");
    return rows.length ? rows : null;
  } catch (error) {
    console.log(`\n  ⚠ Stock JSON failed: ${(error as Error).message}`);
    return null;
  }
}

/** POSPOS product code → BB POS ingredient, so renames in POSPOS don't create duplicates. */
async function ensureLinkTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pospos_links (
      kind TEXT NOT NULL,
      code TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, code)
    )
  `);
}

async function applyStockRows(branchId: number, branchType: string, rows: PosposStockRow[]) {
  await ensureLinkTable();
  const links = new Map((await prisma.$queryRaw<Array<{ code: string; local_id: number }>>`SELECT code, local_id FROM pospos_links WHERE kind = 'ingredient'`).map((r) => [r.code, r.local_id]));
  const cupIds = new Set((await prisma.ingredient.findMany({
    where: { OR: [{ name: { in: CUP_STOCK_INGREDIENT_NAMES } }, { cupStockSettingItems: { some: {} } }] },
    select: { id: true },
  })).map((row) => row.id));
  const skipped: Record<string, number> = {};
  let updated = 0;

  for (const row of rows) {
    // Remember which menus require a cup topping in POSPOS (used by the POS picker).
    if (row.code && row.cupToppings.length) {
      const menu = await prisma.menuItem.findFirst({ where: { sku: row.code, branchType }, select: { id: true, metadata: true } });
      if (menu) {
        let meta: any = {};
        try { meta = JSON.parse(menu.metadata || "{}"); } catch { meta = {}; }
        if (JSON.stringify(meta?.pospos?.cupToppings ?? []) !== JSON.stringify(row.cupToppings)) {
          meta.pospos = { ...(meta.pospos ?? {}), cupToppings: row.cupToppings };
          await prisma.menuItem.update({ where: { id: menu.id }, data: { metadata: JSON.stringify(meta) } });
        }
      }
    }
    if (row.unlimited || row.stock >= FAKE_STOCK_THRESHOLD) { skipped.unlimited = (skipped.unlimited ?? 0) + 1; continue; }

    let ingredientId = row.code ? links.get(row.code) : undefined;
    if (ingredientId && !(await prisma.ingredient.findUnique({ where: { id: ingredientId }, select: { id: true } }))) ingredientId = undefined;
    if (!ingredientId) {
      const byName = await prisma.ingredient.findMany({ where: { name: row.name }, select: { id: true } });
      if (byName.length > 1) { skipped.ambiguous = (skipped.ambiguous ?? 0) + 1; continue; }
      ingredientId = byName[0]?.id;
    }
    if (!ingredientId) {
      if (row.stock <= 0) { skipped.zero_or_negative = (skipped.zero_or_negative ?? 0) + 1; continue; }
      ingredientId = (await prisma.ingredient.create({ data: { name: row.name, unit: row.unit, costPerUnit: row.cost } })).id;
    } else if (!cupIds.has(ingredientId)) {
      await prisma.ingredient.update({ where: { id: ingredientId }, data: { costPerUnit: row.cost, unit: row.unit } });
    }
    if (row.code) {
      await prisma.$executeRaw`INSERT INTO pospos_links (kind, code, local_id) VALUES ('ingredient', ${row.code}, ${ingredientId})
        ON CONFLICT (kind, code) DO UPDATE SET local_id = EXCLUDED.local_id, updated_at = now()`;
    }

    const stock = await prisma.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId, ingredientId } } });
    const decision = decideStock(row, stock?.stockQty ?? null, cupIds.has(ingredientId));
    if (decision.action === "skip") { skipped[decision.reason] = (skipped[decision.reason] ?? 0) + 1; continue; }
    await prisma.$transaction(async (tx) => {
      await tx.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId, ingredientId: ingredientId! } },
        update: { stockQty: decision.to },
        create: { branchId, ingredientId: ingredientId!, stockQty: decision.to, reorderLevel: 0 },
      });
      await tx.stockMovement.create({ data: { branchId, ingredientId: ingredientId!, qty: Math.round((decision.to - decision.from) * 1000) / 1000, reason: `COUNT: ซิงค์ POSPOS ${decision.to} (ระบบ ${decision.from})` } });
    });
    updated++;
  }
  return { updated, skipped };
}

// ── Main Sync Function ───────────────────────────────────────────────────────

async function launchSyncBrowser(): Promise<Browser> {
  const isServerless = process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!isServerless) return playwrightChromium.launch({ headless: true });

  const chromium = (await import("@sparticuz/chromium")).default;
  return playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export async function syncPosposData(branchId: number) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  POSPOS Sync — Branch ${branchId}`);
  console.log(`${"═".repeat(60)}`);

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new Error("Branch not found");
  const posposEmail = process.env.POSPOS_EMAIL;
  const posposPassword = process.env.POSPOS_PASSWORD;
  if (!posposEmail || !posposPassword) {
    throw new Error("POSPOS_EMAIL and POSPOS_PASSWORD are required for POSPOS sync");
  }

  const browser = await launchSyncBrowser();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const results = {
    menuItems: 0,
    ingredients: 0,
    customers: 0,
    sales: 0,
    replacedOrders: 0,
    replacedShifts: 0,
    zeroedStockItems: 0,
    stockSkipped: {} as Record<string, number>,
  };

  // Intercept product API response
  let productApiData: any[] | null = null;
  let categoryApiData: any[] | null = null;

  page.on("response", async (response) => {
    const url = response.url();
    try {
      if (url.includes("product/shop/pagination") && response.status() === 200) {
        const json = await response.json();
        productApiData = json.data || [];
      }
      if (url.includes("/api/v1/category") && response.status() === 200 && !categoryApiData) {
        const json = await response.json();
        categoryApiData = json.data || [];
      }
    } catch {}
  });

  try {
    // ── 1. Login ──
    console.log("\n[1/6] Logging into POSPOS...");
    await page.goto("https://go.pospos.co/");
    await page.fill('input[type="email"], input[name="email"]', posposEmail);
    await page.fill('input[type="password"], input[name="password"]', posposPassword);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);

    // ── 2. Select Branch ──
    const targetName = BRANCH_MAP[branchId] || branch.name;
    console.log(`[2/6] Selecting branch: ${targetName}...`);
    try {
      await page.locator(`text="${targetName}"`).first().click({ timeout: 5000 });
      await page.waitForTimeout(5000);
    } catch {
      const kw = BRANCH_KEYWORDS[branchId];
      if (kw) {
        try {
          await page.locator(`text="${kw}"`).first().click({ timeout: 5000 });
          await page.waitForTimeout(5000);
        } catch { console.log("  ⚠ Could not select branch, assuming already selected."); }
      }
    }

    // ── 3. Scrape Products via API (by visiting Shop page) ──
    console.log("[3/6] Loading products via API (visiting Shop page)...");
    await page.goto("https://go.pospos.co/core/shop", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    const branchType = BRANCH_TYPE_MAP[branchId] || branch.branchType || "coffee";

    const apiData = productApiData as any[] | null;
    if (apiData && apiData.length > 0) {
      console.log(`  ✓ Got ${apiData.length} products from API`);

      for (const p of apiData) {
        const name = (p.name || "").trim();
        if (!name || p.delete) continue;

        const price = parseFloat(p.price) || 0;
        const cost = parseFloat(p.cost) || 0;
        const barcode = p.barcode_code || null;
        const sku = p.code ? String(p.code) : null;
        const rawCategoryName = p.category?.name || "ไม่ระบุ";
        const imageUrl = pickString(p, ["image_url", "imageUrl", "image", "photo", "picture", "thumbnail"]);
        const unit = pickString(p, ["unit", "unit_name", "sell_unit", "product_unit", "stock_unit"]);
        const taxRate = parseOptionalNumber(p.tax_rate ?? p.taxRate ?? p.vat_rate ?? p.vat);
        const sourceId = p.id ? String(p.id) : (p.product_id ? String(p.product_id) : sku);
        const metadata = JSON.stringify({
          pospos: {
            categoryName: rawCategoryName,
            categoryId: p.category_id ?? p.category?.id ?? null,
            hasImage: Boolean(imageUrl),
            unit,
            taxRate,
          },
        });
        const classification = classifyMenuItem({
          name,
          category: rawCategoryName,
          branchType,
          basePrice: price,
          active: true,
          metadata
        });

        // Upsert into menu_items
        const existing = await prisma.menuItem.findFirst({
          where: { name, branchType },
        });

        if (existing) {
          await prisma.menuItem.update({
            where: { id: existing.id },
            data: {
              basePrice: price,
              cost,
              barcode,
              sku,
              category: classification.category,
              imageUrl,
              unit,
              taxRate,
              source: "pospos",
              sourceId,
              optionGroup: classification.optionGroup,
              optionLabel: classification.optionLabel,
              metadata,
              active: classification.active,
            },
          });
        } else {
          await prisma.menuItem.create({
            data: { name, basePrice: price, cost, barcode, sku, category: classification.category, imageUrl, unit, taxRate, source: "pospos", sourceId, optionGroup: classification.optionGroup, optionLabel: classification.optionLabel, metadata, branchType, active: classification.active },
          });
        }
        results.menuItems++;
      }
      console.log(`  ✓ Synced ${results.menuItems} menu items (with selling prices)`);
    } else {
      console.log("  ⚠ No product API data captured, skipping menu items.");
    }

    // ── 4. Stock (POSPOS JSON, exact numbers; HTML table as fallback) ──
    console.log("[4/6] Reading stock...");
    let stockRows = await readStockJson(page);
    if (!stockRows) {
      console.log("  ⚠ Stock JSON not captured, falling back to the HTML table");
      await page.goto("https://go.pospos.co/core/stock", { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);
      const html = await scrapeTable(page, () => {
        const rows = Array.from(document.querySelectorAll("table tbody tr"));
        return rows.map((tr) => {
          const tds = tr.querySelectorAll("td");
          return {
            name: (tds[3] as HTMLElement)?.innerText?.trim() || "",
            cost: (tds[5] as HTMLElement)?.innerText?.trim().replace(/[^0-9.]/g, "") || "0",
            stockUnit: (tds[6] as HTMLElement)?.innerText?.trim() || "",
          };
        }).filter((c) => c.name);
      }, "Stock");
      stockRows = html.map((row) => ({
        code: null,
        name: row.name,
        stock: parsePosposQuantity(row.stockUnit),
        unlimited: false,
        unit: row.stockUnit.split(/\s+/)[1] || "ชิ้น",
        cost: parseFloat(row.cost) || 0,
        cupToppings: [],
      }));
    }

    const stockResult = await applyStockRows(branchId, branchType, stockRows);
    results.ingredients = stockResult.updated;
    results.stockSkipped = stockResult.skipped;
    console.log(`  ✓ Stock: ${stockResult.updated} updated, skipped ${JSON.stringify(stockResult.skipped)} (nothing zeroed)`);

    // ── 5. Scrape Customers ──
    console.log("[5/6] Scraping Customers...");
    await page.goto("https://go.pospos.co/core/crm/member", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const customersData = await scrapeTable(page, () => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows.map((tr) => {
        const tds = tr.querySelectorAll("td");
        return {
          name: (tds[3] as HTMLElement)?.innerText?.trim() || "",
          phone: (tds[6] as HTMLElement)?.innerText?.trim() || "",
        };
      }).filter((c) => c.name && c.phone);
    }, "Customers");

    for (const row of customersData) {
      const name = row.name;
      const phone = String(row.phone).replace(/[^0-9]/g, "");
      if (name && phone) {
        await prisma.customer.upsert({
          where: { phone },
          update: { name },
          create: { name, phone, points: 0 },
        });
        results.customers++;
      }
    }
    console.log(`  ✓ Saved ${results.customers} customers`);

    // ── 6. Scrape Sales History ──
    console.log("[6/6] Scraping Sales History...");
    await page.goto("https://go.pospos.co/core/sale/transaction/list", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const salesData = await scrapeTable(page, () => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows.map((tr) => {
        const tds = tr.querySelectorAll("td");
        return {
          itemCount: (tds[0] as HTMLElement)?.innerText?.trim() || "",
          receiptNo: (tds[1] as HTMLElement)?.innerText?.trim().replace(/^#\s*/, "") || "",
          staff: (tds[4] as HTMLElement)?.innerText?.trim() || "",
          date: (tds[5] as HTMLElement)?.innerText?.trim() || "",
          discount: (tds[7] as HTMLElement)?.innerText?.trim() || "",
          total: (tds[8] as HTMLElement)?.innerText?.trim().replace(/[^0-9.]/g, "") || "0",
          paymentMethod: (tds[9] as HTMLElement)?.innerText?.trim() || "",
          status: (tds[10] as HTMLElement)?.innerText?.trim() || "",
        };
      }).filter((c) => c.receiptNo);
    }, "Sales");

    const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } });
    const userByStaffName = new Map(users.map((user) => [normalizeStaffName(user.name), user]));
    const preparedSales: PosposPreparedSale[] = [];

    for (const row of salesData) {
      if (row.status !== "สำเร็จ") continue;
      const total = parseFloat(row.total) || 0;
      const discountStr = row.discount.replace(/[^0-9.]/g, "");
      const discountAmount = parseFloat(discountStr) || 0;
      const paymentMethod = mapPayment(row.paymentMethod);
      const createdAt = parseThaiDate(row.date) || new Date();
      const receiptContext = [
        row.receiptNo ? `receipt ${row.receiptNo}` : "",
        row.staff ? `staff ${row.staff}` : "",
      ].filter(Boolean).join(", ");
      const importNote = receiptContext
        ? `POSPOS ${receiptContext}: sales total only, no item detail`
        : "POSPOS sales total only, no item detail";
      const staffUser = row.staff ? userByStaffName.get(normalizeStaffName(row.staff)) : undefined;

      preparedSales.push({
        userId: staffUser?.id ?? null,
        subtotal: total + discountAmount,
        discountAmount,
        total,
        paymentMethod,
        createdAt,
        note: importNote,
      });
    }

    if (salesData.length > 0 && preparedSales.length > 0) {
      const salesOnlyItem = await prisma.menuItem.findFirst({
        where: { name: SALES_ONLY_ITEM_NAME, branchType },
        select: { id: true },
      }) ?? await prisma.menuItem.create({
        data: {
          name: SALES_ONLY_ITEM_NAME,
          category: "Imported POSPOS",
          basePrice: 0,
          cost: 0,
          branchType,
          active: false,
        },
        select: { id: true },
      });

      const replaceResult = await prisma.$transaction(async (tx) => {
        const deleted = await deleteImportedPosposOrders(tx, branchId, salesOnlyItem.id);
        let importedSales = 0;

        for (const sale of preparedSales) {
          await tx.order.create({
            data: {
              branchId,
              userId: sale.userId,
              status: "READY",
              subtotal: sale.subtotal,
              discountAmount: sale.discountAmount,
              total: sale.total,
              paymentMethod: sale.paymentMethod,
              createdAt: sale.createdAt,
              items: {
                create: [{
                  menuItemId: salesOnlyItem.id,
                  name: SALES_ONLY_ITEM_NAME,
                  qty: 1,
                  basePrice: sale.total,
                  modifiers: "[]",
                  lineTotal: sale.total,
                  note: sale.note,
                }],
              },
            },
          });
          importedSales++;
        }

        return { replacedOrders: deleted.orders, replacedShifts: deleted.shifts, importedSales };
      }, { maxWait: 10000, timeout: 120000 });

      results.replacedOrders = replaceResult.replacedOrders;
      results.replacedShifts = replaceResult.replacedShifts;
      results.sales = replaceResult.importedSales;
      console.log(`  ✓ Replaced ${results.replacedOrders} previously imported POSPOS orders (BB POS sales and shifts untouched)`);
    } else if (salesData.length === 0) {
      console.log("  ⚠ No sales rows captured, keeping existing branch orders.");
    } else {
      console.log("  ⚠ No successful sales rows captured, keeping existing branch orders.");
    }

    console.log(`  ✓ Replaced branch sales with ${results.sales} POSPOS sales`);

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  ✅ Sync complete for branch ${branchId} (${branch.name})`);
    console.log(`     Menu: ${results.menuItems} | Stock: ${results.ingredients} | Customers: ${results.customers} | Sales: ${results.sales} | Replaced orders: ${results.replacedOrders} | Replaced shifts: ${results.replacedShifts}`);
    console.log(`${"═".repeat(60)}\n`);

    return { success: true, ...results };

  } catch (err) {
    console.error("Error syncing from POSPOS:", err);
    throw err;
  } finally {
    await browser.close();
  }
}
