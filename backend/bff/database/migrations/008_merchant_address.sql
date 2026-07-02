BEGIN;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN merchants.address IS '商家门店地址，AI 回答地址/位置咨询时使用';

COMMIT;
