import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let productData: any = null;
  let categoryData: any = null;

  page.on('response', async (response) => {
    const url = response.url();
    try {
      if (url.includes('product/shop/pagination') && response.status() === 200) {
        productData = await response.json();
      }
      if (url.includes('/api/v1/category') && response.status() === 200 && !categoryData) {
        categoryData = await response.json();
      }
    } catch {}
  });

  console.log("Logging in...");
  await page.goto("https://go.pospos.co/");
  await page.fill('input[type="email"], input[name="email"]', "wazabin@hotmail.com");
  await page.fill('input[type="password"], input[name="password"]', "1478963");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);

  console.log("Selecting branch: BigB Coffee สาขา ศุภชัย...");
  await page.locator('text="BigB Coffee สาขา ศุภชัย"').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(5000);

  console.log("Navigating to Shop...");
  await page.goto("https://go.pospos.co/core/shop", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);

  // Print categories
  if (categoryData?.data) {
    console.log("\n=== Categories ===");
    categoryData.data.forEach((c: any) => console.log(`  ${c.name || c.name_th || JSON.stringify(c).substring(0, 80)}`));
  }

  // Print product sample with all keys
  if (productData?.data) {
    console.log(`\n=== Products: ${productData.data.length} total (showing first 3) ===`);
    console.log("Keys:", Object.keys(productData.data[0]));
    productData.data.slice(0, 5).forEach((p: any) => {
      console.log(`  Name: ${p.name} | Price: ${p.price ?? p.selling_price ?? p.sale_price ?? 'N/A'} | Cost: ${p.cost ?? p.cost_price ?? 'N/A'} | Cat: ${p.category?.name || p.category_id || 'N/A'} | SKU: ${p.sku || p.barcode || 'N/A'} | Stock: ${p.stock_qty ?? p.quantity ?? 'N/A'}`);
    });

    // Print raw first product
    console.log("\n=== RAW first product ===");
    const first = productData.data[0];
    for (const [k, v] of Object.entries(first)) {
      if (typeof v !== 'object' || v === null) {
        console.log(`  ${k}: ${v}`);
      } else {
        console.log(`  ${k}: ${JSON.stringify(v).substring(0, 100)}`);
      }
    }

    console.log(`\nTotal: ${productData.total}, Pages: ${productData.total_page}`);
  } else {
    console.log("No product data captured!");
  }

  await browser.close();
}

run().catch(console.error);
