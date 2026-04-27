import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import * as xlsx from "xlsx";
import prisma from "../prisma.js";

const DOWNLOAD_DIR = path.join(process.cwd(), "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

export async function syncPosposData(branchId: number) {
  console.log(`Starting POSPOS Sync for branch ${branchId}...`);
  
  // Verify branch exists via Prisma
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new Error("Branch not found");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    // 1. Login
    console.log("Logging into POSPOS...");
    await page.goto("https://go.pospos.co/");
    await page.fill('input[type="email"], input[name="email"]', "wazabin@hotmail.com");
    await page.fill('input[type="password"], input[name="password"]', "1478963");
    
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000); // Wait for login process to complete

    // 2. Select Branch
    let targetBranchName = "";
    if (branchId === 1) targetBranchName = "สาขา วัชรเกียรติ";
    else if (branchId === 3) targetBranchName = "BigB Coffee สาขา ศุภชัย";
    else if (branchId === 4) targetBranchName = "บ่อถ่ายน้ำมันเครื่อง";
    else targetBranchName = branch.name; // Fallback
    
    console.log(`Selecting branch: ${targetBranchName}...`);
    try {
       await page.locator(`text="${targetBranchName}"`).first().click({ timeout: 5000 });
       await page.waitForTimeout(5000);
    } catch (e) {
       console.log("Could not find branch card. Trying partial match...");
       try {
           const keywords = ["วัชรเกียรติ", "ศุภชัย", "บ่อถ่าย"];
           for (const kw of keywords) {
               if (targetBranchName.includes(kw)) {
                   await page.locator(`text="${kw}"`).first().click({ timeout: 5000 });
                   await page.waitForTimeout(5000);
                   break;
               }
           }
       } catch (err) {
           console.log("Still could not select branch. Assuming already selected.");
       }
    }

    // 3. Scrape Products
    console.log("Downloading Products...");
    const productsData: any[] = [];
    try {
      await page.goto("https://go.pospos.co/core/stock", { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
      
      const selects = await page.locator('select').all();
      for (const sel of selects) {
          if (await sel.isVisible()) {
              try { await sel.selectOption("100"); await page.waitForTimeout(2000); } catch(e) {}
          }
      }

      const searchBtn = page.getByRole('button', { name: /ค้นหา/ }).first();
      if (await searchBtn.isVisible()) {
          await searchBtn.click();
          await page.waitForTimeout(5000);
      }

      let hasNext = true;
      while(hasNext) {
          const pageData = await page.evaluate(() => {
              const rows = Array.from(document.querySelectorAll("table tbody tr"));
              return rows.map(tr => {
                  const tds = tr.querySelectorAll("td");
                  return {
                     name: tds[3]?.innerText?.trim() || "",
                     cost: tds[5]?.innerText?.trim().replace(/[^0-9.]/g, '') || "0",
                     stockUnit: tds[6]?.innerText?.trim() || "",
                  };
              }).filter(c => c.name);
          });
          productsData.push(...pageData);

          const nextBtn = page.getByText("ถัดไป", { exact: true });
          if (await nextBtn.count() > 0) {
              const disabled = await nextBtn.evaluate(b => b.classList.contains("disabled") || b.hasAttribute("disabled") || b.parentElement?.classList.contains("disabled"));
              if (!disabled) {
                  await nextBtn.click();
                  await page.waitForTimeout(2000);
              } else {
                  hasNext = false;
              }
          } else {
              hasNext = false;
          }
          if(productsData.length > 5000) break;
      }
    } catch(err) {
      console.log("Error extracting products:", err);
    }
    
    // 4. Scrape Customers
    console.log("Downloading Customers...");
    const customersData: any[] = [];
    try {
        await page.goto("https://go.pospos.co/core/crm/member", { waitUntil: 'networkidle' });
        await page.waitForTimeout(3000);

        const custSelects = await page.locator('select').all();
        for (const sel of custSelects) {
            if (await sel.isVisible()) {
                try { await sel.selectOption("100"); await page.waitForTimeout(2000); } catch(e) {}
            }
        }

        const searchBtn = page.getByRole('button', { name: /ค้นหา/ }).first();
        if (await searchBtn.isVisible()) {
            await searchBtn.click();
            await page.waitForTimeout(5000);
        }

        let hasNext = true;
        while(hasNext) {
            const pageData = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll("table tbody tr"));
                return rows.map(tr => {
                    const tds = tr.querySelectorAll("td");
                    return {
                       name: tds[3]?.innerText?.trim() || "",
                       phone: tds[6]?.innerText?.trim() || "",
                    };
                }).filter(c => c.name && c.phone);
            });
            customersData.push(...pageData);

            const nextBtn = page.getByText("ถัดไป", { exact: true });
            if (await nextBtn.count() > 0) {
                const disabled = await nextBtn.evaluate(b => b.classList.contains("disabled") || b.hasAttribute("disabled") || b.parentElement?.classList.contains("disabled"));
                if (!disabled) {
                    await nextBtn.click();
                    await page.waitForTimeout(2000);
                } else {
                    hasNext = false;
                }
            } else {
                hasNext = false;
            }
            if(customersData.length > 5000) break;
        }
    } catch(err) {
        console.log("Error extracting customers:", err);
    }

    // Insert into DB via Prisma
    let importedProducts = 0;
    for (const row of productsData) {
      const name = row.name;
      let stock = 0;
      let unit = "ชิ้น";
      const parts = row.stockUnit.split(" ");
      if (parts.length > 0) stock = parseFloat(parts[0].replace(/,/g, '')) || 0;
      if (parts.length > 1) unit = parts[1];
      
      const cost = parseFloat(row.cost) || 0;

      if (name) {
        const existing = await prisma.ingredient.findFirst({ where: { name } });
        let ingredientId: number;
        
        if (existing) {
          ingredientId = existing.id;
          await prisma.ingredient.update({
            where: { id: ingredientId },
            data: { costPerUnit: cost, unit }
          });
        } else {
          const created = await prisma.ingredient.create({
            data: { name, unit, costPerUnit: cost }
          });
          ingredientId = created.id;
        }
        
        await prisma.ingredientStock.upsert({
          where: { branchId_ingredientId: { branchId, ingredientId } },
          update: { stockQty: stock },
          create: { branchId, ingredientId, stockQty: stock, reorderLevel: 0 }
        });
        importedProducts++;
      }
    }
    console.log(`Synced ${importedProducts} products.`);

    let importedCustomers = 0;
    for (const row of customersData) {
      const name = row.name;
      const phone = String(row.phone).replace(/[^0-9]/g, '');

      if (name && phone) {
        await prisma.customer.upsert({
          where: { phone },
          update: { name },
          create: { name, phone, points: 0 }
        });
        importedCustomers++;
      }
    }
    console.log(`Synced ${importedCustomers} customers.`);

    console.log("Sync complete!");
    return { success: true, products: productsData.length, customers: customersData.length };
    
  } catch (err) {
    console.error("Error syncing from POSPOS:", err);
    throw err;
  } finally {
    await browser.close();
  }
}
