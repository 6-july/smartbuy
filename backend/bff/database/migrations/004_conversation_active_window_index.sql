BEGIN;

CREATE INDEX IF NOT EXISTS idx_conversations_active_window
    ON conversations (
        user_id,
        merchant_id,
        (COALESCE(last_message_time, created_at)) DESC,
        created_at DESC
    )
    WHERE status = 'active';

COMMIT;
