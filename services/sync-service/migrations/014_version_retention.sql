-- Per-vault version history retention (#418): keep the newest N versions of
-- each note, and optionally drop versions older than D days (0 = no age
-- limit). A note's newest version is always kept.
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS version_keep_count INT NOT NULL DEFAULT 50;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS version_keep_days INT NOT NULL DEFAULT 0;
ALTER TABLE vaults DROP CONSTRAINT IF EXISTS vaults_version_keep_count_range;
ALTER TABLE vaults ADD CONSTRAINT vaults_version_keep_count_range CHECK (version_keep_count BETWEEN 1 AND 500);
ALTER TABLE vaults DROP CONSTRAINT IF EXISTS vaults_version_keep_days_range;
ALTER TABLE vaults ADD CONSTRAINT vaults_version_keep_days_range CHECK (version_keep_days BETWEEN 0 AND 3650);
