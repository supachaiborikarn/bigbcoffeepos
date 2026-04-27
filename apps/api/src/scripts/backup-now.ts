import { createDatabaseBackup } from "../backup.js";

const reason = process.argv[2] || "manual-cli";

try {
  const backup = await createDatabaseBackup(reason);
  console.log(JSON.stringify(backup, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
