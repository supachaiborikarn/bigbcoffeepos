---
tags:
  - secondbrain
  - session-log
updated: 2026-04-26
---

# Session Log

## 2026-04-24

Created the project second brain and Obsidian vault in `secondbrain/`.

Captured:

- Project purpose and stack.
- Main frontend/API/data files.
- Endpoint map.
- Current data rules.
- Runbook commands.
- Architecture notes.
- Known open decisions and backlog.

Important workspace note: `git status --short` currently shows most project files as untracked, including `README.md`, `DESIGN.md`, `apps/`, `node_modules/`, and generated build output. Future work should avoid assuming a clean git baseline.

## 2026-04-25

Continued Phase 1.3.

Implemented:

- SQLite auto-backup service for `apps/api/data/pos.db`.
- Manual/admin backup endpoints and CLI backup command.
- Phase 1.3 HTTP smoke-check script.
- Auth-aware branch loading.
- Shift refresh cleanup when switching branches.
- Checkout now requires an open shift and sends `userId`/`shiftId`.
- Cart clears when switching branches.

Verified:

- `npm run build`
- `npm run backup --workspace apps/api -- phase13-manual-test`
- `npm run phase13:check --workspace apps/api`
- `npm run backup --workspace apps/api -- sidecar-cleanup-test`

Phase 1.3 check result: logged in as admin, checked 4 branches, opened/closed shifts #2-#5, and created `pos-20260425171856732-phase13-check.db`.

Follow-up verification: backup sidecars are cleaned after integrity check; latest test created `pos-20260426005614234-sidecar-cleanup-test.db` with no `.db-shm`/`.db-wal` sidecars.

## 2026-04-26

Continued Phase 2 and Phase 3.

Implemented:

- Stacked order discount rules in `apps/api/src/store/orders.ts`.
- POS member search, quick member creation, point redemption, and promotion rule UI.
- Inventory purchase receiving and stock movement views.
- Integration outbox store for RD/e-Tax, Line OA, and Lineman.
- Admin Settings dashboard for provider readiness, outbox listing, and retry.
- Auth-safe API wrappers for Dashboard, Staff, and Migration pages.

Verified:

- `npm run build`
- `npm run phase13:check --workspace apps/api`
- New admin endpoint smoke test for `/integrations/status`, `/integrations/events`, and `/purchases`.

Latest Phase 1.3 check created backup `pos-20260426011252272-phase13-check.db`.
