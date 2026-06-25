CREATE TABLE note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
);

CREATE INDEX idx_note_tags_tag     ON note_tags(tag);
CREATE INDEX idx_note_tags_note_id ON note_tags(note_id);
