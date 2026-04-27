import db from "./db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

export function runMigrations() {
  // Create migrations table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort(); // Run in alphabetical order (e.g., 001_init.sql, 002_add_column.sql)

  const appliedMigrations = db.prepare(`SELECT filename FROM _migrations`).all() as { filename: string }[];
  const appliedSet = new Set(appliedMigrations.map(m => m.filename));

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    
    // Use transaction for each migration
    const migrate = db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO _migrations (filename) VALUES (?)`).run(file);
    });

    try {
      migrate();
      console.log(`[Migration] Applied ${file}`);
      count++;
    } catch (err) {
      console.error(`[Migration] Failed to apply ${file}:`, err);
      process.exit(1); // Stop execution if a migration fails
    }
  }

  if (count > 0) {
    console.log(`[Migration] Successfully applied ${count} migrations.`);
  }
}
