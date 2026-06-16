ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "member_code" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "birthday" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "total_spend" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "credit_balance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tags" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "line_user_id" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "metadata" TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS "customers_member_code_key" ON "customers"("member_code");

ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "approved_by_user_id" INTEGER;
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "tax_invoices" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "order_id" INTEGER NOT NULL,
  "customer_id" INTEGER,
  "invoice_no" TEXT NOT NULL,
  "buyer_name" TEXT NOT NULL,
  "buyer_tax_id" TEXT NOT NULL DEFAULT '',
  "buyer_address" TEXT NOT NULL DEFAULT '',
  "buyer_branch" TEXT NOT NULL DEFAULT '',
  "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ISSUED',
  "e_tax_status" TEXT NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "tax_invoices_order_id_key" ON "tax_invoices"("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tax_invoices_invoice_no_key" ON "tax_invoices"("invoice_no");
CREATE INDEX IF NOT EXISTS "tax_invoices_branch_id_idx" ON "tax_invoices"("branch_id");
CREATE INDEX IF NOT EXISTS "tax_invoices_created_at_idx" ON "tax_invoices"("created_at");

CREATE TABLE IF NOT EXISTS "stock_counts" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "note" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMP(3),
  CONSTRAINT "stock_counts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "stock_counts_branch_id_idx" ON "stock_counts"("branch_id");
CREATE INDEX IF NOT EXISTS "stock_counts_status_idx" ON "stock_counts"("status");

CREATE TABLE IF NOT EXISTS "stock_count_items" (
  "id" SERIAL PRIMARY KEY,
  "stock_count_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "expected_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "counted_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "difference_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "stock_count_items_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_count_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "stock_count_items_stock_count_id_ingredient_id_key" ON "stock_count_items"("stock_count_id","ingredient_id");

CREATE TABLE IF NOT EXISTS "stock_transfers" (
  "id" SERIAL PRIMARY KEY,
  "from_branch_id" INTEGER NOT NULL,
  "to_branch_id" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "note" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),
  CONSTRAINT "stock_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "stock_transfers_from_branch_id_idx" ON "stock_transfers"("from_branch_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_to_branch_id_idx" ON "stock_transfers"("to_branch_id");
CREATE INDEX IF NOT EXISTS "stock_transfers_status_idx" ON "stock_transfers"("status");

CREATE TABLE IF NOT EXISTS "stock_transfer_items" (
  "id" SERIAL PRIMARY KEY,
  "stock_transfer_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "stock_transfer_items_stock_transfer_id_fkey" FOREIGN KEY ("stock_transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_transfer_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "product_units" (
  "id" SERIAL PRIMARY KEY,
  "menu_item_id" INTEGER NOT NULL,
  "unit_name" TEXT NOT NULL,
  "factor" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "price" DOUBLE PRECISION,
  "barcode" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "product_units_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "product_units_menu_item_id_idx" ON "product_units"("menu_item_id");

CREATE TABLE IF NOT EXISTS "price_rules" (
  "id" SERIAL PRIMARY KEY,
  "menu_item_id" INTEGER,
  "customer_tier" TEXT NOT NULL DEFAULT '',
  "min_qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "price" DOUBLE PRECISION NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_rules_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "price_rules_menu_item_id_idx" ON "price_rules"("menu_item_id");

CREATE TABLE IF NOT EXISTS "inventory_lots" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "lot_no" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expiry_date" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_lots_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_lots_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "inventory_lots_branch_id_idx" ON "inventory_lots"("branch_id");
CREATE INDEX IF NOT EXISTS "inventory_lots_expiry_date_idx" ON "inventory_lots"("expiry_date");

CREATE TABLE IF NOT EXISTS "product_variants" (
  "id" SERIAL PRIMARY KEY,
  "menu_item_id" INTEGER NOT NULL,
  "sku" TEXT,
  "barcode" TEXT,
  "option_name" TEXT NOT NULL DEFAULT '',
  "option_value" TEXT NOT NULL DEFAULT '',
  "price_delta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "product_variants_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "product_variants_menu_item_id_idx" ON "product_variants"("menu_item_id");

CREATE TABLE IF NOT EXISTS "promotions" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "category" TEXT NOT NULL DEFAULT '',
  "start_at" TIMESTAMP(3),
  "end_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "promotions_active_idx" ON "promotions"("active");

CREATE TABLE IF NOT EXISTS "coupons" (
  "id" SERIAL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "max_uses" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_key" ON "coupons"("code");
CREATE INDEX IF NOT EXISTS "coupons_active_idx" ON "coupons"("active");

CREATE TABLE IF NOT EXISTS "business_documents" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "document_no" TEXT NOT NULL,
  "customer_name" TEXT NOT NULL DEFAULT '',
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "payload" TEXT NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_documents_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "business_documents_document_no_key" ON "business_documents"("document_no");
CREATE INDEX IF NOT EXISTS "business_documents_branch_id_idx" ON "business_documents"("branch_id");
CREATE INDEX IF NOT EXISTS "business_documents_type_idx" ON "business_documents"("type");

CREATE TABLE IF NOT EXISTS "daily_email_settings" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER,
  "recipients" TEXT NOT NULL DEFAULT '',
  "send_time" TEXT NOT NULL DEFAULT '21:00',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "marketplace_connections" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "shop_name" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'READY',
  "config" TEXT NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketplace_connections_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_connections_branch_id_provider_key" ON "marketplace_connections"("branch_id","provider");
