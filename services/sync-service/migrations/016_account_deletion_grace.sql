-- Account deletion with a 7-day grace period (#289): a scheduled deletion
-- time on the user, a cancel link sent by email, and a confirm link for
-- deletion requested without signing in. Token tables have the shape of the
-- email verification ones (hashed, single-use, expiring).
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_deletion_due ON users(deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_deletion_cancel_tokens (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_deletion_request_tokens (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_cancel_tokens_user ON account_deletion_cancel_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_deletion_request_tokens_user ON account_deletion_request_tokens(user_id);
