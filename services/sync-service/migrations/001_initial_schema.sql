-- NexusNotes initial schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vaults (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vaults_user_id ON vaults(user_id);

CREATE TABLE notes (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    vault_id   TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    path       TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    checksum   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_vault_id ON notes(vault_id);
CREATE INDEX idx_notes_path ON notes(vault_id, path);

CREATE TABLE note_versions (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    device_id  TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_note_versions_note_id ON note_versions(note_id);

CREATE TABLE devices (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT '',
    platform   TEXT NOT NULL DEFAULT '',
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_user_id ON devices(user_id);

CREATE TABLE attachments (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    vault_id     TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    mime_type    TEXT NOT NULL DEFAULT '',
    size_bytes   BIGINT NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_note_id ON attachments(note_id);
