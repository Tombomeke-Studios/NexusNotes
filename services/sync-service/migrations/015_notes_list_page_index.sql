-- The paged note list (#461) walks a vault's notes in (path, id) order.
CREATE INDEX IF NOT EXISTS idx_notes_vault_path_id ON notes(vault_id, path, id);
