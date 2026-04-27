# Big B Coffee POS — Development Log

## วันที่ 24 เม.ย. 2569

### สิ่งที่ทำวันนี้

#### Phase 1: Database Migration ✅
- เปลี่ยนจาก `db.json` (in-memory) → **SQLite** ด้วย `better-sqlite3`
- สร้าง `apps/api/src/db.ts` — Auto-migration + Seed data
- แยก `store.ts` (956 บรรทัด) ออกเป็น 7 modules:
  - `store/branches.ts` — จัดการสาขา
  - `store/customers.ts` — ลูกค้า/สมาชิก
  - `store/menu.ts` — สินค้า/เมนู
  - `store/inventory.ts` — สต็อก/วัตถุดิบ/สูตร
  - `store/orders.ts` — ออเดอร์/การขาย
  - `store/shifts.ts` — **ใหม่** เปิด-ปิดกะ
  - `store/users.ts` — **ใหม่** ผู้ใช้/PIN Login
  - `store/reports.ts` — รายงานยอดขาย
- Database path: `apps/api/data/pos.db`

#### Phase 2: Shift Management ✅ (Backend)
- API Endpoints:
  - `POST /api/shifts/open` — เปิดกะ
  - `POST /api/shifts/:id/close` — ปิดกะ
  - `GET /api/shifts/current?branchId=` — กะปัจจุบัน
  - `GET /api/shifts` — ประวัติกะทั้งหมด

#### Phase 3: PIN Login ✅ (Backend)
- `POST /api/auth/pin` — login ด้วย PIN 4 หลัก
- Default users:
  - PIN `1234` → ผู้จัดการ (admin)
  - PIN `1111` → แคชเชียร์ 1
  - PIN `2222` → แคชเชียร์ 2

#### Phase 4: Branch Setup ✅
- 4 สาขา:
  1. Big B Coffee วัชรเกียรติ (coffee)
  2. Big B Coffee พงษ์อนันต์ (coffee)
  3. Big B Coffee ศุภชัย (coffee)
  4. บ่อถ่ายน้ำมัน วัชรเกียรติ (oil_service)

#### สินค้าที่ Seed ไว้
- **กาแฟ 15 รายการ**: อเมริกาโน่, ลาเต้, คาปูชิโน่, มอคค่า, ชาเขียว, ชาไทย, โกโก้, น้ำส้ม, โซดามะนาว, ครัวซองต์, เค้ก, คุกกี้
- **บ่อถ่าย 12 รายการ**: น้ำมันเครื่อง 4T/ดีเซล/เบนซิน/เกียร์, ไส้กรองน้ำมัน/อากาศ, ค่าบริการเปลี่ยนถ่าย

### สิ่งที่ทำเพิ่ม (Frontend)
- ✅ Rebrand UI → "Big B Coffee" (BB logo, title, header)
- ✅ หน้า PIN Login (PIN 4 หลัก, กด Enter เข้าระบบ)
- ✅ ปุ่ม "เปิดกะ" + Modal ใส่เงินทอนเริ่มต้น
- ✅ ปุ่ม "ปิดกะ" + Modal นับเงินจริง + สรุปส่วนต่าง
- ✅ Closed Shift Summary Modal (แสดงยอดขาย, ส่วนต่างเงิน)
- ✅ กรองสินค้าตาม branchType (สาขา coffee เห็นแต่กาแฟ, สาขา oil เห็นแต่น้ำมัน)
- ✅ ปุ่ม "ออกจากระบบ" logout
- ✅ แสดงชื่อผู้ใช้และสถานะกะที่ header

### สิ่งที่ยังเหลือ
- [ ] Dashboard ใหม่ (POS metrics)
- [ ] Receipt Printing (ใบเสร็จ thermal 80mm)
- [ ] Keyboard Shortcuts (F12, F8)
- [ ] Import ข้อมูลจาก POSPOS เดิม

### Phase 5: Dashboard ✅
- เขียน DashboardPage.tsx ใหม่ทั้งหมดสำหรับ POS
  - KPI Cards: ยอดขาย 7 วัน, จำนวนออเดอร์, เฉลี่ย/บิล, สต็อกต่ำ
  - กราฟแท่ง CSS ยอดขายรายวัน 7 วัน
  - สินค้าขายดี Top 5
  - แจ้งเตือนสต็อกใกล้หมด
  - ประวัติกะล่าสุด 5 กะ

### Phase 6: Receipt Printing ✅
- Hidden receipt template 80mm สำหรับ `window.print()`
- `@media print` CSS แยกให้เฉพาะใบเสร็จ
- ปุ่ม 🖨️ พิมพ์ ข้างเลข ORDER

### Phase 7: Keyboard Shortcuts ✅
- `F12` → ยืนยันชำระเงิน
- `F8` → ล้างออเดอร์
- `Escape` → ปิด Modal
- แสดง `shortcut-hint` badge ที่ปุ่ม

### Phase 8: POSPOS Data ⏳
- Export จาก POSPOS: 1,721 transactions, 939 สินค้า, 1,038 สมาชิก
- ใช้แท็บ "ย้ายข้อมูล" ที่มีอยู่แล้วในระบบเพื่อ Import CSV

### Tech Stack
- Frontend: React 18 + TypeScript + Vite
- Backend: Express + TypeScript + tsx
- Database: SQLite (better-sqlite3, WAL mode)
- Port: Web `:5173` / API `:5175`

---

## วันที่ 25 เม.ย. 2569

### Phase 9: UI Redesign — Claude-Inspired ✅
- ใช้ impeccable skill สร้าง Design Context (`.impeccable.md`)
- **Typography**: Literata (serif display) + Figtree (sans body) แทน IBM Plex/Space Grotesk
- **Colors**: OKLCH warm sandy canvas — ไม่ใช่สีฟ้า/เทาอีกแล้ว
  - Canvas: `oklch(0.965 0.008 70)` — warm off-white
  - Accent: `oklch(0.52 0.14 45)` — warm sienna
  - Ink: `oklch(0.22 0.02 50)` — deep warm black
- **Tabs**: Clean segmented control (ไม่ใช่ pill pills อีกแล้ว)
- **Panels**: ไม่มี top gradient stripe, ไม่มี heavy shadow
- **Buttons**: Solid accent, ไม่มี gradient
- **ลบ Wazabin blue override block** ที่ conflict กับ design tokens ใหม่ (~160 บรรทัด)
- **แทนที่ hardcoded `#fff`** ทั้งหมดด้วย `var(--surface)`

### Phase 1.3: Auto-backup + Infrastructure Check ✅
- เพิ่ม `apps/api/src/backup.ts`
  - ใช้ `better-sqlite3` backup API เพื่อ snapshot `pos.db` แบบปลอดภัยกับ WAL
  - เก็บไฟล์ที่ `apps/api/data/backups/`
  - ตรวจ `PRAGMA integrity_check` หลังสร้าง backup
  - ลบ SQLite sidecar ของไฟล์ backup (`.db-shm`, `.db-wal`) หลัง verify/prune
  - retention default 48 ไฟล์
  - env config: `DB_BACKUP_ENABLED`, `DB_BACKUP_INTERVAL_MINUTES`, `DB_BACKUP_RETENTION_COUNT`, `DB_BACKUP_ON_STARTUP`, `DB_BACKUP_DIR`
- เพิ่ม protected admin endpoints:
  - `GET /api/backups/status`
  - `GET /api/backups`
  - `POST /api/backups`
- เพิ่ม CLI:
  - `npm run backup --workspace apps/api`
  - `npm run phase13:check --workspace apps/api`
- แก้ infra ภายใต้ Auth ใหม่:
  - `BranchProvider` โหลดสาขาหลังมี token แล้วเท่านั้น
  - `ShiftProvider` clear กะเก่าทันทีเมื่อเปลี่ยนสาขา แล้ว refresh กะใหม่
  - Checkout ส่ง `userId` และ `shiftId` เข้า API เพื่อให้ยอดกะขยับจริง
  - Checkout บังคับเปิดกะก่อนขาย
  - Cart ถูกล้างเมื่อเปลี่ยนสาขา เพื่อกันสินค้าข้าม branch type

---

## วันที่ 26 เม.ย. 2569

### Phase 2: Feature Polish — Discount, Member, Stock ✅
- เพิ่ม discount engine ฝั่ง API ใน `apps/api/src/store/orders.ts`
  - รองรับ rule stack: `ORDER_PERCENT`, `ORDER_FIXED`, `CATEGORY_PERCENT`, `BUY_X_GET_Y`
  - รองรับ max discount ต่อ rule และ fallback จาก discount เดิมแบบ `PERCENT`/`FIXED`
  - Backend คำนวณซ้ำเองก่อนบันทึกออเดอร์ เพื่อไม่เชื่อยอดจาก frontend อย่างเดียว
- ยกเครื่องหน้า POS:
  - ค้นหา/เลือกสมาชิกจากเบอร์หรือชื่อ
  - สมัครสมาชิกใหม่จากหน้าขาย
  - ใช้แต้มลดบิลแบบ capped ตามแต้มจริงและยอดหลังส่วนลด
  - เพิ่ม/ลบ/ล้าง promotion rules จากหน้าขาย
  - เพิ่ม payment method `EWALLET`
- ยกเครื่องหน้า Inventory:
  - เพิ่มสินค้า/วัตถุดิบ
  - ปรับสต็อกพร้อม stock movement
  - รับของเข้าเป็น purchase order และเพิ่มสต็อกทันที
  - แสดง low-stock และ movement ล่าสุด
- แก้ raw fetch หลังระบบ Auth:
  - Dashboard, Staff, Migration ใช้ `apps/web/src/api.ts` เพื่อแนบ token อัตโนมัติ
  - Dashboard ใช้สาขาที่ active จริงจาก `BranchContext`

### Phase 3: Integration Foundation ✅
- เพิ่ม `apps/api/src/store/integrations.ts`
  - สร้างตาราง `integration_outbox`
  - เก็บคิวงานสำหรับ `rd_tax`, `line_oa`, `lineman`
  - ตรวจ env ที่จำเป็นของแต่ละ provider
- `createOrder` จะ enqueue integration events หลังขายสำเร็จ:
  - `ORDER_TAX_RECEIPT_READY`
  - `ORDER_RECEIPT_MESSAGE_READY`
  - `ORDER_SYNC_READY`
- เพิ่ม admin endpoints:
  - `GET /api/integrations/status`
  - `GET /api/integrations/events`
  - `POST /api/integrations/events/:id/retry`
- เพิ่มหน้า Settings สำหรับ admin:
  - ดู readiness ของ RD / Line OA / Lineman
  - ดู pending/failed outbox
  - retry event ที่ยังไม่ sent

### Verification
- `npm run build` ผ่านทั้ง API และ Web
- `npm run phase13:check --workspace apps/api` ผ่าน
  - Checked 4 branches
  - เปิด/ปิดกะใหม่ #7-#9 และข้ามสาขาที่มีกะเปิด #6
  - สร้าง backup `pos-20260426011252272-phase13-check.db`
- Smoke test admin endpoints ใหม่:
  - integration providers = 3
  - integration events endpoint ตอบได้
  - purchases endpoint ตอบได้
