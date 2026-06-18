import "./src/env.js";
import { syncPosposData } from "./src/scripts/pospos-sync.js";

const ALL_BRANCHES = [1, 3, 4]; // วัชรเกียรติ, ศุภชัย, บ่อถ่ายน้ำมันเครื่อง

async function run() {
  const arg = process.argv[2];

  if (arg === "all") {
    console.log("🔄 Syncing ALL branches from POSPOS...\n");
    const results: Record<number, any> = {};
    for (const branchId of ALL_BRANCHES) {
      try {
        results[branchId] = await syncPosposData(branchId);
      } catch (err) {
        console.error(`❌ Branch ${branchId} failed:`, (err as Error).message);
        results[branchId] = { success: false, error: (err as Error).message };
      }
    }
    console.log("\n📊 Summary:");
    console.table(results);
    process.exit(0);
  }

  const branchId = parseInt(arg, 10);
  if (isNaN(branchId)) {
    console.error("Usage:");
    console.error("  npx tsx apps/api/run-sync.ts <branchId>   # Sync one branch");
    console.error("  npx tsx apps/api/run-sync.ts all           # Sync all branches");
    console.error("\nBranch IDs: 1 (วัชรเกียรติ), 3 (ศุภชัย), 4 (บ่อถ่ายน้ำมันเครื่อง)");
    process.exit(1);
  }

  try {
    const result = await syncPosposData(branchId);
    console.log("Result:", result);
    process.exit(0);
  } catch (err) {
    console.error("Sync Failed:", err);
    process.exit(1);
  }
}

run();
