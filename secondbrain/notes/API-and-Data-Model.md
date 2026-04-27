---
tags:
  - secondbrain
  - api
  - data-model
updated: 2026-04-26
---

# API and Data Model

Base URL in development: `http://localhost:5175/api`.

## Endpoints

- `GET /health`
- `POST /auth/pin`
- `GET /users`
- `POST /users`
- `PUT /users/:id`
- `DELETE /users/:id`
- `GET /branches`
- `GET /customers?search=`
- `POST /customers`
- `PUT /customers/:id`
- `GET /menu`
- `POST /menu`
- `PUT /menu/:id`
- `GET /ingredients`
- `POST /ingredients`
- `PUT /ingredients/:id`
- `GET /inventory?branchId=`
- `POST /stock-adjustments`
- `GET /stock-movements?branchId=`
- `GET /recipes`
- `GET /recipes/:menuItemId`
- `PUT /recipes/:menuItemId`
- `GET /orders?branchId=`
- `GET /orders/:id`
- `PATCH /orders/:id`
- `POST /orders`
- `GET /shifts?branchId=`
- `GET /shifts/current?branchId=`
- `POST /shifts/open`
- `POST /shifts/:id/close`
- `GET /reports/summary?from=&to=&branchId=`
- `GET /backups/status`
- `GET /backups`
- `POST /backups`
- `GET /purchases?branchId=`
- `POST /purchases`
- `GET /integrations/status`
- `GET /integrations/events?provider=&status=&limit=`
- `POST /integrations/events/:id/retry`
- `POST /migration/sync`

Frontend still has wrappers for older CSV import/export endpoints (`/import/products`, `/import/customers`, `/import/orders`, `/reports/orders.csv`), but those Express routes are not present in the current `apps/api/src/index.ts`.

Most routes except `POST /auth/pin` and `GET /health` require `Authorization: Bearer <token>`.

## Core Types

Defined in both `apps/api/src/types.ts` and `apps/web/src/types.ts`.

- `Branch`: shop/stock location.
- `User`: PIN-authenticated staff user.
- `Shift`: branch cash/session ledger.
- `Customer`: member with phone and points.
- `MenuItem`: sellable product with sku/barcode/category/base price/cost.
- `Ingredient`: stock item and cost basis.
- `IngredientStock`: branch-specific quantity and reorder level.
- `Recipe`: map from menu item to ingredients consumed per sale.
- `Order`: sale record with totals, discounts, points, payment, and items.
- `PurchaseOrder`: received stock purchase with purchase item lines.
- `IntegrationEvent`: queued external sync payload in `integration_outbox`.
- `StockMovement`: stock ledger entry.
- `ImportResult`: imported/updated/skipped/errors summary.

## Order Rules

- Payment methods: `CASH`, `QR`, `CARD`, `EWALLET`.
- Order statuses: `PAID`, `READY`.
- Legacy discount types: `PERCENT`, `FIXED`, or `null`.
- Phase 2 discount rules sent as `discounts[]`:
  - `ORDER_PERCENT`
  - `ORDER_FIXED`
  - `CATEGORY_PERCENT`
  - `BUY_X_GET_Y`
- Each discount rule can carry a label and optional `maxDiscount`.
- Tax rate is currently `0`.
- Loyalty redemption: 1 point reduces 1 THB, capped by available points and discounted subtotal.
- Loyalty earn: members earn 1 point per drink item in categories `กาแฟ`, `ชา`, `เครื่องดื่ม`.
- Creating an order deducts stock using the menu item's recipe.
- Creating an order also enqueues outbox events for RD/e-Tax, Line OA, and Lineman.

## Integration Outbox

Table: `integration_outbox`.

Providers:

- `rd_tax`: requires `RD_TAX_ENDPOINT`, `RD_TAX_CLIENT_ID`, `RD_TAX_CLIENT_SECRET`.
- `line_oa`: requires `LINE_OA_CHANNEL_ACCESS_TOKEN`.
- `lineman`: requires `LINEMAN_API_ENDPOINT`, `LINEMAN_API_KEY`.

Current implementation creates and retries queued events. It does not yet call external provider APIs.

## Import Rules

Product import:

- Matches existing menu by SKU, barcode, or normalized name.
- Creates/updates menu item and matching ingredient.
- Ensures stock row for target branch.
- Sets one-to-one recipe by default.

Customer import:

- Matches by phone.
- Updates name/points or creates a new customer.

Historical order import:

- Groups rows by receipt number when present.
- Unknown products create inactive menu items in category `ประวัติขายเดิม`.
- Imported historical orders use status `READY`.

## CSV Headers Accepted in UI

The frontend parser accepts Thai and English aliases for product, customer, and sales import fields. See `headerAliases` in `apps/web/src/App.tsx`.
