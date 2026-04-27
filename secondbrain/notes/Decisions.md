---
tags:
  - secondbrain
  - decisions
updated: 2026-04-24
---

# Decisions

## 2026-04-24: Keep Obsidian Vault in `secondbrain/`

The second brain lives in `secondbrain/` instead of turning the project root into an Obsidian vault. This keeps `.obsidian/` settings contained and makes the vault easy to open directly.

## Existing Product Decisions Captured from Code

- JSON file storage is used for MVP simplicity.
- Seed data creates 3 branches: main shop, warehouse, and online branch.
- Products are represented as both `MenuItem` and `Ingredient` so sales can deduct stock through recipes.
- Default recipes are one menu item to one ingredient with quantity `1`.
- `TAX_RATE` is currently `0`.
- Historical imported orders are marked `READY`.
- Unknown historical imported products become inactive menu items.
- Customer phone numbers are unique for normal customer creation.
- Stock movements are prepended so newest entries appear first.

## Open Decisions

- Whether to keep JSON storage or move to SQLite/Postgres.
- Whether frontend/backend types should be generated from one shared package.
- Whether gas station document/workflow prototype components belong in this POS app.
- Whether receipts should be browser print, PDF generation, or hardware printer integration.
- Whether authentication/roles are required before real shop use.
