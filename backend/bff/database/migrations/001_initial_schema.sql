BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wechat_app_id varchar(128) NOT NULL,
    open_id varchar(128) NOT NULL,
    union_id varchar(128),
    nickname varchar(100),
    avatar_url text,
    status varchar(20) NOT NULL DEFAULT 'enabled'
        CHECK (status IN ('enabled', 'disabled', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_wechat_identity UNIQUE (wechat_app_id, open_id)
);

CREATE TABLE IF NOT EXISTS merchants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(200) NOT NULL CHECK (btrim(name) <> ''),
    logo text,
    description text,
    banner_image text,
    mini_program_app_id varchar(128) NOT NULL,
    scene_code varchar(32) NOT NULL,
    recommend_questions jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(recommend_questions) = 'array'),
    status varchar(20) NOT NULL DEFAULT 'enabled'
        CHECK (status IN ('enabled', 'disabled', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_merchants_scene_code UNIQUE (scene_code)
);

CREATE TABLE IF NOT EXISTS products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    source varchar(32) NOT NULL CHECK (btrim(source) <> ''),
    source_shop_id varchar(128),
    source_product_id varchar(128) NOT NULL CHECK (btrim(source_product_id) <> ''),
    alias varchar(128),
    category varchar(128) NOT NULL CHECK (btrim(category) <> ''),
    title text NOT NULL CHECK (btrim(title) <> ''),
    description text,
    display_price numeric(12, 2) NOT NULL CHECK (display_price >= 0),
    min_price numeric(12, 2) NOT NULL CHECK (min_price >= 0),
    max_price numeric(12, 2) NOT NULL CHECK (max_price >= min_price),
    images jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(images) = 'array'),
    sales bigint NOT NULL DEFAULT 0 CHECK (sales >= 0),
    is_recommended boolean NOT NULL DEFAULT false,
    options jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(options) = 'array'),
    tags jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(tags) = 'array'),
    ai_text text NOT NULL CHECK (btrim(ai_text) <> ''),
    sale_status varchar(20) NOT NULL DEFAULT 'on_sale'
        CHECK (sale_status IN ('on_sale', 'off_sale', 'deleted')),
    embedding vector,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_products_merchant_source
        UNIQUE (merchant_id, source, source_product_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    last_message text,
    last_message_time timestamptz,
    status varchar(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_conversations_user_merchant UNIQUE (user_id, merchant_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    role varchar(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content text NOT NULL,
    message_type varchar(20) NOT NULL DEFAULT 'text'
        CHECK (message_type IN ('text', 'product_card')),
    products jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(products) = 'array'),
    client_message_id varchar(128),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchants_status
    ON merchants (status);

CREATE INDEX IF NOT EXISTS idx_products_merchant_status
    ON products (merchant_id, sale_status);

CREATE INDEX IF NOT EXISTS idx_products_merchant_category
    ON products (merchant_id, category);

CREATE INDEX IF NOT EXISTS idx_products_merchant_price
    ON products (merchant_id, min_price, max_price);

CREATE INDEX IF NOT EXISTS idx_products_tags_gin
    ON products USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_products_title_trgm
    ON products USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_conversations_user_recent
    ON conversations (user_id, last_message_time DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_conversations_merchant
    ON conversations (merchant_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_merchant_created
    ON messages (merchant_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_client_message
    ON messages (conversation_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_merchants_set_updated_at ON merchants;
CREATE TRIGGER trg_merchants_set_updated_at
BEFORE UPDATE ON merchants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_set_updated_at ON products;
CREATE TRIGGER trg_products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_set_updated_at ON conversations;
CREATE TRIGGER trg_conversations_set_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN products.embedding IS
    'Embedding generated from ai_text. NULL means not generated or generation failed.';

COMMENT ON TABLE products IS
    'Merchant-isolated product knowledge base. MVP intentionally does not store inventory or product jump paths.';

COMMIT;
