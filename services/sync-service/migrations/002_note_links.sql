-- Wiki-link graph: tracks [[wikilinks]] between notes within a vault.
-- target_note_id is NULL when the target note doesn't exist yet (unresolved link).

CREATE TABLE note_links (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    vault_id        TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    source_note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_title    TEXT NOT NULL,
    anchor          TEXT NOT NULL DEFAULT '',
    target_note_id  TEXT REFERENCES notes(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_note_links_source  ON note_links(source_note_id);
CREATE INDEX idx_note_links_target  ON note_links(target_note_id);
CREATE INDEX idx_note_links_vault   ON note_links(vault_id);
