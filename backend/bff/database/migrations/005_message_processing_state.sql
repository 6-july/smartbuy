BEGIN;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS processing_status varchar(20) NOT NULL DEFAULT 'completed'
        CHECK (processing_status IN ('processing', 'completed', 'failed')),
    ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS processing_completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS processing_attempt_id uuid,
    ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES messages(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_reply_to_message
    ON messages (reply_to_message_id)
    WHERE reply_to_message_id IS NOT NULL;

COMMENT ON COLUMN messages.processing_status IS
    'User-message AI processing state; non-user messages remain completed.';
COMMENT ON COLUMN messages.reply_to_message_id IS
    'Explicit link from an assistant reply to the user message it answers.';
COMMENT ON COLUMN messages.processing_attempt_id IS
    'Lease id that prevents a stale worker from overwriting a newer retry.';

COMMIT;
