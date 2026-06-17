# benzPOS Follow-up Fix Tasks

Updated: 2026-04-29

## Production 100/100 Roadmap

### Phase 1: P1 Blockers

- [x] Make database/local story truthful and executable.
  - Decision: production and development API use PostgreSQL/Prisma as the supported runtime database.
  - Remove misleading SQLite local fallback from runtime startup/docs, or convert it to backup-only legacy tooling.
  - Acceptance: fresh clone with `DATABASE_URL` works; missing `DATABASE_URL` fails with a clear setup error instead of half-starting.
- [x] Enforce branch scope on `GET /api/orders/:id`.
  - Acceptance: cashier from branch A gets `403` for branch B order details; admin/manager can access as designed.

### Phase 2: P2 Production Safety

- [x] Fail fast when `JWT_SECRET` is missing in production.
  - Acceptance: `NODE_ENV=production` without `JWT_SECRET` exits before serving requests.
- [x] Persist payment evidence in the database.
  - Add `Payment` table or order payment fields for amount due, received, change, status, confirmation time, reference number, and confirming user.
  - Acceptance: receipt reprint/reconciliation/refund can read payment evidence from DB.

### Phase 3: Reliability And Accounting

- [x] Add order/refund event history.
  - Acceptance: every cancel/refund has actor, reason, timestamp, and monetary/stock effect.
- [x] Add checkout idempotency key.
  - Acceptance: retrying the same checkout request cannot create duplicate orders.
- [x] Harden integration outbox worker/retry observability.
  - Acceptance: failed provider events are visible, retryable, and do not disappear.

### Phase 4: QA And Ops

- [x] Add automated database-backed integration tests for checkout, stock, branch isolation, refund, payment validation, and reports.
- [x] Add deploy/runbook documentation for migrations, env vars, health checks, backup, rollback, and incident response.
- [x] Add operational monitoring targets: request id, slow query/error logs, audit search/export, outbox failure alerting.

### Phase 5: Final 92-95% To 100%

- [x] Add CI gate for every push/PR.
  - Run `npm run build`, `npm run production-hardening:check --workspace apps/api`, and a DB-backed `npm run checkout:integration --workspace apps/api` against a disposable/staging PostgreSQL database.
  - Acceptance: merge is blocked when build, hardening, migration, or checkout integration checks fail.
- [x] Add real deployment pipeline and migration safety.
  - Use `prisma migrate deploy` as a required deploy step, document baseline handling, and add a predeploy check that fails if migrations are pending or drift is detected.
  - Acceptance: deploy cannot start app code against an old schema.
- [x] Add provider-level backup and restore verification.
  - Configure PostgreSQL snapshot/PITR with the hosting provider and run a scheduled restore drill to a staging database.
  - Progress: restore drill script and monthly/manual GitHub workflow added; repository secrets `DATABASE_URL` and `RESTORE_DATABASE_URL` must be set for the provider-restored drill artifact.
  - Acceptance: restore drill has timestamp, restored DB URL, row-count sanity checks, and rollback steps recorded.
- [x] Add production monitoring and alert channels.
  - Wire JSON logs to the hosting/log platform and alert on `http_request_slow`, 5xx bursts, `integration_outbox_attention_required`, stale pending outbox, and audit file write failures.
  - Progress: direct JSON webhook alerts added via `ALERT_CHANNEL_URL`, admin/CLI alert tests added, and monitoring policy checks enforce channel config when `REQUIRE_ALERT_CHANNEL=1`.
  - Acceptance: alerts route to the owner channel and include request id / failing endpoint / branch impact.
- [x] Add browser E2E for full POS operator flow.
  - Cover login, branch select, open shift, add multi-item order with modifiers, cash underpayment rejection, QR/card confirmation, receipt, cancel/refund, order center, queue, and daily close report.
  - Progress: headless browser E2E now covers login, branch select, open shift, modified multi-item cash order, underpayment guard, QR confirmation, card confirmation, receipt popup, queue, order center cancel, reports, and persisted payment evidence.
  - Acceptance: E2E runs headless in CI and captures screenshots/traces on failure.
- [x] Add sustained concurrency/load test.
  - Simulate multiple cashiers and branches creating orders/refunds while stock is low.
  - Acceptance: no duplicate idempotency keys, no negative stock, shift totals match paid minus refunded orders, and p95 API latency target is documented.
- [x] Add production data readiness checklist.
  - Verify menu categories, recipes for stock-controlled products, reorder levels, branch users/roles, payment method settings, tax/receipt text, and POSPOS import source separation.
  - Progress: readiness check added and exact-match recipe bootstrap applied for 1,029 stock-backed menu items; current data readiness report has no findings.
  - Acceptance: pilot branch can pass a real day-close rehearsal with no manual database edits.

### Current Readiness Estimate

- Current code readiness: 100% for the reviewed POS/backend scope.
- Operational sign-off before live opening: configure live `ALERT_CHANNEL_URL`, provider backup/PITR, and GitHub `RESTORE_DATABASE_URL`, then archive the first restore-drill artifact from the real provider-restored database.

## Goal

Close the UI/workflow gaps found in the latest audit so the POS can be used end-to-end by staff, and separate unfinished feature shells from production-ready flows.

## POS Cup Modifier Cleanup

- [x] Move shop-cup, dine-in cup, bring-your-own cup, and hot takeaway cup choices into the modifier modal instead of separate product cards.
- [x] Hide prepared drink cup-variant cards from the POS product grid while keeping historical menu rows intact.
- [x] Cut stock for `แก้วเย็น` and hot `แก้วเดินทาง` from backend checkout/refund logic.
- [x] Update integration, browser E2E, and production-hardening checks to cover cup modifiers and hidden cup variants.

## Critical

- [x] Restore an accessible open/close shift control in the main app shell.
- [x] Ensure the POS checkout path is not blocked by hidden shift controls.
- [x] Reconnect cart UI controls for member signup, loyalty point redemption, and discount rules.
- [x] Add a visible warning/empty-state path for stock recipes because the current production data has no recipes.

## High

- [x] Clean up the POS product browsing experience for large menus: category overflow, too many products rendered at once, and low-stock noise.
- [x] Replace or hide the Marketing/Promotion Coming Soon page.
- [x] Wire integration outbox processing to a real worker/cron/manual admin action, not only retry-to-pending.
- [x] Align POSPOS migration response fields with the frontend log output.
- [x] Stop importing historical POSPOS orders without order items, or clearly label them as sales-only records.

## Medium

- [x] Either implement or remove unused frontend API helpers for CSV/import endpoints.
- [x] Persist shift close cash denomination counts and closing note.
- [x] Guard `/queue` with auth/branch selection or move it under the app layout.
- [x] Remove or integrate the unused mock document detail page.
- [x] Add automated smoke coverage for login, branch select, open shift, checkout, refund/cancel, and stock decrement.

## This Pass

- [x] Make shift controls visible and usable.
- [x] Add missing cart controls for member signup, point redemption, and discount rules.
- [x] Fix POSPOS migration success log field names.
- [x] Add recipe readiness signal in inventory/POS where appropriate.
- [x] Build and smoke test the main POS flow.
- [x] Add printable daily send-total summary for end-of-day reporting.

## Real-use POS Fix Pass

- [x] Fix discount rule input guards so cart totals recalculate reliably after adding a promotion.
- [x] Make the cash drawer modal explicit with a "receive money and print receipt" action.
- [x] Pre-open receipt print windows from the user click so auto-print is not blocked after checkout.
- [x] Allow branch cashiers to cancel bills safely, while keeping cross-branch protection.
- [x] Add cancel actions and clearer status labels in order center and kitchen queue.
- [x] Limit operational order center and queue views to the active shift so historical/POSPOS data does not appear as pending work.
- [x] Import future POSPOS historical sales as completed orders instead of pending work.
- [x] Convert the daily send-total printout to 80mm receipt-paper layout.

## POSPOS Data Utilization Roadmap

### Phase 1: Report Source Separation

- [x] Add report source filters: system sales, POSPOS sales-only imports, and all sales.
- [x] Show POSPOS sales-only totals/counts separately in sales reports and daily close reports.
- [x] Ensure exported order CSV includes source labels so imported totals are auditable.
- [x] Keep imported sales-only rows out of menu/profit rankings unless the user explicitly selects POSPOS/all data.
- [x] Preserve receipt/staff context in future POSPOS sales-only imports.

### Phase 2: Stock Recipe Readiness

- [x] Add recipe coverage status per menu item: has recipe, missing recipe, or not stock-tracked.
- [x] Create a fast recipe-mapping workflow from imported stock ingredients to menu items.
- [x] Add recipe templates for common coffee/oil-service products.
- [x] Add report for sold items that cannot decrement stock because recipe data is missing.

### Phase 3: Customer And Staff Mapping

- [x] Map POSPOS staff names to local users for historical sales attribution.
- [x] Store POSPOS customer metadata when available, such as tier, notes, birthday, or total spend.
- [x] Link imported POSPOS receipts to customers when POSPOS exposes member data in receipt details.
- [x] Add customer insight widgets: recent spend, inactive customers, and high-value customers.

Current POSPOS customer scrape exposes only name and phone, but importer now accepts customer metadata/member fields when receipt detail/member APIs are captured.

### Phase 4: Product Metadata Expansion

- [x] Import or support product images where POSPOS exposes them.
- [x] Support modifier/option catalogs instead of treating every variant as a separate product.
- [x] Normalize noisy categories from POSPOS into shop-friendly groups.
- [x] Add product tax/unit metadata when the source provides it.

---

# POSPOS Parity Roadmap (2026-06-16)

ที่มา: เปรียบเทียบ benzPOS กับ go.pospos.co เพื่อให้แทน POSPOS ได้เต็มตัวสำหรับร้านกาแฟ + มินิมาร์ท
สถานะแกนหลัก (ขาย/modifier/ชำระเงิน/กะ/หลายสาขา/รายงาน/refund/migrate) = พร้อมแล้ว
ด้านล่างคือช่องว่างที่เหลือ จัดเป็นเฟสตามความสำคัญ

หมายเหตุ build: การเปลี่ยน `schema.prisma` ต้องรัน `npm run build --workspace apps/api` (ซึ่งจะ `prisma generate` + `tsc`) บนเครื่องที่ต่อเน็ตได้ เพื่อ regenerate Prisma client

## Phase A — ก่อนเปิดใช้แทนจริง (go-live blockers)

- [x] ตั้งค่าร้าน/ใบเสร็จ (Store Settings) — ชื่อร้าน, ที่อยู่, เลขผู้เสียภาษี, สาขา, หัว/ท้ายใบเสร็จ, โหมด VAT (รวม/ไม่รวม/ไม่มี), อัตรา VAT, วิธีชำระเงินที่เปิดใช้
  - schema: model `StoreSetting` (ต่อสาขา) + migration
  - API: `GET/PUT /api/settings/store`
  - UI: แท็บ "ข้อมูลร้าน/ใบเสร็จ" ในหน้า Settings (admin)
- [x] ใบกำกับภาษีอย่างย่อบนใบเสร็จ — ดึงชื่อร้าน/เลขภาษี/ที่อยู่จาก settings, แสดงยอดก่อน VAT + VAT + รวม, เลขที่ใบเสร็จ
- [x] ใบกำกับภาษีเต็มรูป — เก็บข้อมูลผู้ซื้อ (ชื่อ/เลขภาษี/ที่อยู่/สาขา), running number ต่อสาขา, พิมพ์เอกสารเต็มรูป
- [x] พิมพ์สติ๊กเกอร์บาร์โค้ด — สร้าง/พิมพ์ป้ายบาร์โค้ด (Code128) จากหน้าเมนู/สินค้า พร้อมชื่อ+ราคา
- [x] พักบิล / เรียกบิลคืน (Hold / Park) — พักตะกร้าหลายใบแล้วเรียกกลับมาคิดเงิน
- [x] โหมดออฟไลน์ (PWA) — ขายต่อได้เมื่อเน็ตหลุด แล้ว sync เมื่อกลับมาออนไลน์ (service worker + คิวออเดอร์ + idempotency)
- [x] ต่อ e-Tax provider จริง — ส่ง e-Tax Invoice (ETDA timestamp / INET) จาก outbox ที่มีอยู่ ไม่ใช่แค่ queue

## Phase B — งานคลัง/สต็อกฝั่งมินิมาร์ท

- [x] นับสต็อก (Stocktake) — เปิดรอบนับ, กรอกยอดนับจริง, ระบบคำนวณส่วนต่าง + บันทึก stock movement
  - schema: model `StockCount` + `StockCountItem`
- [x] โอนสต็อกระหว่างสาขา — ใบโอนเข้า/ออก, ตัด/เพิ่มสต็อกสองสาขา, สถานะอนุมัติ
  - schema: model `StockTransfer` + `StockTransferItem`
- [x] หน่วยสินค้าแบบลัง/แพ็ก — แปลงหน่วย (1 ลัง = 12 ขวด), ขายได้ทั้งสองหน่วย, ตัดสต็อกถูกต้อง
- [x] หลายระดับราคา (ปลีก/ส่ง) — ราคาตามประเภทลูกค้า/จำนวน
- [x] แจ้งเตือนสินค้าหมดอายุ (lot/expiry) — เก็บ lot + วันหมดอายุ, แจ้งเตือนใกล้หมดอายุ
- [x] อนุมัติใบสั่งซื้อ (PO approval) — เพิ่ม flow อนุมัติให้ purchases ที่มีอยู่
- [x] สินค้า SKU แบบมีคุณสมบัติ (สี/ไซส์) — variant matrix

## Phase C — CRM / โปรโมชั่น

- [x] โปรโมชั่นแบบบันทึก/ตั้งเวลา — เก็บแคมเปญ + auto-apply ตอนขาย (ต่อยอดจาก discount rules ที่มี)
  - schema: model `Promotion`
- [x] คูปองส่วนลด — รหัสคูปอง, จำกัดจำนวน/วันหมดอายุ
- [x] ระดับสมาชิก (tier) + บัตรสมาชิก + เครดิตสมาชิก — ต่อยอดจากระบบแต้มที่มี
- [x] ป้ายกำกับ/กลุ่มลูกค้า + เชื่อม LINE OA CRM

## Phase D — เอกสาร / รายงาน / อื่นๆ

- [x] เอกสารเพิ่ม: ใบส่งของ/ใบแจ้งหนี้, ใบเสนอราคา, ใบลดหนี้/ใบคืนสินค้า
- [x] นำออกข้อมูลภาษี (Excel) สำหรับยื่นสรรพากร
- [x] รายงานเทียบ 2 ช่วงเวลา / เทียบ 2 สาขา
- [x] อีเมลสรุปยอดขายรายวันอัตโนมัติ
- [x] จอแสดงผลฝั่งลูกค้า (customer display)
- [x] เชื่อม marketplace (Shopee/Lazada) ถ้าต้องการ

## UI polish log (ดูจอจริงผ่าน Chrome แล้วปรับ)
- 2026-06-16: รีวิว UI สดผ่าน Claude-in-Chrome (login → branch → POS/dashboard/parity)
  - การ์ดสินค้า POS: เปลี่ยนจากการ์ดโล่งสูง (1 คอลัมน์ พื้นที่ว่างเยอะ) เป็นไทล์แนวนอนแน่น — avatar รูป/ตัวอักษรนำหน้า + ชื่อ + ป้ายหมวด + ราคา, แสดงรูปสินค้าอัตโนมัติถ้ามี imageUrl (ProductCard.tsx + .menu-card--pos ใน styles.css, grid minmax 150→240)
  - แก้ TopBar ทับกัน: `.input{width:100%}` override ทำให้ dropdown สาขากินเต็มแถบจนชนข้อมูลผู้ใช้/กะ — เพิ่ม `select.topbar__branch-select` width override
  - ตรวจแล้ว: web `tsc` ผ่าน, ดูผลสดยืนยันแล้ว
  - ปรับตามฟีดแบ็ก (จอเล็ก ใช้นิ้วกด): เปลี่ยนการ์ดสินค้าเป็น **การ์ดใหญ่แบบกริด** (รูป/ตัวอักษรใหญ่ด้านบน), โชว์**ชื่อเมนูเต็ม** (เลิกตัดบรรทัด), ป้ายจำนวนตัวเลือกย้ายไปมุมรูป, ราคาเด่น
    - layout จอเล็ก: cart panel = clamp(300px,30vw,420px), sidebar หดผ่าน media query (≤1180px→208px, ≤920px→184px) → ได้ 2 การ์ดใหญ่/แถวที่ 1024px, 3 การ์ด/แถวที่ 1440px
    - ยืนยันด้วยภาพจริงที่ 1024 และ 1440 แล้ว
- 2026-06-16 all-pages pass (ตรวจทุกหน้าผ่านจอจริงก่อน push):
  - ตรวจ + ยืนยันสวย/สม่ำเสมอ: Login, เลือกสาขา, POS, แดชบอร์ด, เมนู/สต็อก (Inventory), รายงาน, ตั้งค่า (Store Settings ของผมแสดงครบ), ออเดอร์/เดลิเวอรี่
  - /parity: แยกแผง "นับสต็อก · โอนสต็อก" เป็น 2 ส่วนย่อยมี label ① นับสต็อก / ② โอนสต็อก ให้ไม่สับสน
  - ตรวจ build สุดท้าย: `tsc --noEmit` ผ่านทั้ง api และ web → พร้อม push
  - ก่อน push: รัน `npm run build` + `npm run production-hardening:check` บนเครื่อง แล้ว push; ดึงข้อมูล POSPOS ด้วย `npm run sync:pospos` (ต้องตั้ง POSPOS_EMAIL/POSPOS_PASSWORD)

## Feature log
- 2026-06-16: เพิ่มฟีเจอร์ "อนุญาตขายแม้สต็อกไม่พอ (ขายติดลบ)" แบบเปิด/ปิดรายสาขา
  - เหตุ: สาขาใหม่ (เช่น พงษ์อนันต์) วัตถุดิบสต็อก = 0 เกือบทั้งหมด → ระบบกันขายเกินสต็อก ขึ้น "สต็อกไม่พอ: วัตถุดิบ #... คงเหลือ 0" → ขายไม่ได้
  - เพิ่มฟิลด์ `StoreSetting.allowNegativeStock` (default false) + migration `202606160004_allow_negative_stock`
  - `createOrder`: ถ้า allowNegativeStock=true ของสาขานั้น → ตัดสต็อกแบบ upsert ปล่อยติดลบ ไม่ throw (เหมือน flexible stock)
  - UI: เพิ่ม toggle ในหน้า ตั้งค่า → ข้อมูลร้าน/ใบเสร็จ (รายสาขา)
  - ตรวจ: `tsc --noEmit` ผ่านทั้ง api/web
  - **ลำดับ deploy สำคัญ (เป็น schema change):**
    1. รัน migration บน DB production ก่อน: `npm run db:migrate --workspace apps/api` (ตั้ง DATABASE_URL=prod) — ALTER TABLE เพิ่มคอลัมน์ (backward-compatible กับโค้ดเก่า)
    2. แล้วค่อย push → Vercel deploy โค้ดใหม่ (build รัน prisma generate)
    3. เข้า ตั้งค่า → ข้อมูลร้าน เลือกสาขาใหม่ → ติ๊ก "อนุญาตขายแม้สต็อกไม่พอ" → บันทึก → ขายได้เลย
    - ถ้า deploy โค้ดใหม่ก่อนรัน migration: storeSetting.findUnique จะ select คอลัมน์ที่ยังไม่มี → error ดังนั้นต้อง migrate ก่อน

## Feature log (reprint)
- 2026-06-16: เพิ่ม "พิมพ์ใบเสร็จซ้ำ" จากออเดอร์เดิม
  - เดิม: printReceipt เรียกได้แค่ตอนขายใน POS เท่านั้น → พิมพ์ซ้ำไม่ได้
  - เพิ่มปุ่ม "พิมพ์ซ้ำ" ในการ์ดทุกออเดอร์ หน้า ออเดอร์/เดลิเวอรี่ (OrdersPage) — แปลง order.items → ใบเสร็จดีไซน์เดียวกับตอนขาย, ดึง store settings ของสาขานั้น, ติดป้าย "สำเนาใบเสร็จ" (บ่อถ่ายพิมพ์ 3 ใบ สำเนา-สำนักงาน/ร้าน/ลูกค้า)
  - ใช้หน้าต่างพิมพ์แยก (ไม่บล็อกจอ) เหมือน checkout
  - ตรวจ: web `tsc` ผ่าน

## Feature log (receipt)
- 2026-06-16: ออกแบบใบเสร็จใหม่ + พิมพ์หลายใบสำหรับบ่อถ่าย
  - ใบเสร็จเปลี่ยนจาก monospace (Courier) เป็น layout HTML สไตล์สวยขึ้น: โลโก้ + ชื่อร้านตัวใหญ่ + ที่อยู่/เลขภาษี, หัวข้อใบกำกับภาษีอย่างย่อ, รายการแบบ flex (ชื่อ-ราคาชิดขอบ) + ตัวเลือก/หมายเหตุใต้รายการ, กล่องยอดสุทธิเส้นหนา, แยก VAT, ฟอนต์ไทย IBM Plex Sans Thai (ReceiptPrinter.tsx `renderSlip`)
  - สาขา oil_service (บ่อถ่าย) พิมพ์ **3 ใบแยกกัน** ต่อบิล: "สำหรับสำนักงาน" / "สำหรับร้าน (เก็บที่บ่อ)" / "สำหรับลูกค้า" — แต่ละใบมีป้ายกำกับชัด คั่นด้วย page-break (printReceipt รับ copies/copyLabels; POSPage ตั้งให้ตาม branchType)
  - สาขาอื่นพิมพ์ 1 ใบตามปกติ
  - ตรวจ: web `tsc` ผ่าน; ต้อง redeploy ให้มีผล

## Bugfix log
- 2026-06-16: แก้ "สต็อกใกล้หมด" โชว์ข้ามสาขา/วัตถุดิบที่ไม่เกี่ยวข้อง
  - เหตุ: inventory ต่อสาขาถูกต้อง (วัตถุดิบที่ไม่มีในสาขานั้น = stock 0, reorder 0) แต่ตัวกรองใช้ `stockQty <= reorderLevel` → 0 <= 0 เป็นจริง → วัตถุดิบที่ยังไม่ตั้งค่าทั้งหมดถูกนับเป็น "ใกล้หมด" (บ่อถ่ายเลยโชว์วัตถุดิบกาแฟทั้งกองที่เป็น 0/0)
  - แก้: นับ low stock เฉพาะรายการที่ตั้งจุดสั่งซื้อแล้ว → `reorderLevel > 0 && stockQty <= reorderLevel` (DashboardPage + InventoryPage `lowStockItems`)
  - ผล: บ่อถ่าย (ยังไม่ตั้ง reorder) จะไม่โชว์สต็อกใกล้หมด; สาขากาแฟโชว์เฉพาะที่ตั้งเกณฑ์ไว้และต่ำจริง + ตัวเลข "สต็อกต่ำ" ไม่บวมเกินจริง
  - หมายเหตุ: ตาราง Ingredient เป็น global ทุกสาขาใช้ร่วมกัน (หน้า "สต็อกวัตถุดิบ" ยังลิสต์วัตถุดิบทั้งหมดได้) — การแจ้งเตือนใกล้หมดตอนนี้แยกสาขาถูกต้องแล้ว
- 2026-06-16: แก้บั๊ก "POS ค้างตอนกดรับเงิน+พิมพ์ใบเสร็จ"
  - สาเหตุ: `printReceipt` ถูกเรียกแบบไม่มี targetWindow → ใช้ iframe + `window.print()` ซึ่งบล็อก thread ของหน้าต่างหลักจนกว่าจะปิด print dialog → POS เหมือนค้าง (ออเดอร์/ตัดสต็อกบันทึกสำเร็จแล้ว แต่จอค้างที่ dialog)
  - แก้: `handleCheckout` เปิดหน้าต่างพิมพ์แยก (`window.open` ภายใน user gesture ตอนคลิก) แล้วส่งเข้า `printReceipt` เป็น targetWindow → พิมพ์ในหน้าต่างนั้น หน้าต่าง POS หลักไม่ถูกบล็อก; ปิดหน้าต่างพิมพ์อัตโนมัติหลังพิมพ์/ถ้า checkout ล้มเหลว
  - `ReceiptPrinter` targetWindow path: `document.open()` ก่อนเขียน + try/catch fallback ไป iframe
  - ตรวจ: web `tsc` ผ่าน; ต้อง redeploy (push/promote) ให้ production ได้รับการแก้นี้
  - หมายเหตุ: ถ้าเบราว์เซอร์บล็อก popup จะ fallback กลับไป iframe (บล็อกได้) → ผู้ใช้ควรอนุญาต pop-up ของโดเมนนี้ หรือใช้โหมด kiosk printing ของเบราว์เซอร์เพื่อพิมพ์เงียบ

## Progress log
- 2026-06-16: เขียน roadmap; ทำ Phase A ส่วนแรก — Store Settings (model+API+UI), ใบกำกับภาษีอย่างย่อบนใบเสร็จ, พิมพ์บาร์โค้ด Code128, พักบิล/เรียกบิล
  - ไฟล์ที่เพิ่ม/แก้: prisma/schema.prisma (+model StoreSetting), migrations/202606160001_store_settings, src/store/settings.ts, src/store/index.ts, src/index.ts (routes), web/src/types.ts, web/src/api.ts, web/src/components/settings/StoreSettingsPanel.tsx, web/src/pages/SettingsPage.tsx, web/src/components/ReceiptPrinter.tsx, web/src/pages/POSPage.tsx, web/src/utils/barcode.ts, web/src/pages/InventoryPage.tsx, web/src/contexts/CartContext.tsx
  - ตรวจแล้ว: web `tsc --noEmit` ผ่าน; barcode Code128 table ผ่าน integrity check
  - ต้องรันก่อนใช้งานจริง: `npm run db:migrate --workspace apps/api` แล้ว `npm run build`
  - ต่อไป (ยังไม่ทำ): ใบกำกับภาษีเต็มรูป, โหมดออฟไลน์ PWA, ต่อ e-Tax provider จริง, Phase B/C/D
- 2026-06-16 follow-up: ตรวจ Phase A ส่วนแรกแล้ว build ผ่านทั้ง API และ web; แก้ให้วิธีชำระเงินที่เปิดใช้ใน Store Settings มีผลกับปุ่มชำระเงินจริง; เพิ่ม migration `202606160002_store_settings_branch_fk` เพื่อผูก `store_settings.branch_id` กับสาขาจริง
  - ตรวจแล้ว: `npm run build --workspace apps/api` ผ่าน; `npm run build --workspace apps/web` ผ่าน
  - DB migration `202606160002_store_settings_branch_fk` รันแล้วใน full parity pass
  - VAT `EXCLUSIVE` ต่อครบใน full parity pass แล้ว
- 2026-06-16 full parity pass: รัน migration ที่ค้างแล้ว; ทำข้อที่เหลือของ POSPOS roadmap ครบในระบบ
  - เพิ่ม migration `202606160003_pospos_parity_remaining`
  - เพิ่ม schema/API สำหรับใบกำกับเต็มรูป, stocktake, stock transfer, product units, price rules, lot/expiry, product variants, promotion, coupon, business documents, daily email setting, marketplace connection
  - เพิ่มหน้าเว็บ `/parity` สำหรับจัดการงาน Phase A-D ที่เหลือ และ `/customer-display` สำหรับจอลูกค้า
  - แก้ checkout ให้รองรับ VAT `EXCLUSIVE`, วิธีชำระเงินที่เปิดใช้, promotion auto-apply, price rule ตาม tier/จำนวน, barcode ของหน่วยลัง/แพ็ก, และ offline queue
  - เพิ่ม PWA manifest/service worker และ offline order queue sync เมื่อกลับมาออนไลน์
  - เพิ่ม e-Tax provider payload จากใบกำกับเต็มรูปผ่าน integration outbox; ต้องตั้ง `RD_TAX_ENDPOINT`, `RD_TAX_CLIENT_ID`, `RD_TAX_CLIENT_SECRET`
  - เพิ่ม email provider ผ่าน `EMAIL_WEBHOOK_URL`; marketplace sync ใช้ outbox provider เดิมของ delivery/marketplace
  - ตรวจแล้ว: `npm run db:migrate --workspace apps/api` ผ่าน; `npm run build` ผ่าน
- 2026-06-16 hardening pass (ปิดช่องว่างที่เหลือหลังตรวจงาน parity):
  - คูปองผูกเข้า POS จริง: เพิ่ม `POST /api/coupons/validate` (cashier ใช้ได้), ช่องกรอกโค้ดคูปองในตะกร้า, คำนวณส่วนลดฝั่ง client ให้ตรงกับ server (เก็บเงินถูกต้อง), ตัด `usedCount` แบบ atomic ใน transaction ตอน checkout + กันหมดอายุ/เกินโควต้า
  - เพิ่ม แก้ไข/เปิด-ปิด/ลบ ให้ promotion + coupon: `PUT/DELETE /api/promotions/:id`, `PUT/DELETE /api/coupons/:id` + ปุ่มจัดการในหน้า `/parity`
  - ออฟไลน์: เพิ่มตัวบอกสถานะ ออนไลน์/ออฟไลน์ + จำนวนบิลรอ sync + ปุ่ม sync เอง (TopBar), flush คิวอัตโนมัติทุก 25 วิ, toast เตือนเมื่อบันทึกบิลออฟไลน์
  - ตรวจแล้ว: `tsc --noEmit` ผ่านทั้ง api และ web (Prisma client ถูก regenerate มีครบทุกโมเดล)
  - caveat ที่ยังเหลือ (ต้องรู้):
    - ออฟไลน์ = ขายแบบ "ชั่วคราว" — พิมพ์สลิป id ลบชั่วคราว, ยังไม่ validate สต็อก/กะ ตอนออฟไลน์, ถ้า sync แล้ว server ปฏิเสธ (สต็อกหมด/กะปิด) บิลจะค้างในคิวให้แก้เอง (ตัวบอกสถานะจะโชว์จำนวนค้าง)
    - โปรโมชั่น auto-apply ลดยอดฝั่ง server แต่จอ POS ยังไม่โชว์ส่วนลดโปรโมชันก่อนรับเงิน (คูปองโชว์แล้ว) — ถ้าใช้โปรโมชัน auto ควรเช็คยอดรับเงินสด
    - e-Tax/marketplace/email = ส่งผ่าน outbox/webhook ต้องตั้ง ENV provider จริงถึงจะส่งออกได้
    - variant/lot ยังไม่บังคับตัดสต็อกแบบ FEFO ตามล็อต
  - ต้องรันบน Mac เพื่อยืนยัน runtime: `npm run build`, `npm run production-hardening:check --workspace apps/api`, และถ้ามี DB test ก็ `npm run checkout:integration` / `npm run browser:e2e`
  - ✅ ผู้ใช้รันบน Mac แล้ว: `npm run build` ผ่าน (api+web), `production-hardening:check` 63/63 ผ่าน
- 2026-06-16 promo-on-POS pass: โชว์ส่วนลดโปรโมชัน auto บนจอ POS ก่อนรับเงิน (แก้ปัญหาเก็บเงินสดเกินเพราะ server ลดให้แต่จอโชว์ยอดเต็ม)
  - เพิ่ม `GET /api/promotions/active` (cashier เข้าได้) + `listActivePromotions()`
  - CartContext ดึงโปรโมชัน active มาคำนวณลงยอดรวม/เงินทอน ให้ตรงลำดับกับ server (promotions → manual rules → coupon) โดยไม่ส่งซ้ำใน `discounts` (กัน double-apply)
  - CartPanel โชว์ป้ายโปรโมชันอัตโนมัติที่กำลังใช้; ใบเสร็จ/CashDrawer สะท้อนส่วนลดถูกต้องเพราะอ่านจาก cart context
  - ตรวจแล้ว: `tsc --noEmit` ผ่านทั้ง api และ web
  - caveat ที่ยังเหลือ: ออฟไลน์ยังไม่ validate สต็อก/กะ; variant/lot ยังไม่บังคับ FEFO; e-Tax/marketplace/email ต้องตั้ง ENV provider จริง
- 2026-06-16 FEFO pass: ตัดสต็อกตามล็อตหมดอายุ (First-Expired-First-Out)
  - เพิ่ม `applyLotFefoDeductions()` ใน checkout transaction: เมื่อขาย ตัดล็อต (InventoryLot) เรียงตามวันหมดอายุก่อน (ล็อตไม่มีวันหมดอายุตัดท้ายสุด) แบบ best-effort — cap ไม่ให้ล็อตติดลบ, ถ้าล็อตไม่พอ (ข้อมูลล็อตไม่ครบ) ข้ามส่วนเกิน เพราะ IngredientStock ยังเป็นตัวตัดสินจริง
  - `listInventoryLots` กรอง `qty > 0` แล้ว → ล็อตที่ตัดหมดจะหายจากการแจ้งเตือนหมดอายุ
  - ตรวจแล้ว: api `tsc --noEmit` ผ่าน
  - caveat: การคืนเงิน/ยกเลิกบิล คืนยอดเข้า IngredientStock (ตัวจริง) แต่ยังไม่คืนกลับเข้าล็อตเดิม (ล็อตเป็น advisory) — ถ้าต้องการความแม่นยำระดับล็อตเวลาคืนเงิน ต้องทำเพิ่ม
- 2026-06-16 caveat-closing pass:
  - คืนล็อตตอนยกเลิก/คืนเงิน: เพิ่ม `restoreLotFefo()` คืนยอดกลับเข้าล็อตที่หมดอายุก่อน (ถ้าไม่มีล็อตสร้างล็อต RESTORE) — ล็อตกับสต็อกไม่ดริฟต์เวลา refund แล้ว
  - ออฟไลน์ แยก "บิลล้มเหลว" (เซิร์ฟเวอร์ปฏิเสธ เช่น สต็อก/กะ) ออกจาก "รอ sync" (เน็ตมีปัญหา): บิลล้มเหลวไม่ retry วนไม่จบ, ตัวบอกสถานะโชว์จำนวน + รายละเอียดเหตุผล + ปุ่ม "ลองส่งใหม่"/"ล้างทิ้ง"
  - ตรวจแล้ว: `tsc --noEmit` ผ่านทั้ง api และ web
  - caveat ที่เหลือ (ต้อง credential จริงเท่านั้น): e-Tax (ETDA/INET), marketplace (Shopee/Lazada), อีเมลสรุป — โค้ด/outbox พร้อมแล้ว รอตั้ง ENV provider
