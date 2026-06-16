import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "../..");

function getOutputDir() {
  return path.resolve(process.env.EXPORT_OUT_DIR || path.join(apiRoot, "downloads", "exports"));
}

function getBranchFilter() {
  const branchId = Number(process.env.EXPORT_BRANCH_ID);
  return Number.isFinite(branchId) && branchId > 0 ? branchId : undefined;
}

function safeSheetValue(value: unknown) {
  if (typeof value !== "string") return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function writeCsv(filePath: string, rows: Record<string, unknown>[]) {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\n");
  fs.writeFileSync(filePath, `\uFEFF${header}\n${body}`);
}

async function exportData() {
  console.log("Starting data extraction...");
  const branchId = getBranchFilter();
  const branches = await prisma.branch.findMany({
    where: { active: true, ...(branchId ? { id: branchId } : {}) },
    select: { id: true, name: true }
  });

  console.log(`Found ${branches.length} branches.`);

  for (const branch of branches) {
    console.log(`\nProcessing branch: ${branch.name}`);
    
    // 1. Fetch Stocks
    const stocks = await prisma.ingredientStock.findMany({
      where: { branchId: branch.id },
      include: { ingredient: true }
    });

    const stockData = stocks.map(s => ({
      'รหัสวัตถุดิบ': s.ingredient.id,
      'ชื่อวัตถุดิบ': safeSheetValue(s.ingredient.name),
      'ยอดคงเหลือ': s.stockQty,
      'หน่วย': safeSheetValue(s.ingredient.unit),
      'ต้นทุน/หน่วย': s.ingredient.costPerUnit,
      'จุดสั่งซื้อ': s.reorderLevel
    }));

    // 2. Fetch Orders
    const orders = await prisma.order.findMany({
      where: { branchId: branch.id },
      include: {
        items: {
          include: { menuItem: true }
        },
        user: true,
        customer: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    // Flatten order items for CSV export.
    const salesData: any[] = [];
    for (const order of orders) {
      if (order.items.length === 0) {
        // Record order even if no items
        salesData.push({
          'รหัสออเดอร์': order.id,
          'วันที่': order.createdAt.toISOString().replace('T', ' ').substring(0, 19),
          'ยอดสุทธิ': order.total,
          'สถานะ': safeSheetValue(order.status),
          'พนักงาน': safeSheetValue(order.user?.name || 'ไม่ระบุ'),
          'ลูกค้า': safeSheetValue(order.customer?.name || 'ลูกค้าทั่วไป'),
          'ช่องทางจ่ายเงิน': safeSheetValue(order.paymentMethod),
          'ส่วนลด': order.discountAmount,
          'สินค้า': '',
          'หมวดหมู่': '',
          'จำนวน': 0,
          'ราคาขาย': 0,
          'หมายเหตุ': ''
        });
      } else {
        for (const item of order.items) {
          salesData.push({
            'รหัสออเดอร์': order.id,
            'วันที่': order.createdAt.toISOString().replace('T', ' ').substring(0, 19),
            'ยอดสุทธิ': order.total,
            'สถานะ': safeSheetValue(order.status),
            'พนักงาน': safeSheetValue(order.user?.name || 'ไม่ระบุ'),
            'ลูกค้า': safeSheetValue(order.customer?.name || 'ลูกค้าทั่วไป'),
            'ช่องทางจ่ายเงิน': safeSheetValue(order.paymentMethod),
            'ส่วนลด': order.discountAmount,
            'สินค้า': safeSheetValue(item.name),
            'หมวดหมู่': safeSheetValue(item.menuItem?.category || ''),
            'จำนวน': item.qty,
            'ราคาขาย': item.lineTotal,
            'หมายเหตุ': safeSheetValue(item.note || '')
          });
        }
      }
    }

    const outDir = getOutputDir();
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const safeBranchName = branch.name.replace(/[^a-z0-9ก-๙]/gi, '_');
    const stockPath = path.join(outDir, `Export_BigBCoffee_${safeBranchName}_stocks.csv`);
    const salesPath = path.join(outDir, `Export_BigBCoffee_${safeBranchName}_sales.csv`);

    writeCsv(stockPath, stockData);
    writeCsv(salesPath, salesData);
    console.log(`Saved: ${stockPath}`);
    console.log(`Saved: ${salesPath}`);
  }

  console.log("\nExtraction Complete!");
}

exportData()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
