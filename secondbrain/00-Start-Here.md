---
tags:
  - secondbrain
  - start-here
updated: 2026-04-26
---

# Start Here

This vault is the project memory for benzPOS / Big B Coffee POS. Open this note first when coming back to the project.

## Fast Context

- Product: Thai POS web app for shop operations: barcode sales, orders, payments, shift control, stock by branch, reports, members/points, promotion rules, purchase receiving, backups, and integration outbox.
- Current stack: React + TypeScript + Vite frontend, Express + TypeScript backend, SQLite via `better-sqlite3`.
- Main app entry: `apps/web/src/App.tsx` with routed pages in `apps/web/src/pages/`.
- Main API entry: `apps/api/src/index.ts`.
- Data file: `apps/api/data/pos.db`.
- Backup folder: `apps/api/data/backups/`.
- Design guidance: root `DESIGN.md`.

## Important Notes

- [[notes/Project-Overview|Project Overview]]
- [[notes/Architecture|Architecture]]
- [[notes/API-and-Data-Model|API and Data Model]]
- [[notes/Frontend-Map|Frontend Map]]
- [[notes/Runbook|Runbook]]
- [[notes/Decisions|Decisions]]
- [[notes/Backlog|Backlog]]
- [[notes/Session-Log|Session Log]]

## Next Session Checklist

- Check `git status --short` before editing. This workspace currently has many untracked project files.
- Read root `README.md` and `DESIGN.md`.
- If changing behavior, inspect both web and API types because they are duplicated.
- Run the relevant build after code changes: `npm run build`.
- Update this vault if you learn a new invariant, decision, command, or gotcha.
