import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("Logging in...");
    await page.goto("https://go.pospos.co/");
    await page.fill('input[type="email"], input[name="email"]', "wazabin@hotmail.com");
    await page.fill('input[type="password"], input[name="password"]', "1478963");
    
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000); 
    
    console.log("URL after login:", page.url());
    
    // Select branch
    const targetBranchName = "สาขา วัชรเกียรติ"; // Test with Branch 1
    console.log(`Selecting branch: ${targetBranchName}...`);
    try {
       await page.locator(`text="${targetBranchName}"`).first().click({ timeout: 5000 });
       await page.waitForTimeout(5000);
       console.log("Branch selected.");
    } catch (e) {
       console.log("Could not find branch card. Assuming already selected.");
    }

    console.log("URL after branch selection:", page.url());

    console.log("Navigating to Stock...");
    await page.goto("https://go.pospos.co/core/stock", { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const searchBtn = page.getByRole('button', { name: /ค้นหา/ }).first();
    if (await searchBtn.isVisible()) {
        await searchBtn.click();
        await page.waitForTimeout(5000);
    } else {
        console.log("No search button found.");
    }

    const rowsCount = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
    console.log("Stock Rows found:", rowsCount);

  } catch(e) {
    console.error(e);
  } finally {
    await browser.close();
  }
}

run();
