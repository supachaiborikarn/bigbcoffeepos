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
