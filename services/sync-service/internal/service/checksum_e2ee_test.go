package service

import (
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

func TestResolveChecksum_StandardVaultIgnoresClientChecksum(t *testing.T) {
	// The server never trusts client checksums when it can compute its own.
	got := resolveChecksum(model.VaultEncryptionNone, "hello", "attacker-supplied")
	if got != ComputeChecksum("hello") {
		t.Fatalf("got %q, want server-computed checksum", got)
	}
}

func TestResolveChecksum_E2EEVaultUsesClientChecksum(t *testing.T) {
	// For e2ee vaults the content is ciphertext; only the client can hash the
	// plaintext, so its checksum is stored verbatim.
	got := resolveChecksum(model.VaultEncryptionE2EE, "b64iv:b64cipher", "client-plaintext-hash")
	if got != "client-plaintext-hash" {
		t.Fatalf("got %q, want the client checksum", got)
	}
}

func TestResolveChecksum_E2EEWithoutClientChecksumFallsBack(t *testing.T) {
	// Defensive: an e2ee save without a checksum still gets a stable value.
	got := resolveChecksum(model.VaultEncryptionE2EE, "b64iv:b64cipher", "")
	if got != ComputeChecksum("b64iv:b64cipher") {
		t.Fatalf("got %q, want ciphertext hash fallback", got)
	}
}
