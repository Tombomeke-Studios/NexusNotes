package service

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

func ComputeChecksum(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}

// resolveChecksum picks the checksum stored with a note. Standard vaults
// always get the server-computed hash — client checksums are never trusted.
// For e2ee vaults the stored content is ciphertext the server cannot hash
// meaningfully, so the client-computed plaintext hash is stored verbatim
// (same plaintext -> same checksum keeps conflict detection working); when a
// client omits it, the ciphertext hash is a stable fallback.
func resolveChecksum(vaultEncryption, content, clientChecksum string) string {
	if vaultEncryption == model.VaultEncryptionE2EE && clientChecksum != "" {
		return clientChecksum
	}
	return ComputeChecksum(content)
}
