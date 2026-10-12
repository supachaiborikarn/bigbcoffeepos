# benzPOS / Big B Coffee POS

เว็บแอพ POS สำหรับ Big B Coffee: หน้าขาย, ยิงบาร์โค้ด, modifier เครื่องดื่ม, ชำระเงิน, ใบเสร็จ, สต็อกตาม recipe, สมาชิก/แต้ม, โปรโมชัน, รายงาน, กะพนักงาน, หลายสาขา และ integration outbox สำหรับ RD/e-Tax, Line OA, และ Lineman

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Runtime database: PostgreSQL ผ่าน Prisma (`DATABASE_URL`) สำหรับทั้ง development และ production

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

ถ้าไม่ตั้ง `DATABASE_URL` หรือใช้ค่า placeholder API จะไม่ start เพื่อป้องกันการรันแบบฐานข้อมูลไม่ตรงกับ store layer.

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

งานรับสินค้าและสต็อกอยู่ที่หน้า **สินค้า → รับเข้า / สต็อก**:

- รับจากบิลส่งของ: แยกผู้ขาย เลขบิล วันที่ และภาพบิล JPEG/PNG/WebP ไม่เกิน 2 MB พร้อมตรวจบิลซ้ำภายในสาขา
- สั่งซื้อก่อนรับ: สร้างรออนุมัติ อนุมัติแล้วรับเฉพาะจำนวนที่ส่งมา และดูจำนวนค้างรับกับประวัติรับแต่ละครั้ง
- ใบเบิก: แยกย้ายที่เก็บ ใช้จริง แจก และของเสีย โดยรายการรออนุมัติยังไม่เปลี่ยนยอดสต็อก
- ย้ายที่เก็บภายในสาขา: บันทึกต้นทาง/ปลายทางและจำนวนที่ย้าย โดยยอดรวมสาขาเท่าเดิม; ยังไม่มีบัญชียอดคงเหลือแยกแต่ละจุดเก็บ
- ประวัติสต็อก: รวมรับเข้า เบิก ขาย คืน โอน และนับ พร้อมตัวกรองช่วงวันตามเวลาประเทศไทย แบ่งหน้า และส่งออก CSV ตามตัวกรอง

การเบิก “ใช้จริง” คือของที่ใช้หมดนอกการขาย เช่น ทดลองสูตรหรือเครื่องดื่มพนักงาน; การขายตัดวัตถุดิบตามสูตรเอง จึงให้บันทึกการนำของมาวางหน้าเคาน์เตอร์เป็น “ย้ายที่เก็บ” เพื่อเก็บยอดรวมสาขาเดิม.

ภาพบิลเก็บในฐานข้อมูลเดิมและโหลดเฉพาะเมื่อเปิดดู; การอ่านตัวหนังสือจากรูปบิลอัตโนมัติยังไม่มีในรอบนี้.

การเพิ่มโครงสร้างข้อมูลใช้ migration `202610120001_inventory_workflows` และ `202610120002_inventory_document_lots` ซึ่งเพิ่มข้อมูลโดยเก็บใบรับและสต็อกเดิมไว้; ต้องรัน migration ก่อนเผยแพร่แอปเวอร์ชันนี้ และไม่ควรย้อนแอปเป็นเวอร์ชันเก่าหลังเริ่มรับของบางส่วนหรือใช้ใบเบิกใหม่ เพราะเวอร์ชันเก่าไม่รู้จักสถานะเหล่านี้.

ชุดตรวจหน้าจอรับสินค้าและใบเบิกใช้ API จำลองทั้งหมด:

```bash
npm run qa:receiving:check --workspace apps/web
npm run qa:stock-documents:check --workspace apps/web
```

ชุดตรวจฐานข้อมูลและ API ใช้เฉพาะ PostgreSQL ทดสอบบน localhost พร้อม `QA_DISPOSABLE_DB=true`; ชุด HTTP กำหนดพอร์ตทดสอบเป็น 55432 และไม่อ่านค่า connection ของร้านโดยอัตโนมัติ:

```bash
DATABASE_URL='postgresql://benzpos_qa@127.0.0.1:55432/benzpos_qa?schema=public' QA_DISPOSABLE_DB=true npm run qa:purchasing-workflows:check --workspace apps/api
DATABASE_URL='postgresql://benzpos_qa@127.0.0.1:55432/benzpos_qa?schema=public' QA_DISPOSABLE_DB=true npm run qa:stock-documents:check --workspace apps/api
DATABASE_URL='postgresql://benzpos_qa@127.0.0.1:55432/benzpos_qa?schema=public' QA_DISPOSABLE_DB=true npm run qa:inventory-http:check --workspace apps/api
```

```bash
npm run build
```

```bash
npm run production-hardening:check --workspace apps/api
```

Hardening check ตรวจ guard สำคัญ เช่น atomic checkout, stock guard, refund reversal, role/branch access, PIN hashing, payment confirmation, backend-owned modifier pricing, real order center, และ report exclusion สำหรับออเดอร์ที่ถูกยกเลิก/คืนเงิน

CI ใช้ PostgreSQL ชั่วคราวและรันชุดตรวจรวม:
```bash
npm run ci:verify
```

เมื่อมี `DATABASE_URL` ชี้ไปที่ test/staging PostgreSQL ให้รัน integration check ที่สร้างและลบข้อมูล `QA_CHECK_*` เอง:
```bash
npm run checkout:integration --workspace apps/api
npm run load:concurrency --workspace apps/api
npm run browser:e2e --workspace apps/api
```

ชุดตรวจปัญหา QA เดือนตุลาคมใช้ API จำลองและเบราว์เซอร์แยก โดยไม่แตะข้อมูลร้าน:
```bash
npm run qa:check
```

ชุดตรวจยอดเงิน สต็อก และเอกสารใช้เฉพาะฐานข้อมูลทดสอบ `benzpos_qa` บน localhost ซึ่งต้องสร้างและรัน migration ก่อน:
```bash
DATABASE_URL='postgresql://qa_user@127.0.0.1:5432/benzpos_qa?schema=public' QA_DISPOSABLE_DB=true npm run qa:database:check
```

Ops checks:
```bash
npm run monitoring:check --workspace apps/api
RESTORE_DATABASE_URL="postgresql://restored-db" npm run backup:restore-check --workspace apps/api
npm run data:readiness --workspace apps/api
```

Production deploy/runbook: [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md)
Monitoring policy: [docs/MONITORING_ALERTS.md](docs/MONITORING_ALERTS.md)

## Maintenance Scripts
API scripts ที่ตั้งใจให้ใช้ได้:
- `npm run orders:check --workspace apps/api`: สรุปจำนวนออเดอร์และ 5 รายการล่าสุดแบบ read-only
- `npm run data:export --workspace apps/api`: export stock/sales เป็น CSV ไปที่ `apps/api/downloads/exports` หรือกำหนด `EXPORT_OUT_DIR`
- `EXPORT_BRANCH_ID=1 npm run data:export --workspace apps/api`: export เฉพาะสาขา
- `ALLOW_MOCK_HISTORY=1 npm run mock-history:generate --workspace apps/api`: สร้างข้อมูล mock สำหรับ disposable/dev database เท่านั้น

สคริปต์ทดลองที่มี credential หรือ path ส่วนตัวไม่ควรถูก commit; ให้ใช้ env vars หรือสคริปต์ local นอก repo แทน

ล้างข้อมูล QA วันที่ 10–11 ตุลาคม 2026: รันจาก `apps/api` เพื่อสร้างรายการตรวจ โดยยังไม่แก้ฐานข้อมูล:
```bash
node --import tsx src/scripts/qa-cleanup-2026-10.ts --manifest /path/to/qa-manifest.json
```
ตรวจ ID และหลักฐานในไฟล์ก่อนตั้ง `reviewed=true`; การลบต้องได้รับอนุมัติและใช้ `--apply --manifest` โดยสคริปต์จะตรวจว่าข้อมูลยังตรงกับรายการเดิมและเก็บสต็อกปัจจุบัน ตั้งค่าร้าน พนักงาน และข้อมูลปิดกะไว้.

## Environment
API:
- `DATABASE_URL`: PostgreSQL connection string สำหรับ production/cloud
- `JWT_SECRET`: secret สำหรับ sign JWT; app จะ fail-fast ถ้าไม่มีค่านี้ใน env ที่ไม่ใช่ development/test/local
- `PORT`: API port ค่าเริ่มต้น `5175`
- `AUDIT_LOG_FILE`: path สำหรับ audit JSONL ค่าเริ่มต้น `apps/api/data/audit.log` เมื่อรันจาก workspace
- `SLOW_REQUEST_MS`: threshold สำหรับ log `http_request_slow` ค่าเริ่มต้น `1000`
- `INTEGRATION_OUTBOX_INTERVAL_MS`: interval worker สำหรับส่ง integration outbox ต้องตั้งแต่ `30000` ms ขึ้นไป

Frontend:
- `VITE_API_URL`: API base URL ค่าเริ่มต้น `http://localhost:5175/api`

Integration:
- POSPOS sync: `POSPOS_EMAIL`, `POSPOS_PASSWORD`
- RD/e-Tax: `RD_TAX_ENDPOINT`, `RD_TAX_CLIENT_ID`, `RD_TAX_CLIENT_SECRET`
- Line OA: `LINE_OA_CHANNEL_ACCESS_TOKEN`
- Lineman: `LINEMAN_API_ENDPOINT`, `LINEMAN_API_KEY`

## Database
API runtime ใช้ Prisma schema ที่ [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) และ PostgreSQL ผ่าน `DATABASE_URL`.

Migration:
```bash
npm run db:migrate --workspace apps/api
npm run db:migrate:status --workspace apps/api
```

โฟลเดอร์ `apps/api/prisma/migrations` มี baseline migration สำหรับ fresh PostgreSQL database และ delta migration สำหรับ production hardening.

SQLite files/tools ที่ยังอยู่ใน `apps/api/src/db.ts` และ `apps/api/src/backup.ts` เป็น legacy/local utility code เท่านั้น ไม่ใช่ runtime database ของ API routes. Endpoint backup จะตอบ unavailable ใน PostgreSQL runtime.

## Backup
Production backup ให้ใช้ managed PostgreSQL backup/snapshot ของ provider เช่น Neon/Vercel Postgres/hosted Postgres. SQLite auto-backup ไม่ถูกเปิดใช้ใน API runtime แล้ว.

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
- Audit: `GET /api/audit`, `GET /api/audit.csv`

## Notes
- Seeded legacy PINs may still be plain text for compatibility; newly created or updated PINs are hashed.
- The integration outbox currently queues events and exposes status/retry. Provider delivery depends on the corresponding env vars.
