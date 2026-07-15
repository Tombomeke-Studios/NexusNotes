CREATE TABLE linked_files (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    vault_id     TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    source_type  TEXT NOT NULL,               -- 'url', 'local_path', 'github_path'
    source_ref   TEXT NOT NULL,               -- the URL / path / repo file ref
    read_only    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_linked_files_vault ON linked_files(vault_id);

-- Personal annotations layered on top of a read-only linked file (#64);
-- stored separately so re-syncing the source never overwrites them.
CREATE TABLE linked_file_annotations (
    linked_file_id TEXT NOT NULL REFERENCES linked_files(id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content        TEXT NOT NULL DEFAULT '',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (linked_file_id, user_id)
);
