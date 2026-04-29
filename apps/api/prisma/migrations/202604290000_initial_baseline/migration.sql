CREATE TABLE IF NOT EXISTS "branches" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "location" TEXT NOT NULL DEFAULT '',
  "branch_type" TEXT NOT NULL DEFAULT 'coffee',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "pin" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'cashier',
  "branch_id" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "menu_items" (
  "id" SERIAL PRIMARY KEY,
  "sku" TEXT,
  "barcode" TEXT,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '',
  "base_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cost" DOUBLE PRECISION,
  "image_url" TEXT,
  "unit" TEXT,
  "tax_rate" DOUBLE PRECISION,
  "source" TEXT,
  "source_id" TEXT,
  "option_group" TEXT,
  "option_label" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "branch_type" TEXT NOT NULL DEFAULT 'coffee',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "menu_items_source_source_id_idx" ON "menu_items"("source", "source_id");
CREATE INDEX IF NOT EXISTS "menu_items_option_group_idx" ON "menu_items"("option_group");

CREATE TABLE IF NOT EXISTS "customers" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_key" ON "customers"("phone");

CREATE TABLE IF NOT EXISTS "ingredients" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'ชิ้น',
  "cost_per_unit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ingredient_stocks" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "stock_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reorder_level" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "ingredient_stocks_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ingredient_stocks_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ingredient_stocks_branch_id_ingredient_id_key" ON "ingredient_stocks"("branch_id", "ingredient_id");

CREATE TABLE IF NOT EXISTS "recipes" (
  "id" SERIAL PRIMARY KEY,
  "menu_item_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  CONSTRAINT "recipes_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "recipes_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "recipes_menu_item_id_ingredient_id_key" ON "recipes"("menu_item_id", "ingredient_id");

CREATE TABLE IF NOT EXISTS "stock_movements" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "shifts" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "user_id" INTEGER,
  "opening_cash" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "closing_cash" DOUBLE PRECISION,
  "expected_cash" DOUBLE PRECISION,
  "difference" DOUBLE PRECISION,
  "total_sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_orders" INTEGER NOT NULL DEFAULT 0,
  "cash_sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qr_sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "card_sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  CONSTRAINT "shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "shifts_branch_id_idx" ON "shifts"("branch_id");
CREATE INDEX IF NOT EXISTS "shifts_status_idx" ON "shifts"("status");

CREATE TABLE IF NOT EXISTS "orders" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "customer_id" INTEGER,
  "user_id" INTEGER,
  "shift_id" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PAID',
  "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount_type" TEXT,
  "discount_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "loyalty_points_used" INTEGER NOT NULL DEFAULT 0,
  "loyalty_points_earned" INTEGER NOT NULL DEFAULT 0,
  "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payment_method" TEXT NOT NULL DEFAULT 'CASH',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "orders_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "orders_branch_id_idx" ON "orders"("branch_id");
CREATE INDEX IF NOT EXISTS "orders_shift_id_idx" ON "orders"("shift_id");
CREATE INDEX IF NOT EXISTS "orders_created_at_idx" ON "orders"("created_at");

CREATE TABLE IF NOT EXISTS "order_items" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL,
  "menu_item_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "base_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "modifiers" TEXT NOT NULL DEFAULT '[]',
  "line_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "note" TEXT,
  CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");

CREATE TABLE IF NOT EXISTS "integration_outbox" (
  "id" SERIAL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "integration_outbox_provider_idx" ON "integration_outbox"("provider");
CREATE INDEX IF NOT EXISTS "integration_outbox_status_idx" ON "integration_outbox"("status");
CREATE INDEX IF NOT EXISTS "integration_outbox_created_at_idx" ON "integration_outbox"("created_at");

CREATE TABLE IF NOT EXISTS "purchases" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "supplier" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "purchase_items" (
  "id" SERIAL PRIMARY KEY,
  "purchase_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER,
  "description" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "line_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "_migrations" (
  "id" SERIAL PRIMARY KEY,
  "filename" TEXT NOT NULL,
  "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "_migrations_filename_key" ON "_migrations"("filename");
