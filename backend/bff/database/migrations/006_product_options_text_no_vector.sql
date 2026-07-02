BEGIN;

ALTER TABLE products DROP COLUMN IF EXISTS embedding;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'products'
      AND column_name = 'ai_text'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'products'
      AND column_name = 'options_text'
  ) THEN
    ALTER TABLE products RENAME COLUMN ai_text TO options_text;
  END IF;
END;
$$;

ALTER TABLE products
  ALTER COLUMN category DROP NOT NULL;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_category_check;

ALTER TABLE products
  ADD CONSTRAINT products_category_check
  CHECK (category IS NULL OR btrim(category) <> '');

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_ai_text_check;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_options_text_check;

ALTER TABLE products
  ADD CONSTRAINT products_options_text_check
  CHECK (btrim(options_text) <> '');

COMMENT ON TABLE products IS
    'Merchant-isolated product catalog. MVP intentionally does not store inventory or product jump paths.';

COMMIT;
