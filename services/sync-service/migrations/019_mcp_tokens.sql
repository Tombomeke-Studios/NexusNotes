-- Named API tokens for AI clients over MCP (#221). Only a hash of each token
-- is stored; the name is encrypted at rest like other user-chosen labels.
CREATE TABLE IF NOT EXISTS mcp_tokens (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    scope        TEXT NOT NULL CHECK (scope IN ('read', 'read-write')),
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id);

-- One row per request made with an MCP token: which tool, and the method and
-- path it called (identifiers only, never note content or search terms).
CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id         BIGSERIAL PRIMARY KEY,
    token_id   TEXT NOT NULL REFERENCES mcp_tokens(id) ON DELETE CASCADE,
    tool       TEXT NOT NULL,
    summary    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_token_created ON mcp_audit_log(token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_created ON mcp_audit_log(created_at);
