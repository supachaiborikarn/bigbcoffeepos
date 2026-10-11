-- QA report fixes (2026-10-11)
-- M4: coupons can require a minimum spend.
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "min_spend" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- C2: full tax invoices carry the seller's details and VAT rate as issued, can be
-- voided (number stays used), and an order may be re-invoiced after a void.
ALTER TABLE "tax_invoices" ADD COLUMN IF NOT EXISTS "seller_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tax_invoices" ADD COLUMN IF NOT EXISTS "seller_tax_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tax_invoices" ADD COLUMN IF NOT EXISTS "seller_address" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tax_invoices" ADD COLUMN IF NOT EXISTS "seller_branch" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tax_invoices" ADD COLUMN IF NOT EXISTS "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "tax_invoices" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3);
ALTER TABLE "tax_invoices" ADD COLUMN IF NOT EXISTS "void_reason" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "tax_invoices_order_id_key";
CREATE INDEX IF NOT EXISTS "tax_invoices_order_id_idx" ON "tax_invoices"("order_id");

-- H6: a goods receipt can be voided (stock reversed), and lots made from it are traceable.
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3);
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "void_reason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "inventory_lots" ADD COLUMN IF NOT EXISTS "purchase_id" INTEGER;
CREATE INDEX IF NOT EXISTS "inventory_lots_purchase_id_idx" ON "inventory_lots"("purchase_id");
