# benzPOS Follow-up Fix Tasks

Updated: 2026-04-29

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
