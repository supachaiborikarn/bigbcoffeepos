/**
 * Remove the QA test data from the 10–11 Oct 2026 test rounds (QA report §7)
 * and put stock, costs and shifts back the way they were before testing.
 *
 *   npx tsx src/scripts/qa-cleanup-2026-10.ts            # dry run: prints the plan, changes nothing
 *   npx tsx src/scripts/qa-cleanup-2026-10.ts --apply    # does it, in one transaction
 *
 * Scope is fixed to what QA did (branch "พงษ์อนันต์" id 2 from 15:40 UTC on
 * 10 Oct, plus the transfer pair on branch 1). Before changing anything it
 * checks that nothing else happened in that window; if it finds an order or
 * stock movement it doesn't recognise, it stops without touching the database.
 * The audit log (/activity) is left as the record of what was tested.
 */
import prisma from "../prisma.js";

const db = prisma as any;
const APPLY = process.argv.includes("--apply");

const QA_BRANCH = 2;
const QA_START = new Date("2026-10-10T15:40:00Z"); // first QA bill (#2733) was 15:40:56Z
const QA_ORDER_IDS = Array.from({ length: 2747 - 2733 + 1 }, (_, i) => 2733 + i);
const QA_SHIFT_TO_DELETE = 168; // opened by QA, only QA bills
const QA_SHIFT_TO_RESTORE = 142; // open since June; QA put 2 bills in it and closed it
const QA_PURCHASES = [13, 14];
const QA_TRANSFER = 1;
const QA_STOCK_COUNTS = [2, 3];
const QA_TAX_INVOICES_ORDERS = [2740, 2741, 2742];
const QA_CUSTOMER_PHONES = ["0999999901", "0999000111"];
const QA_USER_NAME = "QA แคชเชียร์ทดสอบ";
const QA_MENU_SKU = "QA-001";
// branch 1 got +100 hot cups from transfer #1 and QA counted them back down (-100): net 0
const BRANCH1_QA_MOVEMENTS = (r: string) => r === "TRANSFER_IN#1" || r.includes("QA revert transfer test");
// receipt #13/#14 moved these costs; restore only if nobody has changed them since
const COST_RESTORE: Array<{ match: RegExp; from: number; to: number }> = [
  { match: /^แก้วเย็น cold$/, from: 2.6, to: 2.5 },
  { match: /^เมล็ดกาแฟคั่วกลาง$/, from: 0.55, to: 0.5 },
  { match: /^น้ำดื่มคริสตัล350มล$/, from: 3.9, to: 3.87 }
];
const KNOWN_QA_REASON = (r: string) =>
  /^(SALE|CANCELLED)-(27(3[3-9]|4[0-7]))$/.test(r) || /^PO#1[34]$/.test(r) || r === "TRANSFER_OUT#1" || /^STOCKTAKE#2\b/.test(r) || r.startsWith("COUNT:");

const plan: string[] = [];
const say = (line: string) => { plan.push(line); console.log(line); };
const round = (v: number) => Math.round(v * 1000) / 1000;

async function main() {
  console.log(APPLY ? "=== APPLY: changing the database ===" : "=== DRY RUN: nothing will be changed (add --apply to run) ===");

  // ---- safety checks -------------------------------------------------------
  const branchOrders = await db.order.findMany({ where: { branchId: QA_BRANCH, createdAt: { gte: QA_START } }, select: { id: true } });
  const unexpectedOrders = branchOrders.map((o: any) => o.id).filter((id: number) => !QA_ORDER_IDS.includes(id));
  if (unexpectedOrders.length) throw new Error(`stop: branch ${QA_BRANCH} has bills after the QA start that aren't QA's: ${unexpectedOrders.join(", ")}`);

  const b2Moves = await db.stockMovement.findMany({ where: { branchId: QA_BRANCH, createdAt: { gte: QA_START } }, orderBy: { id: "asc" } });
  const unexpectedMoves = b2Moves.filter((m: any) => !KNOWN_QA_REASON(m.reason));
  if (unexpectedMoves.length) throw new Error(`stop: unexpected stock movements on branch ${QA_BRANCH}: ${unexpectedMoves.map((m: any) => `#${m.id} ${m.reason}`).join("; ")}`);

  const b1Moves = (await db.stockMovement.findMany({ where: { branchId: 1, createdAt: { gte: QA_START } }, orderBy: { id: "asc" } })).filter((m: any) => BRANCH1_QA_MOVEMENTS(m.reason));
  const b1Net = new Map<number, number>();
  for (const m of b1Moves) b1Net.set(m.ingredientId, round((b1Net.get(m.ingredientId) ?? 0) + m.qty));
  if ([...b1Net.values()].some((v) => v !== 0)) throw new Error("stop: branch 1 transfer/revert movements don't cancel out");

  const ingredientNames = new Map((await db.ingredient.findMany({ where: { id: { in: [...new Set([...b2Moves, ...b1Moves].map((m: any) => m.ingredientId))] } }, select: { id: true, name: true } })).map((i: any) => [i.id, i.name]));

  // ---- 1. stock on branch 2 back to before QA ------------------------------
  const net = new Map<number, number>();
  for (const m of b2Moves) net.set(m.ingredientId, round((net.get(m.ingredientId) ?? 0) + m.qty));
  say(`\n1) สต็อกสาขา ${QA_BRANCH}: ย้อน ${b2Moves.length} ความเคลื่อนไหวของ QA`);
  for (const [ingredientId, qty] of net) {
    const row = await db.ingredientStock.findUnique({ where: { branchId_ingredientId: { branchId: QA_BRANCH, ingredientId } } });
    say(`   ${ingredientNames.get(ingredientId) ?? `#${ingredientId}`}: ตอนนี้ ${row?.stockQty ?? 0} → ${round((row?.stockQty ?? 0) - qty)} (ยอดก่อนทดสอบ · QA ทำให้เปลี่ยน ${qty > 0 ? "+" : ""}${qty})`);
  }
  say(`   สาขา 1: ลบ ${b1Moves.length} รายการโอนเข้า/นับคืน (สุทธิ 0 ไม่เปลี่ยนยอด)`);

  // ---- 2..n. records -------------------------------------------------------
  const invoices = await db.taxInvoice.findMany({ where: { orderId: { in: QA_TAX_INVOICES_ORDERS } }, select: { id: true, invoiceNo: true } });
  const customers = await db.customer.findMany({ where: { phone: { in: QA_CUSTOMER_PHONES } }, select: { id: true, name: true, phone: true } });
  const qaUser = await db.user.findFirst({ where: { name: QA_USER_NAME }, select: { id: true, name: true } });
  const qaMenu = await db.menuItem.findFirst({ where: { sku: QA_MENU_SKU }, select: { id: true, name: true } });
  const docs = await db.businessDocument.findMany({ where: { branchId: QA_BRANCH }, select: { id: true, documentNo: true } });
  const lots = await db.inventoryLot.findMany({ where: { lotNo: { startsWith: "QA-" } }, select: { id: true, lotNo: true } });
  const cashEntries = await prisma.$queryRaw<Array<{ id: number; amount: number; note: string }>>`SELECT id, amount, note FROM cash_drawer_entries WHERE note LIKE 'QA%'`;
  const costRows = await db.ingredient.findMany({ select: { id: true, name: true, costPerUnit: true } });
  // tables the app creates on first use; a failed statement would abort the whole transaction
  const tableExists = async (name: string) => (await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass(${name}) IS NOT NULL AS ok`)[0]?.ok === true;
  const hasCloseDetails = await tableExists("shift_close_details");
  const hasTimeEntries = await tableExists("staff_time_entries");

  say(`\n2) บิล QA ${QA_ORDER_IDS[0]}–${QA_ORDER_IDS[QA_ORDER_IDS.length - 1]}: ลบบิล รายการ การชำระ และ event`);
  say(`3) ใบกำกับภาษี: ลบ ${invoices.map((i: any) => i.invoiceNo).join(", ") || "-"}`);
  say(`4) ใบรับสินค้า #${QA_PURCHASES.join(", #")}: ลบ (สต็อกย้อนในข้อ 1 แล้ว) · lot QA: ${lots.map((l: any) => l.lotNo).join(", ") || "-"}`);
  for (const c of COST_RESTORE) {
    const ing = costRows.find((i: any) => c.match.test(i.name));
    if (!ing) say(`   ต้นทุน ${c.match.source}: ไม่พบสินค้า ข้าม`);
    else if (Math.abs(ing.costPerUnit - c.from) < 1e-6) say(`   ต้นทุน ${ing.name}: ${ing.costPerUnit} → ${c.to}`);
    else say(`   ต้นทุน ${ing.name}: ตอนนี้ ${ing.costPerUnit} (ไม่ใช่ค่าที่ QA ตั้ง ${c.from}) → ไม่แก้`);
  }
  say(`5) ใบโอน #${QA_TRANSFER}, รอบนับ #${QA_STOCK_COUNTS.join(", #")}: ลบ`);
  say(`6) เอกสารหลังร้านสาขา ${QA_BRANCH}: ลบ ${docs.map((d: any) => d.documentNo).join(", ") || "-"}`);
  say(`7) เงินเข้า/ออก: ลบ ${cashEntries.map((e) => `#${e.id} ${e.amount} (${e.note})`).join(", ") || "-"}`);
  say(`8) กะ #${QA_SHIFT_TO_DELETE} (เปิดโดย QA): ลบ · กะ #${QA_SHIFT_TO_RESTORE}: คืนสถานะเปิดอยู่เหมือนก่อนทดสอบ และคำนวณยอดใหม่`);
  say(`9) สมาชิก: ลบ ${customers.map((c: any) => `${c.name} (${c.phone})`).join(", ") || "-"}`);
  say(`10) พนักงาน: ${qaUser ? `ลบ ${qaUser.name}` : "-"}`);
  say(`11) สินค้า: ${qaMenu ? `ลบ ${qaMenu.name.slice(0, 30)}… (SKU ${QA_MENU_SKU}) พร้อมหน่วย/ราคาพิเศษ/ตัวเลือก/สูตร` : "-"}`);
  say(`\nไม่ได้แตะ: บันทึกกิจกรรม (/activity), บิลพัก "บิลพัก 07:30" (อยู่ในเบราว์เซอร์ของเครื่องที่ทดสอบ ลบที่เครื่องนั้น), ตั้งค่าร้าน`);

  if (!APPLY) { console.log("\nDry run เสร็จ ไม่มีการเปลี่ยนแปลง · รันซ้ำด้วย --apply เพื่อทำจริง"); return; }

  await prisma.$transaction(async (tx: any) => {
    // stock
    for (const [ingredientId, qty] of net) {
      if (qty) await tx.ingredientStock.update({ where: { branchId_ingredientId: { branchId: QA_BRANCH, ingredientId } }, data: { stockQty: { decrement: qty } } });
    }
    await tx.stockMovement.deleteMany({ where: { id: { in: [...b2Moves, ...b1Moves].map((m: any) => m.id) } } });
    await tx.inventoryLot.deleteMany({ where: { OR: [{ lotNo: { startsWith: "QA-" } }, { purchaseId: { in: QA_PURCHASES } }] } });

    // tax invoices + their outbox events, then orders
    await tx.integrationOutbox.deleteMany({ where: { entityType: "tax_invoice", entityId: { in: invoices.map((i: any) => i.id) } } });
    await tx.taxInvoice.deleteMany({ where: { orderId: { in: QA_ORDER_IDS } } });
    await tx.integrationOutbox.deleteMany({ where: { entityType: "order", entityId: { in: QA_ORDER_IDS } } });
    await tx.payment.deleteMany({ where: { orderId: { in: QA_ORDER_IDS } } });
    await tx.orderEvent.deleteMany({ where: { orderId: { in: QA_ORDER_IDS } } });
    await tx.orderItem.deleteMany({ where: { orderId: { in: QA_ORDER_IDS } } });
    await tx.order.deleteMany({ where: { id: { in: QA_ORDER_IDS } } });

    // receipts, costs, transfer, counts, documents
    await tx.purchaseItem.deleteMany({ where: { purchaseId: { in: QA_PURCHASES } } });
    await tx.purchase.deleteMany({ where: { id: { in: QA_PURCHASES } } });
    for (const c of COST_RESTORE) {
      const ing = costRows.find((i: any) => c.match.test(i.name));
      if (ing && Math.abs(ing.costPerUnit - c.from) < 1e-6) await tx.ingredient.update({ where: { id: ing.id }, data: { costPerUnit: c.to } });
    }
    await tx.stockTransferItem.deleteMany({ where: { stockTransferId: QA_TRANSFER } });
    await tx.stockTransfer.deleteMany({ where: { id: QA_TRANSFER } });
    await tx.stockCountItem.deleteMany({ where: { stockCountId: { in: QA_STOCK_COUNTS } } });
    await tx.stockCount.deleteMany({ where: { id: { in: QA_STOCK_COUNTS } } });
    await tx.businessDocument.deleteMany({ where: { id: { in: docs.map((d: any) => d.id) } } });

    // cash drawer + shifts
    await tx.$executeRaw`DELETE FROM cash_drawer_entries WHERE note LIKE 'QA%'`;
    await tx.$executeRaw`DELETE FROM cash_drawer_entries WHERE shift_id = ${QA_SHIFT_TO_DELETE}`;
    if (hasCloseDetails) await tx.$executeRaw`DELETE FROM shift_close_details WHERE shift_id IN (${QA_SHIFT_TO_DELETE}, ${QA_SHIFT_TO_RESTORE})`;
    await tx.shift.delete({ where: { id: QA_SHIFT_TO_DELETE } });
    const rest = await tx.order.findMany({ where: { shiftId: QA_SHIFT_TO_RESTORE, status: { notIn: ["CANCELLED", "REFUNDED"] } }, select: { total: true, paymentMethod: true } });
    const sum = (m?: string[]) => round(rest.filter((o: any) => !m || m.includes(o.paymentMethod)).reduce((s: number, o: any) => s + o.total, 0));
    await tx.shift.update({
      where: { id: QA_SHIFT_TO_RESTORE },
      data: { status: "OPEN", closedAt: null, closingCash: null, expectedCash: null, difference: null, totalOrders: rest.length, totalSales: sum(), cashSales: sum(["CASH"]), qrSales: sum(["QR"]), cardSales: sum(["CARD", "EWALLET"]) }
    });

    // people and the test product
    await tx.customer.deleteMany({ where: { id: { in: customers.map((c: any) => c.id) } } });
    if (qaUser) {
      if (hasTimeEntries) await tx.$executeRaw`DELETE FROM staff_time_entries WHERE user_id = ${qaUser.id}`;
      await tx.user.delete({ where: { id: qaUser.id } });
    }
    if (qaMenu) {
      await tx.productUnit.deleteMany({ where: { menuItemId: qaMenu.id } });
      await tx.priceRule.deleteMany({ where: { menuItemId: qaMenu.id } });
      await tx.productVariant.deleteMany({ where: { menuItemId: qaMenu.id } });
      await tx.recipe.deleteMany({ where: { menuItemId: qaMenu.id } });
      await tx.menuItem.delete({ where: { id: qaMenu.id } });
    }
  }, { timeout: 120_000, maxWait: 20_000 });

  console.log("\nเสร็จ: ล้างข้อมูล QA แล้ว");
}

main()
  .catch((error) => { console.error(`\n${(error as Error).message}\nไม่มีการเปลี่ยนแปลงฐานข้อมูล`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
