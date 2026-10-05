-- The search fallback reads a vault's notes newest first (#220).
CREATE INDEX IF NOT EXISTS idx_notes_vault_updated ON notes(vault_id, updated_at DESC);
