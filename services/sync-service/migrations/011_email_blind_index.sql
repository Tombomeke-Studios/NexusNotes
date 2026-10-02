-- Email addresses are encrypted at rest (#356). Encryption is randomised, so
-- uniqueness and lookups move to a deterministic blind index (an HMAC of the
-- normalised address, computed by the service). Rows written before this keep
-- a NULL index until the startup backfill fills it in.
ALTER TABLE users ADD COLUMN email_index TEXT;
CREATE UNIQUE INDEX idx_users_email_index ON users(email_index);
CREATE INDEX idx_users_email_unindexed ON users(lower(email)) WHERE email_index IS NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
