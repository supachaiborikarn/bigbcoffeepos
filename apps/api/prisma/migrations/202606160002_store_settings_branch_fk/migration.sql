DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_settings_branch_id_fkey'
  ) THEN
    ALTER TABLE "store_settings"
      ADD CONSTRAINT "store_settings_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
