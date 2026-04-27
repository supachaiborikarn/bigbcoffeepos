---
tags:
  - secondbrain
  - overview
updated: 2026-04-26
---

# Project Overview

benzPOS currently presents itself as **Big B Coffee POS** in the active UI and development log, with older README text still carrying some Wazabin POS wording.

## Goal

Build an online POS replacement for annual POS software with:

- Front-of-shop sales flow.
- Barcode scanning.
- Order capture and payment.
- Receipts.
- Product and stock management across 4 branches: 3 coffee branches and 1 oil-service branch.
- Sales reports.
- Customer/member points.
- Stacked promotions and category/buy-x-get-y discounts.
- Purchase receiving and stock movement history.
- Integration outbox foundation for RD/e-Tax, Line OA, and Lineman.
- CSV import tools for old POSPOS/Excel exports.

## Current Stack

- Frontend: React 18, TypeScript, Vite.
- Backend: Node.js, Express, TypeScript.
- Storage: SQLite file at `apps/api/data/pos.db` with WAL mode.
- Monorepo: npm workspaces under `apps/*`.

## Current Code Areas

- `apps/web/src/App.tsx`: provider shell for Auth, Branch, Shift, Toast, Cart, and router.
- `apps/web/src/router.tsx`: route map for login, branch selection, POS, inventory, staff, reports, migration, settings.
- `apps/web/src/pages/`: main routed screens.
- `apps/web/src/contexts/`: Auth, Branch, Shift, Cart, Toast state.
- `apps/web/src/api.ts`: browser API client.
- `apps/web/src/types.ts`: frontend types.
- `apps/web/src/styles.css`: main app styling.
- `apps/api/src/index.ts`: Express route and validation layer.
- `apps/api/src/db.ts`: SQLite schema/bootstrap/seed.
- `apps/api/src/store/`: modular store layer for branches, users, shifts, orders, inventory, reports, purchases.
- `apps/api/src/store/integrations.ts`: provider readiness and integration outbox.
- `apps/api/src/backup.ts`: SQLite backup service.
- `apps/api/src/types.ts`: backend types.

## Related Assets

- `transcripts_test/`: sample course transcripts/audio/json.
- `course_videos`: symlink to external course videos on the local machine.
- `awesome-design-md/`: design reference collection.

## Current Caveat

Frontend import wrappers for older CSV endpoints still exist in `apps/web/src/api.ts`, but the current Express route file only exposes POSPOS migration sync, not the three `/import/*` CSV routes.
