import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (response) => {
    if (response.url().includes('/api/') || response.request().resourceType() === 'fetch' || response.request().resourceType() === 'xhr') {
      console.log(`[API] ${response.request().method()} ${response.url()}`);
    }
  });

  console.log("Logging in...");
  await page.goto("https://go.pospos.co/");
  await page.fill('input[type="email"], input[name="email"]', "wazabin@hotmail.com");
  await page.fill('input[type="password"], input[name="password"]', "1478963");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);

  console.log("Navigating to Stock...");
  await page.goto("https://go.pospos.co/core/stock", { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  await browser.close();
}

run().catch(console.error);
