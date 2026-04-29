import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.ALLOW_MOCK_HISTORY !== "1") {
    throw new Error("Refusing to generate mock history. Set ALLOW_MOCK_HISTORY=1 only on a disposable/dev database.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to generate mock history in NODE_ENV=production.");
  }

  console.log("🚀 Generating historical stock and sales data...");

  const branches = await prisma.branch.findMany({ where: { active: true } });
  const menuItems = await prisma.menuItem.findMany({ where: { active: true } });
  const users = await prisma.user.findMany({ where: { active: true } });

  if (branches.length === 0 || menuItems.length === 0) {
    console.log("No branches or menu items found. Please run seed first.");
    return;
  }

  // Generate Ingredients & Stocks
  const baseIngredients = [
    { name: "เมล็ดกาแฟคั่วกลาง", unit: "g", cost: 0.5 },
    { name: "เมล็ดกาแฟคั่วเข้ม", unit: "g", cost: 0.45 },
    { name: "นมสด", unit: "ml", cost: 0.05 },
    { name: "น้ำเชื่อม", unit: "ml", cost: 0.02 },
    { name: "แก้วพลาสติก 16oz", unit: "ใบ", cost: 2.5 },
    { name: "หลอด", unit: "เส้น", cost: 0.5 },
    { name: "น้ำมันเครื่อง 10W-40", unit: "L", cost: 120 },
    { name: "ไส้กรองน้ำมันเบอร์ 1", unit: "ชิ้น", cost: 45 },
  ];

  for (const ing of baseIngredients) {
    let ingredient = await prisma.ingredient.findFirst({ where: { name: ing.name } });
    if (!ingredient) {
      ingredient = await prisma.ingredient.create({
        data: { name: ing.name, unit: ing.unit, costPerUnit: ing.cost }
      });
    }

    for (const branch of branches) {
      // Only oil items for oil branch, coffee items for coffee branch
      if (branch.branchType === "oil_service" && !ing.name.includes("น้ำมัน") && !ing.name.includes("ไส้กรอง")) continue;
      if (branch.branchType === "coffee" && (ing.name.includes("น้ำมัน") || ing.name.includes("ไส้กรอง"))) continue;

      const stockQty = Math.floor(Math.random() * 1000) + 500;
      const reorderLevel = 100;

      await prisma.ingredientStock.upsert({
        where: { branchId_ingredientId: { branchId: branch.id, ingredientId: ingredient.id } },
        update: { stockQty, reorderLevel },
        create: { branchId: branch.id, ingredientId: ingredient.id, stockQty, reorderLevel }
      });
    }
  }
  console.log("✅ Stock data generated.");

  // Generate Sales History (Last 30 days)
  const today = new Date();
  let orderCount = 0;

  for (const branch of branches) {
    const branchMenu = menuItems.filter(m => m.branchType === branch.branchType);
    if (branchMenu.length === 0) continue;

    for (let i = 30; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      
      // Open Shift
      date.setHours(7, 0, 0, 0);
      const shift = await prisma.shift.create({
        data: {
          branchId: branch.id,
          userId: users[0]?.id,
          openingCash: 2000,
          status: "CLOSED",
          openedAt: date,
          closedAt: new Date(date.getTime() + 12 * 60 * 60 * 1000), // 12 hours later
        }
      });

      // Generate 10-30 orders per day
      const dailyOrders = Math.floor(Math.random() * 20) + 10;
      let dailySales = 0;

      for (let j = 0; j < dailyOrders; j++) {
        // Random time within shift
        const orderDate = new Date(date.getTime() + Math.random() * 12 * 60 * 60 * 1000);
        const numItems = Math.floor(Math.random() * 3) + 1;
        let orderTotal = 0;
        
        const items = [];
        for (let k = 0; k < numItems; k++) {
          const menuItem = branchMenu[Math.floor(Math.random() * branchMenu.length)];
          const qty = Math.floor(Math.random() * 2) + 1;
          const lineTotal = menuItem.basePrice * qty;
          orderTotal += lineTotal;
          items.push({
            menuItemId: menuItem.id,
            name: menuItem.name,
            qty,
            basePrice: menuItem.basePrice,
            lineTotal
          });
        }

        await prisma.order.create({
          data: {
            branchId: branch.id,
            shiftId: shift.id,
            userId: users[0]?.id,
            status: "PAID",
            subtotal: orderTotal,
            total: orderTotal,
            paymentMethod: Math.random() > 0.5 ? "CASH" : "QR",
            createdAt: orderDate,
            items: { create: items }
          }
        });

        dailySales += orderTotal;
        orderCount++;
      }

      await prisma.shift.update({
        where: { id: shift.id },
        data: {
          totalSales: dailySales,
          totalOrders: dailyOrders,
          cashSales: dailySales * 0.5,
          qrSales: dailySales * 0.5,
          expectedCash: 2000 + (dailySales * 0.5),
          closingCash: 2000 + (dailySales * 0.5),
          difference: 0
        }
      });
    }
  }

  console.log(`✅ Sales history generated: ${orderCount} orders across 30 days.`);
  console.log("🎉 Import Simulation Complete!");
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
