-- Consent at signup (#289): when the user accepted the Terms of Service and
-- Privacy Policy, and which version they accepted. Accounts from before this
-- have none recorded.
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
