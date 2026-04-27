---
tags:
  - secondbrain
  - frontend
updated: 2026-04-26
---

# Frontend Map

## Main App

`apps/web/src/App.tsx` wires the provider shell and router. Most screen state now lives in contexts or routed page components.

Major state groups:

- Auth/PIN session in `AuthContext`.
- Active branch in `BranchContext`.
- Current shift in `ShiftContext`.
- Cart, scanner feedback, discount rules, payment, customer, and loyalty controls in `CartContext` plus `POSPage`.
- Inventory, purchase receiving, stock movement, and product/ingredient forms in `InventoryPage`.
- Report filters and summary data in `ReportsPage` / `DashboardPage`.
- Integration readiness and outbox state in `SettingsPage`.

## User-Facing Views

- POS page: scanner/search, product grid, cart, modifiers, member search/create, loyalty redemption, payment, stacked discounts, checkout.
- Inventory page: product setup, ingredient stock, branch stock adjustments, purchase receiving, movement log.
- Dashboard page: 7-day KPIs, top items, low stock, recent shifts.
- Migration page: POSPOS sync.
- Reports page: summary metrics, top items, daily sales, CSV export.
- Settings page: admin integration status and outbox retry.

## API Client

`apps/web/src/api.ts` centralizes network calls, attaches `Authorization: Bearer <token>`, and uses `VITE_API_URL` when present. Default API URL is `http://localhost:5175/api`.

## Styling

`apps/web/src/styles.css` is the main styling file. Follow `DESIGN.md`:

- Operational density.
- Thai-first typography.
- Scanner and branch state always visible.
- Compact panels and predictable controls.

## Extra Prototype Components

`apps/web/src/components/DocumentDetailPage.tsx` and `WorkflowPrintCenter.tsx` still look like document/workflow prototypes and are not wired into the router. Decide later whether they are a separate product direction, a future module, or code to remove.
