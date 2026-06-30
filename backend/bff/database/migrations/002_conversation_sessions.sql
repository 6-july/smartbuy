BEGIN;

-- Allow multiple conversations per user+merchant (session-based)
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS uq_conversations_user_merchant;

-- Index for finding latest conversation per user+merchant
CREATE INDEX IF NOT EXISTS idx_conversations_user_merchant_recent
    ON conversations (user_id, merchant_id, last_message_time DESC NULLS LAST);

COMMIT;
