# benzPOS Monitoring And Alert Policy

Updated: 2026-04-29

## Log Collection

Collect API stdout/stderr JSON logs from the production runtime. Every request log includes:
- `requestId`
- `method`
- `path`
- `status`
- `durationMs`
- `userId`
- `role`

Responses include `X-Request-ID`; support staff should ask for this id when investigating a failed bill.

## Required Alerts

Route alerts to the owner/on-call channel configured as `ALERT_CHANNEL_URL`. The API posts JSON directly to this webhook for critical runtime signals, and the hosting/log platform should also alert on the same JSON log events.

Webhook payload shape:

```json
{
  "text": "[CRITICAL] http_request_5xx",
  "severity": "critical",
  "event": "http_request_5xx",
  "ts": "2026-04-29T00:00:00.000Z",
  "meta": { "requestId": "..." }
}
```

| Signal | Severity | Suggested Rule | Action |
| --- | --- | --- | --- |
| API 5xx burst | Critical | `event=http_request status>=500 count>=5 in 5m` | Check deploy, DB status, and recent request ids. |
| Slow POS request | High | `event=http_request_slow count>=10 in 10m` | Inspect endpoint latency and database health. |
| Integration failure | High | `event=integration_outbox_attention_required` | Open Settings > Integration Outbox, retry or fix provider env. |
| Outbox stale pending | High | `/api/integrations/summary.oldestPending` older than 15m | Confirm worker interval and provider health. |
| Audit write failure | High | `event=audit_file_write_failed` | Check filesystem/log drain permissions. |
| PIN abuse | Medium | `action=auth.pin.rate_limited count>=3 in 10m` | Check IP/location and rotate PIN if needed. |

## Alert Test

Use either path after setting `ALERT_CHANNEL_URL`:

- CLI: `npm run monitoring:alert-test --workspace apps/api`
- API: `POST /api/monitoring/alert-test` with an admin token

When `REQUIRE_ALERT_CHANNEL=1`, monitoring checks fail if `ALERT_CHANNEL_URL` is missing.

## Dashboards

Production dashboard should show:
- request count by status
- p50/p95/p99 duration by endpoint
- current failed/pending outbox count
- newest failed outbox error
- order create/refund/cancel audit count
- active branch sales health from reports

## Incident Fields

Every incident note should include:
- start/end time
- affected branch
- request id or audit action
- customer/order id if applicable
- mitigation
- follow-up owner
