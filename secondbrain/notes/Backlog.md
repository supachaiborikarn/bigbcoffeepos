---
tags:
  - secondbrain
  - backlog
updated: 2026-04-26
---

# Backlog

## High Value

- Add `.gitignore` for `node_modules`, `dist`, local DB backups, and environment files.
- Add tests for order totals, stacked discount rules, stock deduction, purchases, integration outbox, and loyalty points.
- Create shared types package to avoid drift between API and web types.
- Add receipt print flow and confirm Thai thermal-printer requirements.
- Add product search/filter performance safeguards for larger menus.
- Add low-stock report per branch with export.

## Data and Reliability

- Evaluate Postgres when multiple devices need true concurrent writes beyond local SQLite.
- Add import preview validation before writing to DB.
- Add duplicate barcode/SKU protection.
- Add audit trail for manual stock adjustments.
- Add live delivery workers for integration outbox providers.
- Add idempotency keys for order creation and integration retries.

## Product Questions

- Should "Wazabin POS" be the final product name?
- Is this for retail convenience goods, coffee shop, gas station, or all of them?
- Are document/workflow screens part of this product or a separate app?
- What receipt fields are legally required for the target shop?
- How should branches map to real stores, warehouses, and online channels?

## Nice Later

- Dashboard widgets for daily branch revenue.
- Customer purchase history.
- Barcode label printing.
- Offline-first mode or local fallback.
- Import templates downloadable from the app.
