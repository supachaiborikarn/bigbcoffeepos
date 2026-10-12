-- Preserve the exact FEFO lot allocations of each approved issue document so
-- cancellation restores the original lots and their expiry dates.
ALTER TABLE "inventory_document_items" ADD COLUMN "lot_allocations" TEXT NOT NULL DEFAULT '[]';
