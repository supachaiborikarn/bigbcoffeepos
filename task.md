# Big B Coffee POS Production Hardening Tasks

## Goal
Raise the POS from MVP/demo readiness to a safer shop-ready baseline by closing the critical checkout, inventory, refund, and access-control gaps found in the audit.

## Critical
- [x] Make checkout atomic: order, shift totals, stock movements, customer points, and integration outbox must succeed or fail together.
- [x] Validate stock before sale and reject checkout if recipe ingredients are insufficient.
- [x] Prevent invalid item quantities, modifier prices, payment methods, and loyalty point usage at the API boundary.
- [x] Implement cancel/refund reversal behavior: restore stock, reverse loyalty points, and reverse shift totals exactly once.
- [x] Harden authentication: no new plain-text PIN storage, rate-limit PIN login attempts, and require roles for sensitive routes.
- [x] Scope branch-level access for cashiers so they cannot operate across branches.

## High
- [x] Add focused static verification for checkout atomicity, insufficient stock guard, cancellation reversal, role middleware, and PIN hashing.
- [x] Make payment recording stricter, especially cash received/change and non-cash pending/confirmed states.
- [x] Move modifier catalog/pricing to backend-owned master data.
- [x] Replace in-memory report aggregation for large ranges with DB aggregation/pagination.

## Medium
- [x] Align README/deploy docs with the actual database mode.
- [x] Add structured logging and operational audit logs.
- [x] Replace mock order center with real orders.

## Implementation Notes
- This pass focuses on backend correctness first.
- Schema changes are avoided where possible so the work can build against the current database.
- Existing plain-text seeded PINs remain readable for compatibility, but new/updated PINs should be hashed.
