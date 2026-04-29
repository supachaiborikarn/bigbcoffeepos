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

- Current: 98-99% production-ready for a controlled pilot.
- Remaining external step to call it 100%: configure live `ALERT_CHANNEL_URL`, provider backup/PITR, and GitHub `RESTORE_DATABASE_URL`, then archive the first restore-drill artifact from the real provider-restored database.

## Goal

Close the UI/workflow gaps found in the latest audit so the POS can be used end-to-end by staff, and separate unfinished feature shells from production-ready flows.

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
- [ ] Store POSPOS customer metadata when available, such as tier, notes, birthday, or total spend.
- [ ] Link imported POSPOS receipts to customers when POSPOS exposes member data in receipt details.
- [x] Add customer insight widgets: recent spend, inactive customers, and high-value customers.

Current POSPOS customer scrape exposes only name and phone, and transaction list exposes sales totals without member detail. Keep the two open customer metadata tasks until receipt detail/member APIs are captured.

### Phase 4: Product Metadata Expansion

- [x] Import or support product images where POSPOS exposes them.
- [x] Support modifier/option catalogs instead of treating every variant as a separate product.
- [x] Normalize noisy categories from POSPOS into shop-friendly groups.
- [x] Add product tax/unit metadata when the source provides it.
