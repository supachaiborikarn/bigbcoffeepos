import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = path.join(apiRoot, "data");
export const dbPath = path.join(dataDir, "pos.db");

import fs from "fs";
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath, {});
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* ─── Schema ─── */
db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    branch_type TEXT NOT NULL DEFAULT 'coffee',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    pin TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cashier',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT,
    barcode TEXT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    base_price REAL NOT NULL DEFAULT 0,
    cost REAL,
    branch_type TEXT NOT NULL DEFAULT 'coffee',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'ชิ้น',
    cost_per_unit REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ingredient_stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    stock_qty REAL NOT NULL DEFAULT 0,
    reorder_level REAL NOT NULL DEFAULT 0,
    UNIQUE(branch_id, ingredient_id)
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty REAL NOT NULL DEFAULT 1,
    UNIQUE(menu_item_id, ingredient_id)
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty REAL NOT NULL,
    reason TEXT NOT NULL DEFAULT 'ADJUSTMENT',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    customer_id INTEGER REFERENCES customers(id),
    user_id INTEGER REFERENCES users(id),
    shift_id INTEGER REFERENCES shifts(id),
    status TEXT NOT NULL DEFAULT 'PAID',
    subtotal REAL NOT NULL DEFAULT 0,
    discount_type TEXT,
    discount_value REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    loyalty_points_used INTEGER NOT NULL DEFAULT 0,
    loyalty_points_earned INTEGER NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    name TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 1,
    base_price REAL NOT NULL DEFAULT 0,
    modifiers TEXT NOT NULL DEFAULT '[]',
    line_total REAL NOT NULL DEFAULT 0,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    user_id INTEGER REFERENCES users(id),
    opening_cash REAL NOT NULL DEFAULT 0,
    closing_cash REAL,
    expected_cash REAL,
    difference REAL,
    total_sales REAL NOT NULL DEFAULT 0,
    total_orders INTEGER NOT NULL DEFAULT 0,
    cash_sales REAL NOT NULL DEFAULT 0,
    qr_sales REAL NOT NULL DEFAULT 0,
    card_sales REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id);
  CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shift_id);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_stock_movements_branch ON stock_movements(branch_id);
  CREATE INDEX IF NOT EXISTS idx_ingredient_stocks_branch ON ingredient_stocks(branch_id);
  CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branch_id);
  CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
`);

/* ─── Seed ─── */
const branchCount = (db.prepare("SELECT COUNT(*) as c FROM branches").get() as { c: number }).c;
if (branchCount === 0) {
  const insertBranch = db.prepare("INSERT INTO branches (name, location, branch_type) VALUES (?, ?, ?)");
  insertBranch.run("Big B Coffee วัชรเกียรติ", "สาขาวัชรเกียรติ", "coffee");
  insertBranch.run("Big B Coffee พงษ์อนันต์", "สาขาพงษ์อนันต์", "coffee");
  insertBranch.run("Big B Coffee ศุภชัย", "สาขาศุภชัย", "coffee");
  insertBranch.run("บ่อถ่ายน้ำมัน วัชรเกียรติ", "บริการเปลี่ยนถ่ายน้ำมันเครื่อง", "oil_service");

  /* Default users */
  const insertUser = db.prepare("INSERT INTO users (name, pin, role) VALUES (?, ?, ?)");
  insertUser.run("ผู้จัดการ", "1234", "admin");
  insertUser.run("แคชเชียร์ 1", "1111", "cashier");
  insertUser.run("แคชเชียร์ 2", "2222", "cashier");

  /* Coffee menu */
  const insertMenu = db.prepare("INSERT INTO menu_items (sku, barcode, name, category, base_price, cost, branch_type) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const coffeeItems = [
    ["C001", null, "อเมริกาโน่ร้อน", "กาแฟ", 45, 12, "coffee"],
    ["C002", null, "อเมริกาโน่เย็น", "กาแฟ", 55, 14, "coffee"],
    ["C003", null, "ลาเต้ร้อน", "กาแฟ", 55, 16, "coffee"],
    ["C004", null, "ลาเต้เย็น", "กาแฟ", 65, 18, "coffee"],
    ["C005", null, "คาปูชิโน่ร้อน", "กาแฟ", 55, 16, "coffee"],
    ["C006", null, "มอคค่าร้อน", "กาแฟ", 60, 20, "coffee"],
    ["C007", null, "มอคค่าเย็น", "กาแฟ", 70, 22, "coffee"],
    ["C008", null, "ชาเขียวเย็น", "ชา", 55, 15, "coffee"],
    ["C009", null, "ชาไทยเย็น", "ชา", 50, 12, "coffee"],
    ["C010", null, "โกโก้เย็น", "เครื่องดื่ม", 60, 18, "coffee"],
    ["C011", null, "น้ำส้มคั้นสด", "เครื่องดื่ม", 50, 20, "coffee"],
    ["C012", null, "โซดามะนาว", "เครื่องดื่ม", 40, 10, "coffee"],
    ["C013", null, "ครัวซองต์", "เบเกอรี่", 45, 22, "coffee"],
    ["C014", null, "เค้กช็อกโกแลต", "เบเกอรี่", 65, 30, "coffee"],
    ["C015", null, "คุกกี้ชิ้น", "เบเกอรี่", 25, 10, "coffee"],
  ] as const;
  coffeeItems.forEach(item => insertMenu.run(...item));

  /* Oil service menu */
  const oilItems = [
    ["OIL001", null, "น้ำมันเครื่อง 4T 1L", "น้ำมันเครื่อง", 250, 180, "oil_service"],
    ["OIL002", null, "น้ำมันเครื่อง 4T 0.8L", "น้ำมันเครื่อง", 200, 140, "oil_service"],
    ["OIL003", null, "น้ำมันเครื่องดีเซล 6L", "น้ำมันเครื่อง", 850, 600, "oil_service"],
    ["OIL004", null, "น้ำมันเครื่องเบนซิน 4L", "น้ำมันเครื่อง", 750, 520, "oil_service"],
    ["OIL005", null, "น้ำมันเกียร์ 1L", "น้ำมันเครื่อง", 180, 120, "oil_service"],
    ["FIL001", null, "ไส้กรองน้ำมัน มอเตอร์ไซค์", "ไส้กรอง", 80, 40, "oil_service"],
    ["FIL002", null, "ไส้กรองน้ำมัน รถยนต์", "ไส้กรอง", 180, 90, "oil_service"],
    ["FIL003", null, "ไส้กรองอากาศ มอเตอร์ไซค์", "ไส้กรอง", 100, 50, "oil_service"],
    ["FIL004", null, "ไส้กรองอากาศ รถยนต์", "ไส้กรอง", 250, 130, "oil_service"],
    ["SVC001", null, "ค่าบริการเปลี่ยนถ่าย มอเตอร์ไซค์", "ค่าบริการ", 50, 0, "oil_service"],
    ["SVC002", null, "ค่าบริการเปลี่ยนถ่าย รถยนต์", "ค่าบริการ", 150, 0, "oil_service"],
    ["SVC003", null, "ค่าบริการเช็คระดับน้ำมัน", "ค่าบริการ", 0, 0, "oil_service"],
  ] as const;
  oilItems.forEach(item => insertMenu.run(...item));

  /* Ingredients & Stock for branch 1 (coffee) */
  const insertIngredient = db.prepare("INSERT INTO ingredients (name, unit, cost_per_unit) VALUES (?, ?, ?)");
  const insertStock = db.prepare("INSERT INTO ingredient_stocks (branch_id, ingredient_id, stock_qty, reorder_level) VALUES (?, ?, ?, ?)");
  const insertRecipe = db.prepare("INSERT INTO recipes (menu_item_id, ingredient_id, qty) VALUES (?, ?, ?)");

  const coffeeIngredients = [
    ["เมล็ดกาแฟคั่ว", "kg", 400],
    ["นมสด", "ลิตร", 45],
    ["น้ำเชื่อม", "ลิตร", 60],
    ["ผงโกโก้", "kg", 200],
    ["ใบชาเขียว", "kg", 300],
    ["ชาไทย", "kg", 180],
    ["น้ำส้ม", "ลิตร", 80],
    ["โซดา", "ขวด", 15],
    ["แป้งครัวซองต์", "ชิ้น", 22],
    ["เค้กช็อกโกแลต", "ชิ้น", 30],
    ["คุกกี้", "ชิ้น", 10],
    ["แก้วเย็น 22oz", "ใบ", 3],
    ["แก้วร้อน 12oz", "ใบ", 2.5],
    ["หลอดดูด", "เส้น", 0.5],
  ] as const;

  coffeeIngredients.forEach((item, idx) => {
    const result = insertIngredient.run(...item);
    const ingredientId = result.lastInsertRowid as number;
    // Seed stock for all 3 coffee branches
    for (let b = 1; b <= 3; b++) {
      insertStock.run(b, ingredientId, b === 1 ? 50 : 30, 10);
    }
  });

  /* Oil service ingredients & stock */
  const oilIngredients = [
    ["น้ำมันเครื่อง 4T 1L", "ขวด", 180],
    ["น้ำมันเครื่อง 4T 0.8L", "ขวด", 140],
    ["น้ำมันเครื่องดีเซล 6L", "แกลลอน", 600],
    ["น้ำมันเครื่องเบนซิน 4L", "แกลลอน", 520],
    ["น้ำมันเกียร์ 1L", "ขวด", 120],
    ["ไส้กรองน้ำมัน มอเตอร์ไซค์", "ชิ้น", 40],
    ["ไส้กรองน้ำมัน รถยนต์", "ชิ้น", 90],
    ["ไส้กรองอากาศ มอเตอร์ไซค์", "ชิ้น", 50],
    ["ไส้กรองอากาศ รถยนต์", "ชิ้น", 130],
  ] as const;

  oilIngredients.forEach((item) => {
    const result = insertIngredient.run(...item);
    const ingredientId = result.lastInsertRowid as number;
    insertStock.run(4, ingredientId, 20, 5);
  });

  /* Simple 1:1 recipes for oil service */
  // Menu IDs 16-27 are oil items, ingredient IDs 15-23 are oil ingredients
  const oilMenuStart = 16;
  const oilIngStart = 15;
  for (let i = 0; i < 9; i++) {
    insertRecipe.run(oilMenuStart + i, oilIngStart + i, 1);
  }

  /* Simple coffee recipes */
  // Americano hot/cold = coffee beans
  insertRecipe.run(1, 1, 0.02); // americano hot = 20g beans
  insertRecipe.run(2, 1, 0.02);
  insertRecipe.run(2, 12, 1); // + cold cup
  // Latte = beans + milk
  insertRecipe.run(3, 1, 0.02);
  insertRecipe.run(3, 2, 0.15);
  insertRecipe.run(4, 1, 0.02);
  insertRecipe.run(4, 2, 0.15);
  insertRecipe.run(4, 12, 1);
  // Cappuccino = beans + milk
  insertRecipe.run(5, 1, 0.02);
  insertRecipe.run(5, 2, 0.12);
  // Mocha = beans + milk + cocoa
  insertRecipe.run(6, 1, 0.02);
  insertRecipe.run(6, 2, 0.12);
  insertRecipe.run(6, 4, 0.015);
  insertRecipe.run(7, 1, 0.02);
  insertRecipe.run(7, 2, 0.12);
  insertRecipe.run(7, 4, 0.015);
  insertRecipe.run(7, 12, 1);

  console.log("✅ Database seeded with Big B Coffee + Oil Service data");
}

export default db;
