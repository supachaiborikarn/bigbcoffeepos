import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import net from "net";
import path from "path";
import { chromium } from "playwright";
import prisma from "../prisma.js";

type TestData = {
  tag: string;
  pin: string;
  branchId: number;
  branchName: string;
  userId: number;
  menuItemId: number;
  menuItemName: string;
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
  const menuItem = await prisma.menuItem.create({
    data: { sku: tag, name: `${tag}_cookie`, category: "เบเกอรี่", basePrice: 40, branchType: "coffee", active: true }
  });
  return {
    tag,
    pin,
    branchId: branch.id,
    branchName: branch.name,
    userId: user.id,
    menuItemId: menuItem.id,
    menuItemName: menuItem.name
  };
}

async function cleanupTestData(data: TestData | null) {
  if (!data) return;
  const orders = await prisma.order.findMany({
    where: { items: { some: { menuItemId: data.menuItemId } } },
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
  await prisma.menuItem.deleteMany({ where: { id: data.menuItemId } });
  await prisma.user.deleteMany({ where: { id: data.userId } });
  await prisma.branch.deleteMany({ where: { id: data.branchId } });
}

async function main() {
  const root = path.resolve(process.cwd(), "../..");
  const apiPort = await getFreePort();
  const webPort = await getFreePort();
  const apiUrl = `http://127.0.0.1:${apiPort}/api`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  let apiProcess: ChildProcessWithoutNullStreams | undefined;
  let webProcess: ChildProcessWithoutNullStreams | undefined;
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
    webProcess = startProcess(path.join(root, "node_modules", ".bin", "vite"), ["--host", "127.0.0.1", "--port", String(webPort)], path.join(root, "apps/web"), env);

    await waitForUrl(`${apiUrl}/health`);
    await waitForUrl(webUrl);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${webUrl}/login`, { waitUntil: "networkidle" });
    await page.getByPlaceholder("● ● ● ●").fill(data.pin);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await page.waitForURL("**/branch", { timeout: 10_000 });
    await page.getByText(data.branchName).click();
    await page.waitForURL("**/pos", { timeout: 10_000 });

    await page.getByRole("button", { name: "เปิดกะ", exact: true }).click();
    await page.getByRole("button", { name: /ยืนยันเปิดกะ/ }).click();
    await page.getByRole("banner").getByText(/กะ #/).waitFor({ timeout: 10_000 });

    await page.getByPlaceholder("ค้นหาสินค้า (F1)").fill(data.menuItemName);
    await page.getByRole("button", { name: `เพิ่ม ${data.menuItemName}` }).click();
    await page.getByText(/ยอดรวม \(1 รายการ\)/).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: /ชำระเงิน/ }).click();
    await page.getByText("รับเงินสด").waitFor({ timeout: 10_000 });
    const cashModal = page.locator(".modal-backdrop").last();

    await cashModal.getByRole("button", { name: "1", exact: true }).click();
    await cashModal.getByRole("button", { name: "0", exact: true }).click();
    await expectDisabled(cashModal.getByRole("button", { name: "รับเงินและพิมพ์ใบเสร็จ" }), "Underpayment should keep cash confirmation disabled");

    await cashModal.getByRole("button", { name: "⌫", exact: true }).click();
    await cashModal.getByRole("button", { name: "⌫", exact: true }).click();
    await cashModal.getByRole("button", { name: "5", exact: true }).click();
    await cashModal.getByRole("button", { name: "0", exact: true }).click();
    const popupPromise = page.waitForEvent("popup", { timeout: 5_000 }).catch(() => null);
    await cashModal.getByRole("button", { name: "รับเงินและพิมพ์ใบเสร็จ" }).click();
    const popup = await popupPromise;
    await popup?.close();
    await page.getByText("ไม่มีสินค้าในตะกร้า").waitFor({ timeout: 15_000 });

    const order = await prisma.order.findFirst({
      where: { items: { some: { menuItemId: data.menuItemId } } },
      include: { payments: true, items: true }
    });
    if (!order) throw new Error("Browser checkout did not create an order");
    assert(order.total === 40, `Browser checkout total mismatch: ${order.total}`);
    assert(order.payments[0]?.amountReceived === 50, "Browser checkout payment evidence missing");

    await browser.close();
    console.log("Browser E2E check passed");
    console.log(JSON.stringify({ branch: data.branchName, orderId: order.id, total: order.total }, null, 2));
  } finally {
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
