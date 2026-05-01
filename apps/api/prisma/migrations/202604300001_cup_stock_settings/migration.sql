CREATE TABLE "cup_stock_settings" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "cup_option" TEXT NOT NULL,
  "deduct_stock" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cup_stock_settings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "cup_stock_setting_items" (
  "id" SERIAL PRIMARY KEY,
  "setting_id" INTEGER NOT NULL,
  "ingredient_id" INTEGER NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  CONSTRAINT "cup_stock_setting_items_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "cup_stock_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cup_stock_setting_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cup_stock_settings_branch_id_cup_option_key" ON "cup_stock_settings"("branch_id", "cup_option");
CREATE INDEX "cup_stock_settings_branch_id_idx" ON "cup_stock_settings"("branch_id");
CREATE UNIQUE INDEX "cup_stock_setting_items_setting_id_ingredient_id_key" ON "cup_stock_setting_items"("setting_id", "ingredient_id");
CREATE INDEX "cup_stock_setting_items_ingredient_id_idx" ON "cup_stock_setting_items"("ingredient_id");
