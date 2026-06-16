CREATE TABLE "store_settings" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "shop_name" TEXT NOT NULL DEFAULT '',
  "tax_id" TEXT NOT NULL DEFAULT '',
  "branch_label" TEXT NOT NULL DEFAULT '',
  "address_line" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "receipt_header" TEXT NOT NULL DEFAULT '',
  "receipt_footer" TEXT NOT NULL DEFAULT 'ขอบคุณที่ใช้บริการ',
  "vat_mode" TEXT NOT NULL DEFAULT 'INCLUSIVE',
  "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 7,
  "payment_methods" TEXT NOT NULL DEFAULT '["CASH","QR","CARD"]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "store_settings_branch_id_key" ON "store_settings"("branch_id");
