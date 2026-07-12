CREATE TABLE starred_notes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    starred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, note_id)
);

CREATE INDEX idx_starred_notes_user ON starred_notes(user_id);
