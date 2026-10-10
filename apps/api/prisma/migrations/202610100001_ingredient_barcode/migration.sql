-- Stock items can carry their own barcode (scanned when receiving goods).
ALTER TABLE "ingredients" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ingredients_barcode_key" ON "ingredients"("barcode");
