# benzPOS Production Runbook

Updated: 2026-04-29

## Required Environment

API:
- `DATABASE_URL`: PostgreSQL connection string. SQLite/file URLs are not supported by runtime stores.
- `JWT_SECRET`: long random secret. Production startup must fail if missing.
- `PORT`: optional, defaults to `5175`.
- `AUDIT_LOG_FILE`: optional JSONL audit file path.
- `SLOW_REQUEST_MS`: optional slow request threshold, defaults to `1000`.
- `INTEGRATION_OUTBOX_INTERVAL_MS`: optional worker interval. Use `30000` or higher.

Frontend:
- `VITE_API_URL`: public API base URL.

Integrations:
- POSPOS: `POSPOS_EMAIL`, `POSPOS_PASSWORD`
- RD/e-Tax: `RD_TAX_ENDPOINT`, `RD_TAX_CLIENT_ID`, `RD_TAX_CLIENT_SECRET`
- Line OA: `LINE_OA_CHANNEL_ACCESS_TOKEN`
- Lineman: `LINEMAN_API_ENDPOINT`, `LINEMAN_API_KEY`

## Deploy Checklist

1. Confirm branch and build:
```bash
npm run ci:verify
```

For manual step-by-step verification:
```bash
npm run production-hardening:check --workspace apps/api
npm run monitoring:check --workspace apps/api
npm run db:migrate --workspace apps/api
npm run db:migrate:status --workspace apps/api
npm run checkout:integration --workspace apps/api
npm run load:concurrency --workspace apps/api
npm run browser:e2e --workspace apps/api
npm run build
```

2. Apply database migrations before sending traffic:
```bash
cd apps/api
npm run db:migrate
npm run db:migrate:status
```

The migration folder includes an idempotent baseline for existing legacy databases and fresh CI/staging databases. Existing databases that were created before Prisma Migrate should run the baseline once; it uses `IF NOT EXISTS` so it should not recreate existing tables.

3. Start API and web with production env. Confirm:
```bash
curl -fsS "$API_URL/health"
```

4. Login with an admin PIN and verify:
- `GET /api/integrations/status`
- `GET /api/integrations/summary`
- `GET /api/audit?limit=10`

## Database And Backup

The runtime database is PostgreSQL through Prisma. Production backup must be handled by the managed PostgreSQL provider using snapshots or PITR. The app intentionally disables SQLite backup endpoints in the PostgreSQL runtime.

Restore drill:
```bash
RESTORE_DATABASE_URL="postgresql://restored-staging-db" \
RESTORE_DRILL_OUT="docs/restore-drills/$(date +%Y-%m-%d).json" \
npm run backup:restore-check --workspace apps/api
```

The report must be archived with the incident/runbook notes before marking backup readiness complete.

Rollback order:
1. Stop new deploy traffic.
2. Restore the previous app version.
3. If schema rollback is required, restore a provider snapshot or run a reviewed down migration.
4. Re-run health, login, branch selection, shift open, checkout, refund/cancel, and report checks.

## Monitoring Targets

Collect API stdout/stderr JSON logs. Alerts should cover:
- `level=error`
- `event=http_request_slow`
- repeated `status>=500`
- `event=integration_outbox_attention_required`
- missing or stale audit log writes
- high `remainingFailed` or old `oldestPending` from `/api/integrations/summary`

Every HTTP log includes `requestId`; responses include `X-Request-ID`. Audit events also carry the same request id when available.

Alert policy details are in [MONITORING_ALERTS.md](MONITORING_ALERTS.md).

## Production Data Readiness

Before pilot day, run:
```bash
npm run data:readiness --workspace apps/api
```

Critical findings, especially missing recipes, must be closed before the branch is considered stock-ready.

## Incident Playbooks

Payment dispute:
- Search `/api/audit?action=order`.
- Check order payment rows in `payments`.
- Reprint receipt from order detail using persisted payment evidence.

Stock mismatch:
- Check order status and `order_events` for cancel/refund.
- Check `stock_movements` for sale/reversal/adjustment trail.
- Count integration failures separately; external sync failure should not change local stock.

Integration outage:
- Confirm provider env is configured.
- Check `/api/integrations/summary`.
- Retry individual failed events from admin settings.
- Keep checkout open; outbox failure should not block local sale after the order is committed.
