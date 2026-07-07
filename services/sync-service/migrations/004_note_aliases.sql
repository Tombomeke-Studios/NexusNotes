CREATE TABLE note_aliases (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    alias   TEXT NOT NULL,
    PRIMARY KEY (note_id, alias)
);

CREATE INDEX idx_note_aliases_note_id ON note_aliases(note_id);
CREATE INDEX idx_note_aliases_alias   ON note_aliases(alias);
