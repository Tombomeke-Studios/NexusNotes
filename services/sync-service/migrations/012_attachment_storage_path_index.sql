-- The orphan sweep (#316) looks attachments up by storage key.
CREATE INDEX IF NOT EXISTS idx_attachments_storage_path ON attachments(storage_path);
