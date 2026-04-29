import { chromium, type Page } from "playwright";
import prisma from "../prisma.js";

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

// ── Main Sync Function ───────────────────────────────────────────────────────

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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const results = { menuItems: 0, ingredients: 0, customers: 0, sales: 0 };

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
        const categoryName = p.category?.name || "ไม่ระบุ";

        // Upsert into menu_items
        const existing = await prisma.menuItem.findFirst({
          where: { name, branchType },
        });

        if (existing) {
          await prisma.menuItem.update({
            where: { id: existing.id },
            data: { basePrice: price, cost, barcode, sku, category: categoryName },
          });
        } else {
          await prisma.menuItem.create({
            data: { name, basePrice: price, cost, barcode, sku, category: categoryName, branchType, active: true },
          });
        }
        results.menuItems++;
      }
      console.log(`  ✓ Synced ${results.menuItems} menu items (with selling prices)`);
    } else {
      console.log("  ⚠ No product API data captured, skipping menu items.");
    }

    // ── 4. Scrape Stock/Ingredients ──
    console.log("[4/6] Scraping Stock/Ingredients...");
    await page.goto("https://go.pospos.co/core/stock", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const stockData = await scrapeTable(page, () => {
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

    for (const row of stockData) {
      const name = row.name;
      let stock = 0, unit = "ชิ้น";
      const parts = row.stockUnit.split(" ");
      if (parts.length > 0) stock = parseFloat(parts[0].replace(/,/g, "")) || 0;
      if (parts.length > 1) unit = parts[1];
      const cost = parseFloat(row.cost) || 0;

      if (name) {
        const existing = await prisma.ingredient.findFirst({ where: { name } });
        let ingredientId: number;
        if (existing) {
          ingredientId = existing.id;
          await prisma.ingredient.update({ where: { id: ingredientId }, data: { costPerUnit: cost, unit } });
        } else {
          const created = await prisma.ingredient.create({ data: { name, unit, costPerUnit: cost } });
          ingredientId = created.id;
        }
        await prisma.ingredientStock.upsert({
          where: { branchId_ingredientId: { branchId, ingredientId } },
          update: { stockQty: stock },
          create: { branchId, ingredientId, stockQty: stock, reorderLevel: 0 },
        });
        results.ingredients++;
      }
    }
    console.log(`  ✓ Saved ${results.ingredients} ingredients/stock`);

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

    for (const row of salesData) {
      if (row.status !== "สำเร็จ") continue;
      const total = parseFloat(row.total) || 0;
      const discountStr = row.discount.replace(/[^0-9.]/g, "");
      const discountAmount = parseFloat(discountStr) || 0;
      const paymentMethod = mapPayment(row.paymentMethod);
      const createdAt = parseThaiDate(row.date) || new Date();

      const existingOrder = await prisma.order.findFirst({
        where: {
          branchId, total,
          createdAt: { gte: new Date(createdAt.getTime() - 60000), lte: new Date(createdAt.getTime() + 60000) },
        },
      });

      if (!existingOrder) {
        await prisma.order.create({
          data: { branchId, status: "PAID", subtotal: total + discountAmount, discountAmount, total, paymentMethod, createdAt },
        });
        results.sales++;
      }
    }
    console.log(`  ✓ Saved ${results.sales} new sales`);

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  ✅ Sync complete for branch ${branchId} (${branch.name})`);
    console.log(`     Menu: ${results.menuItems} | Stock: ${results.ingredients} | Customers: ${results.customers} | Sales: ${results.sales}`);
    console.log(`${"═".repeat(60)}\n`);

    return { success: true, ...results };

  } catch (err) {
    console.error("Error syncing from POSPOS:", err);
    throw err;
  } finally {
    await browser.close();
  }
}
