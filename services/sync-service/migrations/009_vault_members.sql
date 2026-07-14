CREATE TABLE vault_members (
    vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'viewer', -- 'viewer' or 'editor'
    invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vault_id, user_id)
);

CREATE INDEX idx_vault_members_user ON vault_members(user_id);
