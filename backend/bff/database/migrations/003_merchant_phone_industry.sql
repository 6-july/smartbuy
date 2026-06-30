BEGIN;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS phone varchar(32);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS industry varchar(64) NOT NULL DEFAULT '综合零售';

COMMENT ON COLUMN merchants.phone IS '商家客服电话，AI 引导用户咨询时使用';
COMMENT ON COLUMN merchants.industry IS '商家行业（如 蛋糕烘焙、鲜花、水果、餐饮 等），用于约束 AI 对话范围';

COMMIT;
