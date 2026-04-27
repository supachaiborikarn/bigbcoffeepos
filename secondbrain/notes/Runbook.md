---
tags:
  - secondbrain
  - runbook
updated: 2026-04-26
---

# Runbook

## Install

```bash
npm install
```

## Development

Run API and web in separate terminals:

```bash
npm run dev --workspace apps/api
```

```bash
npm run dev --workspace apps/web
```

URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:5175/api`
- Health: `http://localhost:5175/api/health`

## Build

```bash
npm run build
```

This runs:

- `npm run build --workspace apps/api`
- `npm run build --workspace apps/web`

## Local Data

Data lives at `apps/api/data/pos.db`.

Before manual DB edits:

- Stop the API server.
- Run `npm run backup --workspace apps/api -- before-manual-edit` or copy `pos.db` while the API is stopped.
- If copying manually while SQLite WAL files exist, keep `pos.db`, `pos.db-wal`, and `pos.db-shm` together.

The API will create/seed the SQLite schema if the DB file is missing.

## Backups

SQLite backups live at `apps/api/data/backups/`.

Create a manual backup:

```bash
npm run backup --workspace apps/api
```

Auto-backup defaults:

- Enabled unless `DB_BACKUP_ENABLED=0`.
- Runs on API startup unless `DB_BACKUP_ON_STARTUP=0`.
- Runs every 60 minutes unless `DB_BACKUP_INTERVAL_MINUTES` is set.
- Keeps 48 files unless `DB_BACKUP_RETENTION_COUNT` is set.

Protected admin endpoints:

- `GET /api/backups/status`
- `GET /api/backups`
- `POST /api/backups`

## Phase 1.3 Check

With the API server running:

```bash
npm run phase13:check --workspace apps/api
```

The check logs in with admin PIN `1234`, verifies Auth-protected branch access, opens/closes a zero-cash shift per branch when safe, and creates a manual backup.

## Integrations

Phase 3 currently has an outbox foundation, not live provider delivery.

Admin UI:

- Open Settings as an admin user.
- Check provider readiness and pending/failed outbox counts.
- Retry non-sent events from the outbox table.

Environment variables needed for providers:

- RD/e-Tax: `RD_TAX_ENDPOINT`, `RD_TAX_CLIENT_ID`, `RD_TAX_CLIENT_SECRET`
- Line OA: `LINE_OA_CHANNEL_ACCESS_TOKEN`
- Lineman: `LINEMAN_API_ENDPOINT`, `LINEMAN_API_KEY`

Admin endpoints:

- `GET /api/integrations/status`
- `GET /api/integrations/events`
- `POST /api/integrations/events/:id/retry`

## Environment

Frontend API override:

```bash
VITE_API_URL=http://localhost:5174/api npm run dev --workspace apps/web
```

Backend port override:

```bash
PORT=5175 npm run dev --workspace apps/api
```

## Before Handoff

- Run `git status --short`.
- Run `npm run build` after code changes.
- Add a dated entry to [[Session-Log]] when the work changes architecture, data, or workflow assumptions.
