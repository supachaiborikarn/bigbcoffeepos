import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Branches
  const branches = [
    { name: "Big B Coffee วัชรเกียรติ", location: "สาขาวัชรเกียรติ", branchType: "coffee" },
    { name: "Big B Coffee พงษ์อนันต์", location: "สาขาพงษ์อนันต์", branchType: "coffee" },
    { name: "Big B Coffee ศุภชัย", location: "สาขาศุภชัย", branchType: "coffee" },
    { name: "บ่อถ่ายน้ำมัน วัชรเกียรติ", location: "บริการเปลี่ยนถ่ายน้ำมันเครื่อง", branchType: "oil_service" },
  ];

  for (const b of branches) {
    await prisma.branch.upsert({
      where: { id: branches.indexOf(b) + 1 },
      update: {},
      create: b,
    });
  }
  console.log("  ✅ Branches seeded");

  // Users
  const users = [
    { name: "ผู้จัดการ", pin: "1234", role: "admin" },
    { name: "แคชเชียร์ 1", pin: "1111", role: "cashier" },
    { name: "แคชเชียร์ 2", pin: "2222", role: "cashier" },
  ];

  for (const u of users) {
    const existing = await prisma.user.findFirst({ where: { pin: u.pin } });
    if (!existing) {
      await prisma.user.create({ data: u });
    }
  }
  console.log("  ✅ Users seeded");

  // Coffee Menu
  const coffeeItems = [
    { sku: "C001", name: "อเมริกาโน่ร้อน", category: "กาแฟ", basePrice: 45, cost: 12, branchType: "coffee" },
    { sku: "C002", name: "อเมริกาโน่เย็น", category: "กาแฟ", basePrice: 55, cost: 14, branchType: "coffee" },
    { sku: "C003", name: "ลาเต้ร้อน", category: "กาแฟ", basePrice: 55, cost: 16, branchType: "coffee" },
    { sku: "C004", name: "ลาเต้เย็น", category: "กาแฟ", basePrice: 65, cost: 18, branchType: "coffee" },
    { sku: "C005", name: "คาปูชิโน่ร้อน", category: "กาแฟ", basePrice: 55, cost: 16, branchType: "coffee" },
    { sku: "C006", name: "มอคค่าร้อน", category: "กาแฟ", basePrice: 60, cost: 20, branchType: "coffee" },
    { sku: "C007", name: "มอคค่าเย็น", category: "กาแฟ", basePrice: 70, cost: 22, branchType: "coffee" },
    { sku: "C008", name: "ชาเขียวเย็น", category: "ชา", basePrice: 55, cost: 15, branchType: "coffee" },
    { sku: "C009", name: "ชาไทยเย็น", category: "ชา", basePrice: 50, cost: 12, branchType: "coffee" },
    { sku: "C010", name: "โกโก้เย็น", category: "เครื่องดื่ม", basePrice: 60, cost: 18, branchType: "coffee" },
    { sku: "C011", name: "น้ำส้มคั้นสด", category: "เครื่องดื่ม", basePrice: 50, cost: 20, branchType: "coffee" },
    { sku: "C012", name: "โซดามะนาว", category: "เครื่องดื่ม", basePrice: 40, cost: 10, branchType: "coffee" },
    { sku: "C013", name: "ครัวซองต์", category: "เบเกอรี่", basePrice: 45, cost: 22, branchType: "coffee" },
    { sku: "C014", name: "เค้กช็อกโกแลต", category: "เบเกอรี่", basePrice: 65, cost: 30, branchType: "coffee" },
    { sku: "C015", name: "คุกกี้ชิ้น", category: "เบเกอรี่", basePrice: 25, cost: 10, branchType: "coffee" },
  ];

  // Oil Service Menu
  const oilItems = [
    { sku: "OIL001", name: "น้ำมันเครื่อง 4T 1L", category: "น้ำมันเครื่อง", basePrice: 250, cost: 180, branchType: "oil_service" },
    { sku: "OIL002", name: "น้ำมันเครื่อง 4T 0.8L", category: "น้ำมันเครื่อง", basePrice: 200, cost: 140, branchType: "oil_service" },
    { sku: "OIL003", name: "น้ำมันเครื่องดีเซล 6L", category: "น้ำมันเครื่อง", basePrice: 850, cost: 600, branchType: "oil_service" },
    { sku: "OIL004", name: "น้ำมันเครื่องเบนซิน 4L", category: "น้ำมันเครื่อง", basePrice: 750, cost: 520, branchType: "oil_service" },
    { sku: "OIL005", name: "น้ำมันเกียร์ 1L", category: "น้ำมันเครื่อง", basePrice: 180, cost: 120, branchType: "oil_service" },
    { sku: "FIL001", name: "ไส้กรองน้ำมัน มอเตอร์ไซค์", category: "ไส้กรอง", basePrice: 80, cost: 40, branchType: "oil_service" },
    { sku: "FIL002", name: "ไส้กรองน้ำมัน รถยนต์", category: "ไส้กรอง", basePrice: 180, cost: 90, branchType: "oil_service" },
    { sku: "FIL003", name: "ไส้กรองอากาศ มอเตอร์ไซค์", category: "ไส้กรอง", basePrice: 100, cost: 50, branchType: "oil_service" },
    { sku: "FIL004", name: "ไส้กรองอากาศ รถยนต์", category: "ไส้กรอง", basePrice: 250, cost: 130, branchType: "oil_service" },
    { sku: "SVC001", name: "ค่าบริการเปลี่ยนถ่าย มอเตอร์ไซค์", category: "ค่าบริการ", basePrice: 50, cost: 0, branchType: "oil_service" },
    { sku: "SVC002", name: "ค่าบริการเปลี่ยนถ่าย รถยนต์", category: "ค่าบริการ", basePrice: 150, cost: 0, branchType: "oil_service" },
    { sku: "SVC003", name: "ค่าบริการเช็คระดับน้ำมัน", category: "ค่าบริการ", basePrice: 0, cost: 0, branchType: "oil_service" },
  ];

  const allMenuItems = [...coffeeItems, ...oilItems];
  for (const item of allMenuItems) {
    const existing = await prisma.menuItem.findFirst({ where: { sku: item.sku } });
    if (!existing) {
      await prisma.menuItem.create({ data: item });
    }
  }
  console.log("  ✅ Menu items seeded");

  console.log("🎉 Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
