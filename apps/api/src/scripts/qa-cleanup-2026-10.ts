/**
 * Review a fixed QA cleanup manifest before deleting anything.
 *
 *   npx tsx src/scripts/qa-cleanup-2026-10.ts --manifest /path/to/qa-manifest.json
 *   npx tsx src/scripts/qa-cleanup-2026-10.ts --apply --manifest /path/to/qa-manifest.json
 *
 * Dry run only reads the database and saves a manifest; applying requires
 * reviewed=true and an unchanged snapshot. Current stock, shop settings,
 * staff and shift closing records are preserved.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import prisma from "../prisma.js";
import { applyQaCleanup, buildQaCleanupPlan, type QaCleanupManifest } from "./qaCleanupPlan.js";

async function main() {
  const index = process.argv.indexOf("--manifest");
  const file = index >= 0 ? process.argv[index + 1] : undefined;
  if (!file || file.startsWith("--")) throw new Error("ระบุ --manifest ตามด้วยไฟล์ JSON สำหรับตรวจรายการก่อนลบ");
  if (process.argv.includes("--apply")) {
    const manifest = JSON.parse(await readFile(resolve(file), "utf8")) as QaCleanupManifest;
    await applyQaCleanup(prisma, manifest);
    console.log("ล้างเฉพาะรายการที่ตรวจแล้ว โดยคงสต็อกจริง ตั้งค่าร้าน และข้อมูลปิดกะไว้");
    return;
  }
  const manifest: QaCleanupManifest = { version: 1, reviewed: false, generatedAt: new Date().toISOString(), plan: await buildQaCleanupPlan(prisma) };
  await writeFile(resolve(file), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(`บันทึกแผนตรวจที่ ${resolve(file)} โดยยังไม่แก้ฐานข้อมูล`);
  for (const [table, rows] of Object.entries(manifest.plan.rows)) console.log(`${table}: ${rows.map((row: any) => row.id).join(", ") || "ไม่มี"}`);
  console.log("ตรวจเลขรายการ หลักฐาน QA และผลต่อยอดกะในไฟล์ก่อนตั้ง reviewed=true; ข้อมูลจริงของร้านและยอดคริสตัลต้องยืนยันแยก");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error((error as Error).message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
