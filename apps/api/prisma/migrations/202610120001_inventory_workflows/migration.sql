-- Additive stock document and supplier receiving workflow. Historical receipts
-- already changed stock, including rows marked APPROVED by the legacy endpoint.
ALTER TABLE "stock_movements"
  ADD COLUMN "before_qty" DOUBLE PRECISION,
  ADD COLUMN "after_qty" DOUBLE PRECISION,
  ADD COLUMN "actor_user_id" INTEGER,
  ADD COLUMN "document_id" INTEGER;

ALTER TABLE "purchases"
  ADD COLUMN "supplier_key" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "invoice_number" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "invoice_key" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'RECEIPT',
  ADD COLUMN "document_date" TIMESTAMP(3),
  ADD COLUMN "received_at" TIMESTAMP(3),
  ADD COLUMN "due_date" TIMESTAMP(3),
  ADD COLUMN "attachment_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "attachment_data_url" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "request_key" TEXT,
  ADD COLUMN "request_hash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "created_by_user_id" INTEGER;
UPDATE "purchases" SET "received_at" = "created_at", "document_date" = "created_at";
CREATE UNIQUE INDEX "purchases_request_key_key" ON "purchases"("request_key");
-- Empty invoice numbers represent older receipts or suppliers with no bill.
-- A voided receipt may be replaced with the corrected bill without duplication.
CREATE UNIQUE INDEX "purchases_active_supplier_invoice_key"
  ON "purchases"("branch_id", "supplier_key", "invoice_key")
  WHERE "invoice_key" <> '' AND "status" <> 'VOID';
CREATE INDEX "purchases_branch_id_created_at_idx" ON "purchases"("branch_id", "created_at");

ALTER TABLE "purchase_items"
  ADD COLUMN "ingredient_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "received_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "lot_no" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "expiry_date" TIMESTAMP(3),
  ADD COLUMN "pack_size" DOUBLE PRECISION NOT NULL DEFAULT 1;
UPDATE "purchase_items" SET "received_qty" = "qty";
UPDATE "purchase_items" AS item SET "ingredient_name" = ingredient."name", "unit" = ingredient."unit"
  FROM "ingredients" AS ingredient WHERE item."ingredient_id" = ingredient."id";

CREATE TABLE "purchase_receipts" (
  "id" SERIAL PRIMARY KEY,
  "purchase_id" INTEGER NOT NULL,
  "request_key" TEXT,
  "request_hash" TEXT NOT NULL DEFAULT '',
  "actor_user_id" INTEGER,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "purchase_receipts_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "purchase_receipts_request_key_key" ON "purchase_receipts"("request_key");
CREATE INDEX "purchase_receipts_purchase_id_idx" ON "purchase_receipts"("purchase_id");
CREATE TABLE "purchase_receipt_items" (
  "id" SERIAL PRIMARY KEY,
  "receipt_id" INTEGER NOT NULL,
  "purchase_item_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "ingredient_name" TEXT NOT NULL DEFAULT '',
  "unit" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL,
  "unit_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lot_no" TEXT NOT NULL DEFAULT '',
  "expiry_date" TIMESTAMP(3),
  "pack_size" DOUBLE PRECISION NOT NULL DEFAULT 1,
  CONSTRAINT "purchase_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "purchase_receipt_items_receipt_id_idx" ON "purchase_receipt_items"("receipt_id");
-- Group existing rows as their original receipt; do not guess lot metadata that
-- was never saved on purchase lines or invent missing ingredient references.
INSERT INTO "purchase_receipts" ("purchase_id", "received_at", "created_at")
  SELECT "id", "created_at", "created_at" FROM "purchases";
INSERT INTO "purchase_receipt_items" ("receipt_id", "purchase_item_id", "ingredient_id", "ingredient_name", "unit", "qty", "unit_cost")
  SELECT receipt."id", item."id", item."ingredient_id", item."ingredient_name", item."unit", item."qty", item."unit_cost"
  FROM "purchase_items" item JOIN "purchase_receipts" receipt ON receipt."purchase_id" = item."purchase_id"
  WHERE item."ingredient_id" IS NOT NULL;

CREATE TABLE "inventory_documents" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "request_key" TEXT,
  "requested_by_user_id" INTEGER NOT NULL,
  "approved_by_user_id" INTEGER,
  "from_location" TEXT NOT NULL DEFAULT '',
  "to_location" TEXT NOT NULL DEFAULT '',
  "reason" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "void_reason" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMP(3),
  "voided_at" TIMESTAMP(3),
  CONSTRAINT "inventory_documents_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inventory_documents_request_key_key" ON "inventory_documents"("request_key");
CREATE INDEX "inventory_documents_branch_id_created_at_idx" ON "inventory_documents"("branch_id", "created_at");
CREATE TABLE "inventory_document_items" (
  "id" SERIAL PRIMARY KEY,
  "document_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "unit_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "inventory_document_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "inventory_document_items_document_id_idx" ON "inventory_document_items"("document_id");
