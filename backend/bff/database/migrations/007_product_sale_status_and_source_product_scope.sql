BEGIN;

UPDATE products
SET sale_status = 'off_sale'
WHERE sale_status NOT IN ('on_sale', 'off_sale');

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_sale_status_check;

ALTER TABLE products
  ADD CONSTRAINT products_sale_status_check
  CHECK (sale_status IN ('on_sale', 'off_sale'));

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS uq_products_merchant_source;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS uq_products_merchant_source_product_id;

ALTER TABLE products
  ADD CONSTRAINT uq_products_merchant_source_product_id
  UNIQUE (merchant_id, source_product_id);

COMMIT;
