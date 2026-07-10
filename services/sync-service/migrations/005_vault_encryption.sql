-- E2EE vaults (docs/encryption.md): the server stores the encryption mode plus
-- an opaque, client-written key-material blob (KDF salt/params, wrapped vault
-- keys) that it never interprets. Note ciphertext reuses notes.content as an
-- "iv:ciphertext" base64 payload, so the notes schema is unchanged.
ALTER TABLE vaults ADD COLUMN encryption      TEXT  NOT NULL DEFAULT 'none';
ALTER TABLE vaults ADD COLUMN encryption_meta JSONB;
