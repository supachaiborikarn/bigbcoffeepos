import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import prisma from "../prisma.js";

type TestMenuItem = {
  id: number;
  name: string;
};

type TestData = {
  tag: string;
  pin: string;
  branchId: number;
  branchName: string;
  userId: number;
  cookie: TestMenuItem;
  latte: TestMenuItem;
  menuItemIds: number[];
  cupIngredientIds: number[];
  createdCupIngredientIds: number[];
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) resolve(address.port);
        else reject(new Error("Unable to allocate port"));
      });
    });
  });
}

async function waitForUrl(url: string, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { cwd, env, stdio: "pipe" });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${args.join(" ")}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${args.join(" ")}] ${chunk}`));
  return child;
}

function resolveBin(root: string, workspace: string, bin: string) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const candidates = [
    path.join(root, workspace, "node_modules", ".bin", `${bin}${suffix}`),
    path.join(root, "node_modules", ".bin", `${bin}${suffix}`)
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Unable to find ${bin} binary. Tried: ${candidates.join(", ")}`);
  return found;
}

function stopProcess(child?: ChildProcessWithoutNullStreams) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
}

async function seedTestData(): Promise<TestData> {
  const tag = `QA_E2E_${Date.now()}`;
  const pin = String(1000 + Math.floor(Math.random() * 8000));
  const branch = await prisma.branch.create({
    data: { name: `${tag}_branch`, location: "browser-e2e", branchType: "coffee", active: true }
  });
  const user = await prisma.user.create({
    data: { name: `${tag}_admin`, pin, role: "admin", active: true, branchId: null }
  });
  const [cookie, latte] = await Promise.all([
    prisma.menuItem.create({
      data: { sku: `${tag}-cookie`, name: `${tag}_cookie`, category: "เบเกอรี่", basePrice: 40, branchType: "coffee", active: true }
    }),
    prisma.menuItem.create({
      data: { sku: `${tag}-latte`, name: `${tag}_ลาเต้`, category: "กาแฟ", basePrice: 50, branchType: "coffee", active: true }
    })
  ]);
  const cupIngredients: Array<{ id: number; created: boolean }> = [];
  for (const name of ["แก้วพลาสติก 16oz", "แก้วร้อนแยก"]) {
    let ingredient = await prisma.ingredient.findFirst({ where: { name }, select: { id: true } });
    let created = false;
    if (!ingredient) {
      ingredient = await prisma.ingredient.create({ data: { name, unit: "ใบ", costPerUnit: 1 }, select: { id: true } });
      created = true;
    }
    cupIngredients.push({ id: ingredient.id, created });
    await prisma.ingredientStock.upsert({
      where: { branchId_ingredientId: { branchId: branch.id, ingredientId: ingredient.id } },
      update: { stockQty: 100, reorderLevel: 10 },
      create: { branchId: branch.id, ingredientId: ingredient.id, stockQty: 100, reorderLevel: 10 }
    });
  }
  return {
    tag,
    pin,
    branchId: branch.id,
    branchName: branch.name,
    userId: user.id,
    cookie: { id: cookie.id, name: cookie.name },
    latte: { id: latte.id, name: latte.name },
    menuItemIds: [cookie.id, latte.id],
    cupIngredientIds: cupIngredients.map((ingredient) => ingredient.id),
    createdCupIngredientIds: cupIngredients.filter((ingredient) => ingredient.created).map((ingredient) => ingredient.id)
  };
}

async function cleanupTestData(data: TestData | null) {
  if (!data) return;
  const orders = await prisma.order.findMany({
    where: { items: { some: { menuItemId: { in: data.menuItemIds } } } },
    select: { id: true }
  });
  const orderIds = orders.map((order) => order.id);
  if (orderIds.length) {
    await prisma.integrationOutbox.deleteMany({ where: { entityType: "order", entityId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.stockMovement.deleteMany({
      where: { OR: orderIds.flatMap((id) => [{ reason: `SALE-${id}` }, { reason: `REFUNDED-${id}` }, { reason: `CANCELLED-${id}` }]) }
    });
  }
  await prisma.shift.deleteMany({ where: { branchId: data.branchId } });
  await prisma.ingredientStock.deleteMany({ where: { branchId: data.branchId, ingredientId: { in: data.cupIngredientIds } } });
  if (data.createdCupIngredientIds.length) await prisma.ingredient.deleteMany({ where: { id: { in: data.createdCupIngredientIds } } });
  await prisma.menuItem.deleteMany({ where: { id: { in: data.menuItemIds } } });
  await prisma.user.deleteMany({ where: { id: data.userId } });
  await prisma.branch.deleteMany({ where: { id: data.branchId } });
}

async function addSimpleItem(page: Page, itemName: string) {
  await page.getByPlaceholder("ค้นหาสินค้า (F1)").fill(itemName);
  await page.getByRole("button", { name: `เพิ่ม ${itemName}` }).click();
}

async function addModifiedLatte(page: Page, itemName: string) {
  await page.getByPlaceholder("ค้นหาสินค้า (F1)").fill(itemName);
  await page.getByRole("button", { name: `เพิ่ม ${itemName}` }).click();
  await page.getByRole("heading", { name: itemName }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /แก้วเย็น/ }).click();
  await page.getByRole("button", { name: "หวานน้อย (50%)" }).click();
  await page.getByRole("button", { name: /เพิ่มช็อตกาแฟ/ }).click();
  await page.getByRole("button", { name: /เพิ่มลงตะกร้า/ }).click();
}

async function enterNumpad(modal: Locator, digits: string) {
  for (const digit of digits) await modal.getByRole("button", { name: digit, exact: true }).click();
}

async function backspaceNumpad(modal: Locator, count: number) {
  for (let index = 0; index < count; index += 1) {
    await modal.getByRole("button", { name: "⌫", exact: true }).click();
  }
}

async function getLatestOrderByMenuItem(menuItemId: number) {
  return prisma.order.findFirst({
    where: { items: { some: { menuItemId } } },
    orderBy: { id: "desc" },
    include: { payments: true, items: true, events: true }
  });
}

async function main() {
  const root = path.resolve(process.cwd(), "../..");
  const apiPort = await getFreePort();
  const webPort = await getFreePort();
  const apiUrl = `http://127.0.0.1:${apiPort}/api`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  let apiProcess: ChildProcessWithoutNullStreams | undefined;
  let webProcess: ChildProcessWithoutNullStreams | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let traceStopped = false;
  let data: TestData | null = null;

  try {
    data = await seedTestData();
    const env = {
      ...process.env,
      PORT: String(apiPort),
      VITE_API_URL: apiUrl,
      NODE_ENV: "test"
    };
    apiProcess = startProcess("node", ["--import", "tsx", "apps/api/src/index.ts"], root, env);
    webProcess = startProcess(resolveBin(root, "apps/web", "vite"), ["--host", "127.0.0.1", "--port", String(webPort)], path.join(root, "apps/web"), env);

    await waitForUrl(`${apiUrl}/health`);
    await waitForUrl(webUrl);

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("● ● ● ●").fill(data.pin);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await page.waitForURL("**/branch", { timeout: 10_000 });
    await page.getByText(data.branchName).click();
    await page.waitForURL("**/pos", { timeout: 10_000 });

    await page.getByRole("button", { name: "เปิดกะ", exact: true }).click();
    await page.getByRole("button", { name: /ยืนยันเปิดกะ/ }).click();
    await page.getByRole("banner").getByText(/กะ #/).waitFor({ timeout: 10_000 });

    await addModifiedLatte(page, data.latte.name);
    await addSimpleItem(page, data.cookie.name);
    await page.getByText(/ยอดรวม \(2 ชิ้น\)/).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: /ชำระเงิน/ }).click();
    await page.getByText("รับเงินสด").waitFor({ timeout: 10_000 });
    const cashModal = page.locator(".modal-backdrop").last();

    await enterNumpad(cashModal, "100");
    await expectDisabled(cashModal.getByRole("button", { name: "รับเงินและพิมพ์ใบเสร็จ" }), "Underpayment should keep cash confirmation disabled");

    await backspaceNumpad(cashModal, 3);
    await enterNumpad(cashModal, "120");
    await cashModal.getByRole("button", { name: "รับเงินและพิมพ์ใบเสร็จ" }).click();
    await page.getByText("ไม่มีสินค้าในตะกร้า").waitFor({ timeout: 15_000 });

    const cashOrder = await getLatestOrderByMenuItem(data.latte.id);
    if (!cashOrder) throw new Error("Browser cash checkout did not create an order");
    const latteId = data.latte.id;
    const latteLine = cashOrder.items.find((item) => item.menuItemId === latteId);
    const latteModifiers = latteLine ? JSON.parse(latteLine.modifiers) as Array<{ name: string; value: string; price: number }> : [];
    assert(cashOrder.total === 105, `Browser cash checkout total mismatch: ${cashOrder.total}`);
    assert(cashOrder.items.length === 2, `Browser cash checkout item count mismatch: ${cashOrder.items.length}`);
    assert(latteLine?.lineTotal === 65, `Modified latte line total mismatch: ${latteLine?.lineTotal}`);
    assert(latteModifiers.some((modifier) => modifier.name === "Cup" && modifier.value === "แก้วเย็น"), "Cup modifier was not persisted");
    assert(latteModifiers.some((modifier) => modifier.value === "หวานน้อย (50%)" || modifier.value === "50%"), "Sweetness modifier was not persisted");
    assert(latteModifiers.some((modifier) => modifier.value === "เพิ่มช็อตกาแฟ" && modifier.price === 15), "Add-on modifier was not persisted");
    assert(cashOrder.payments[0]?.amountReceived === 120, "Cash payment evidence missing");
    assert(cashOrder.payments[0]?.changeAmount === 15, "Cash change amount mismatch");

    await addSimpleItem(page, data.cookie.name);
    await page.getByText(/ยอดรวม \(1 ชิ้น\)/).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "QR", exact: true }).click();
    await page.getByRole("button", { name: /ชำระเงิน/ }).click();
    await page.getByRole("heading", { name: /ยืนยันชำระเงิน QR/ }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
    await page.getByText("ไม่มีสินค้าในตะกร้า").waitFor({ timeout: 15_000 });

    const qrOrder = await getLatestOrderByMenuItem(data.cookie.id);
    if (!qrOrder) throw new Error("Browser QR checkout did not create an order");
    assert(qrOrder.id !== cashOrder.id, "QR checkout reused the cash order");
    assert(qrOrder.paymentMethod === "QR", `QR payment method mismatch: ${qrOrder.paymentMethod}`);
    assert(qrOrder.payments[0]?.status === "CONFIRMED", "QR payment confirmation was not persisted");

    await addSimpleItem(page, data.cookie.name);
    await page.getByText(/ยอดรวม \(1 ชิ้น\)/).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "บัตร", exact: true }).click();
    await page.getByRole("button", { name: /ชำระเงิน/ }).click();
    await page.getByRole("heading", { name: /ยืนยันชำระเงิน บัตรเครดิต/ }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
    await page.getByText("ไม่มีสินค้าในตะกร้า").waitFor({ timeout: 15_000 });

    const cardOrder = await getLatestOrderByMenuItem(data.cookie.id);
    if (!cardOrder) throw new Error("Browser card checkout did not create an order");
    assert(cardOrder.id !== qrOrder.id && cardOrder.id !== cashOrder.id, "Card checkout reused an existing order");
    assert(cardOrder.paymentMethod === "CARD", `Card payment method mismatch: ${cardOrder.paymentMethod}`);
    assert(cardOrder.payments[0]?.status === "CONFIRMED", "Card payment confirmation was not persisted");

    await page.getByRole("link", { name: /คิวครัว/ }).click();
    await page.waitForURL("**/queue", { timeout: 10_000 });
    await page.getByText(/รอจัดเตรียม/).waitFor({ timeout: 10_000 });
    await page.getByText(`#${qrOrder.id}`).waitFor({ timeout: 10_000 });
    await page.getByText(`#${cardOrder.id}`).waitFor({ timeout: 10_000 });

    await page.getByRole("link", { name: /ออเดอร์\/เดลิเวอรี่/ }).click();
    await page.waitForURL("**/orders", { timeout: 10_000 });
    await page.getByPlaceholder("ค้นหาเลขออเดอร์ / สินค้า").fill(String(cashOrder.id));
    const cashOrderCard = page.getByTestId(`order-card-${cashOrder.id}`);
    await cashOrderCard.waitFor({ timeout: 10_000 });
    const cancelResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/orders/${cashOrder.id}`)
      && response.request().method() === "PATCH"
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId(`cancel-order-${cashOrder.id}`).click();
    const cancelResponse = await cancelResponsePromise;
    assert(cancelResponse.ok(), `Cancel response failed with ${cancelResponse.status()}`);
    await cashOrderCard.getByText("ยกเลิกแล้ว").waitFor({ timeout: 10_000 });

    const cancelledCashOrder = await prisma.order.findUnique({
      where: { id: cashOrder.id },
      include: { events: true }
    });
    assert(cancelledCashOrder?.status === "CANCELLED", "Order center cancellation did not persist");
    assert(cancelledCashOrder?.events.some((event) => event.eventType === "ORDER_CANCELLED"), "Cancellation event was not persisted");

    await page.getByRole("link", { name: "รายงาน" }).click();
    await page.waitForURL("**/reports", { timeout: 10_000 });
    await page.getByRole("heading", { name: "รายงาน" }).waitFor({ timeout: 10_000 });
    await page.getByText("จำนวนออเดอร์").waitFor({ timeout: 10_000 });

    await context.tracing.stop().catch(() => {});
    traceStopped = true;

    console.log("Browser E2E check passed");
    console.log(JSON.stringify({ branch: data.branchName, cashOrderId: cashOrder.id, qrOrderId: qrOrder.id, cardOrderId: cardOrder.id }, null, 2));
  } catch (error) {
    const artifactDir = path.join(root, "debug_screenshots");
    await fs.promises.mkdir(artifactDir, { recursive: true }).catch(() => {});
    const suffix = data?.tag || `failure-${Date.now()}`;
    await page?.screenshot({ path: path.join(artifactDir, `${suffix}.png`), fullPage: true }).catch(() => {});
    if (context && !traceStopped) {
      await context.tracing.stop({ path: path.join(artifactDir, `${suffix}-trace.zip`) }).catch(() => {});
      traceStopped = true;
    }
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    stopProcess(webProcess);
    stopProcess(apiProcess);
    await cleanupTestData(data);
    await prisma.$disconnect();
  }
}

async function expectDisabled(locator: import("playwright").Locator, message: string) {
  const disabled = await locator.isDisabled();
  assert(disabled, message);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
