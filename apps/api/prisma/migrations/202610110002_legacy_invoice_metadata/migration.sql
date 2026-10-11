-- Repair only legacy metadata backed by settings last saved before issuance.
-- Unknown real seller information stays blank; no issued number or amount changes.
UPDATE "tax_invoices" AS invoice
SET "seller_name" = setting."shop_name",
    "seller_tax_id" = setting."tax_id",
    "seller_address" = setting."address_line",
    "seller_branch" = setting."branch_label"
FROM "store_settings" AS setting
WHERE invoice."branch_id" = setting."branch_id"
  AND setting."updated_at" <= invoice."created_at"
  AND invoice."seller_name" = '' AND invoice."seller_tax_id" = '' AND invoice."seller_address" = ''
  AND trim(setting."shop_name") <> '' AND trim(setting."address_line") <> ''
  AND CASE WHEN setting."tax_id" ~ '^[0-9]{13}$' THEN
    (SELECT (11 - sum(substring(setting."tax_id", digit, 1)::int * (14 - digit)) % 11) % 10
     FROM generate_series(1, 12) AS digit) = substring(setting."tax_id", 13, 1)::int
    ELSE false END;

-- Match the saved VAT setting to the invoice's recorded VAT within satang rounding.
-- A later setting or a zero VAT amount does not prove a historical rate.
UPDATE "tax_invoices" AS invoice
SET "vat_rate" = setting."vat_rate"
FROM "store_settings" AS setting
WHERE invoice."branch_id" = setting."branch_id"
  AND setting."updated_at" <= invoice."created_at"
  AND invoice."vat_rate" = 0 AND invoice."tax" > 0 AND invoice."total" > invoice."tax"
  AND setting."vat_rate" > 0 AND setting."vat_mode" <> 'NONE'
  AND abs(invoice."tax" - round((invoice."total" * setting."vat_rate" / (100 + setting."vat_rate"))::numeric, 2)::double precision) <= 0.01;
