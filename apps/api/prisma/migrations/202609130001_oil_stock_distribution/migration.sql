CREATE TABLE IF NOT EXISTS "central_warehouses" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT 'สต็อกกลางน้ำมันเครื่อง',
  "manager_branch_id" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "central_warehouses_manager_branch_id_fkey" FOREIGN KEY ("manager_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "central_warehouses_manager_branch_id_idx" ON "central_warehouses"("manager_branch_id");

CREATE TABLE IF NOT EXISTS "warehouse_stocks" (
  "id" SERIAL PRIMARY KEY,
  "warehouse_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "stock_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reorder_level" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warehouse_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "central_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "warehouse_stocks_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_stocks_warehouse_id_ingredient_id_key" ON "warehouse_stocks"("warehouse_id", "ingredient_id");
CREATE INDEX IF NOT EXISTS "warehouse_stocks_ingredient_id_idx" ON "warehouse_stocks"("ingredient_id");

CREATE TABLE IF NOT EXISTS "warehouse_stock_movements" (
  "id" SERIAL PRIMARY KEY,
  "warehouse_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "reference_type" TEXT NOT NULL DEFAULT '',
  "reference_id" INTEGER,
  "actor_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warehouse_stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "central_warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "warehouse_stock_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "warehouse_stock_movements_warehouse_id_idx" ON "warehouse_stock_movements"("warehouse_id");
CREATE INDEX IF NOT EXISTS "warehouse_stock_movements_ingredient_id_idx" ON "warehouse_stock_movements"("ingredient_id");
CREATE INDEX IF NOT EXISTS "warehouse_stock_movements_reference_type_reference_id_idx" ON "warehouse_stock_movements"("reference_type", "reference_id");

CREATE TABLE IF NOT EXISTS "restock_requests" (
  "id" SERIAL PRIMARY KEY,
  "warehouse_id" INTEGER NOT NULL,
  "branch_id" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "note" TEXT NOT NULL DEFAULT '',
  "requested_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "picking_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  CONSTRAINT "restock_requests_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "central_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restock_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "restock_requests_warehouse_id_idx" ON "restock_requests"("warehouse_id");
CREATE INDEX IF NOT EXISTS "restock_requests_branch_id_idx" ON "restock_requests"("branch_id");
CREATE INDEX IF NOT EXISTS "restock_requests_status_idx" ON "restock_requests"("status");
CREATE INDEX IF NOT EXISTS "restock_requests_created_at_idx" ON "restock_requests"("created_at");

CREATE TABLE IF NOT EXISTS "restock_request_items" (
  "id" SERIAL PRIMARY KEY,
  "request_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "requested_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reserved_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "shipped_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "received_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "restock_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "restock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "restock_request_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "restock_request_items_request_id_ingredient_id_key" ON "restock_request_items"("request_id", "ingredient_id");
CREATE INDEX IF NOT EXISTS "restock_request_items_ingredient_id_idx" ON "restock_request_items"("ingredient_id");

CREATE TABLE IF NOT EXISTS "restock_shipments" (
  "id" SERIAL PRIMARY KEY,
  "restock_request_id" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_TRANSIT',
  "dispatched_by_user_id" INTEGER,
  "received_by_user_id" INTEGER,
  "note" TEXT NOT NULL DEFAULT '',
  "dispatched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_at" TIMESTAMP(3),
  CONSTRAINT "restock_shipments_restock_request_id_fkey" FOREIGN KEY ("restock_request_id") REFERENCES "restock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "restock_shipments_restock_request_id_idx" ON "restock_shipments"("restock_request_id");
CREATE INDEX IF NOT EXISTS "restock_shipments_status_idx" ON "restock_shipments"("status");

CREATE TABLE IF NOT EXISTS "restock_shipment_items" (
  "id" SERIAL PRIMARY KEY,
  "shipment_id" INTEGER NOT NULL,
  "request_item_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "shipped_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "received_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "restock_shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "restock_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "restock_shipment_items_request_item_id_fkey" FOREIGN KEY ("request_item_id") REFERENCES "restock_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restock_shipment_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "restock_shipment_items_shipment_id_request_item_id_key" ON "restock_shipment_items"("shipment_id", "request_item_id");
CREATE INDEX IF NOT EXISTS "restock_shipment_items_ingredient_id_idx" ON "restock_shipment_items"("ingredient_id");
