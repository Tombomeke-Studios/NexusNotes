-- Trash with a 30-day restore (#569): a deleted note keeps its row, marked
-- with when it went to the trash, until it is restored or purged. Existing
-- notes stay live (NULL).
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Every live read filters on deleted_at IS NULL: the note list walks live
-- notes in (path, id) order.
CREATE INDEX IF NOT EXISTS idx_notes_live_vault_path_id ON notes(vault_id, path, id) WHERE deleted_at IS NULL;

-- A vault's trash view, and the purge job looking for notes past retention.
CREATE INDEX IF NOT EXISTS idx_notes_trashed_vault ON notes(vault_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_trashed_at ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
