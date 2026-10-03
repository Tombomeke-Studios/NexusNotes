-- A version is a snapshot that later saves of the same device update for a
-- few minutes (#413): updated_at is when it last changed, created_at when the
-- snapshot started. The index serves the newest-first listing and pruning.
ALTER TABLE note_versions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE note_versions SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE note_versions ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE note_versions ALTER COLUMN updated_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_note_versions_note_created ON note_versions(note_id, created_at DESC);
