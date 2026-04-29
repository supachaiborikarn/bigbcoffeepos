# benzPOS / Big B Coffee POS

เว็บแอพ POS สำหรับ Big B Coffee: หน้าขาย, ยิงบาร์โค้ด, modifier เครื่องดื่ม, ชำระเงิน, ใบเสร็จ, สต็อกตาม recipe, สมาชิก/แต้ม, โปรโมชัน, รายงาน, กะพนักงาน, หลายสาขา และ integration outbox สำหรับ RD/e-Tax, Line OA, และ Lineman

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Production database: PostgreSQL ผ่าน Prisma (`DATABASE_URL`)
- Local fallback: SQLite file mode สำหรับงานบนเครื่อง (`apps/api/data/pos.db`) เมื่อไม่ได้ตั้ง `DATABASE_URL` หรือใช้ placeholder

## Quick Start
1. ติดตั้ง dependencies ที่รากโปรเจกต์
```bash
npm install
```

2. ตั้งค่า environment สำหรับ API
```bash
cp apps/api/.env.example apps/api/.env
```

ค่าที่ควรมีสำหรับ production:
```bash
DATABASE_URL="postgresql://..."
JWT_SECRET="replace-with-long-random-secret"
```

ถ้าไม่ตั้ง `DATABASE_URL` ระบบจะเข้า local mode และใช้ SQLite พร้อม auto-backup.

3. เปิด dev servers
```bash
npm run dev --workspace apps/api
```
```bash
npm run dev --workspace apps/web
```

- Web: http://localhost:5173
- API: http://localhost:5175/api

## Build And Checks
```bash
npm run build
```

```bash
npm run production-hardening:check --workspace apps/api
```

Hardening check ตรวจ guard สำคัญ เช่น atomic checkout, stock guard, refund reversal, role/branch access, PIN hashing, payment confirmation, backend-owned modifier pricing, real order center, และ report exclusion สำหรับออเดอร์ที่ถูกยกเลิก/คืนเงิน

## Maintenance Scripts
API scripts ที่ตั้งใจให้ใช้ได้:
- `npm run orders:check --workspace apps/api`: สรุปจำนวนออเดอร์และ 5 รายการล่าสุดแบบ read-only
- `npm run data:export --workspace apps/api`: export stock/sales เป็น Excel ไปที่ `apps/api/downloads/exports` หรือกำหนด `EXPORT_OUT_DIR`
- `EXPORT_BRANCH_ID=1 npm run data:export --workspace apps/api`: export เฉพาะสาขา
- `ALLOW_MOCK_HISTORY=1 npm run mock-history:generate --workspace apps/api`: สร้างข้อมูล mock สำหรับ disposable/dev database เท่านั้น

สคริปต์ทดลองที่มี credential หรือ path ส่วนตัวไม่ควรถูก commit; ให้ใช้ env vars หรือสคริปต์ local นอก repo แทน

## Environment
API:
- `DATABASE_URL`: PostgreSQL connection string สำหรับ production/cloud
- `JWT_SECRET`: secret สำหรับ sign JWT ห้ามใช้ค่า fallback ใน production
- `PORT`: API port ค่าเริ่มต้น `5175`
- `AUDIT_LOG_FILE`: path สำหรับ audit JSONL ค่าเริ่มต้น `apps/api/data/audit.log` เมื่อรันจาก workspace

Frontend:
- `VITE_API_URL`: API base URL ค่าเริ่มต้น `http://localhost:5175/api`

Integration:
- POSPOS sync: `POSPOS_EMAIL`, `POSPOS_PASSWORD`
- RD/e-Tax: `RD_TAX_ENDPOINT`, `RD_TAX_CLIENT_ID`, `RD_TAX_CLIENT_SECRET`
- Line OA: `LINE_OA_CHANNEL_ACCESS_TOKEN`
- Lineman: `LINEMAN_API_ENDPOINT`, `LINEMAN_API_KEY`

## Database Modes
Production ใช้ Prisma schema ที่ [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) และ PostgreSQL ผ่าน `DATABASE_URL`.

Local mode ถูกเปิดเมื่อ:
- ไม่มี `DATABASE_URL`
- `DATABASE_URL` ขึ้นต้นด้วย `file:`
- `DATABASE_URL` มีคำว่า `placeholder`

Local mode จะใช้ SQLite ผ่าน `better-sqlite3`, สร้างไฟล์ที่ `apps/api/data/pos.db`, เปิด WAL mode, run local migrations จาก `apps/api/src/migrations`, และเริ่ม auto-backup ถ้าไม่ปิดไว้.

## Backup
ใช้ได้เฉพาะ local mode:
- สร้าง backup ตอน API start และทุก 60 นาทีตามค่าเริ่มต้น
- สร้าง backup เอง:
```bash
npm run backup --workspace apps/api
```
- ตั้งค่าได้ด้วย `DB_BACKUP_ENABLED`, `DB_BACKUP_INTERVAL_MINUTES`, `DB_BACKUP_RETENTION_COUNT`, `DB_BACKUP_ON_STARTUP`, `DB_BACKUP_DIR`

## Logging And Audit
API เขียน structured JSON logs ลง stdout/stderr เพื่อให้ Vercel, Docker, หรือ process manager เก็บต่อได้ง่าย.

Audit events เช่น login, user changes, stock adjustment, order create/cancel/refund, shift open/close, purchase, backup, และ integration retry จะถูกเขียนเป็น JSON ลง console และ append ไปที่ `AUDIT_LOG_FILE` ถ้า filesystem เขียนได้.

ตัวอย่าง audit line:
```json
{"ts":"2026-04-29T12:00:00.000Z","type":"audit","action":"order.created","actor":{"id":1,"role":"cashier","branchId":1},"orderId":123,"branchId":1,"total":120,"paymentMethod":"CASH"}
```

## Important POS Behaviors
- Checkout เป็น atomic transaction: order, shift totals, stock movement, customer points, และ integration outbox ต้องสำเร็จพร้อมกัน
- Stock ถูก validate ก่อนขาย และใช้ conditional decrement กันขายเกินสต๊อก
- Cash payment ต้องส่งยอดรับเงินที่พอจ่าย
- QR/Card/E-Wallet ต้องยืนยันการชำระเงินก่อนบันทึก order
- Cancel/refund จะคืน stock, reverse points, reverse shift totals และทำซ้ำแล้วไม่ reverse ซ้ำ
- Modifier pricing คำนวณจาก backend catalog ไม่เชื่อราคา add-on จาก client

## Main Endpoints
- Auth: `POST /api/auth/pin`
- Branches: `GET /api/branches`
- Menu: `GET /api/menu`, `POST /api/menu`, `PUT /api/menu/:id`
- Inventory: `GET /api/inventory`, `PUT /api/inventory/:ingredientId`, `POST /api/stock-adjustments`
- Orders: `GET /api/orders`, `POST /api/orders`, `PATCH /api/orders/:id`
- Shifts: `GET /api/shifts/current`, `POST /api/shifts/open`, `POST /api/shifts/:id/close`
- Reports: `GET /api/reports/summary`, `GET /api/reports/profit`, `GET /api/reports/staff`
- Purchases: `GET /api/purchases`, `POST /api/purchases`
- Integrations: `GET /api/integrations/status`, `GET /api/integrations/events`, `POST /api/integrations/events/:id/retry`

## Notes
- Seeded legacy PINs may still be plain text for compatibility; newly created or updated PINs are hashed.
- The integration outbox currently queues events and exposes status/retry. Provider delivery depends on the corresponding env vars.
