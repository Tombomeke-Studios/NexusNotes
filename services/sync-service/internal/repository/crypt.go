package repository

import (
	"fmt"
	"sort"
	"strings"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
)

// Fields encrypted at rest (#352). The name is authenticated with each value,
// so it must never change for a column that already holds data.
const (
	fieldNoteContent      = "notes.content"
	fieldVersionContent   = "note_versions.content"
	fieldVaultName        = "vaults.name"
	fieldLinkedFileName   = "linked_files.display_name"
	fieldLinkedFileSource = "linked_files.source_ref"
	fieldAnnotation       = "linked_file_annotations.content"
	fieldUserDisplayName  = "users.display_name"
	fieldUserEmail        = "users.email"
	fieldDeviceName       = "devices.name"
)

// cryptor seals and opens a repository's encrypted-at-rest fields, so callers
// only ever see plaintext and the database only ever holds ciphertext.
type cryptor struct {
	c *fieldcrypt.Cipher
}

func (k cryptor) seal(field, plaintext string) (string, error) {
	enc, err := k.c.Encrypt(field, plaintext)
	if err != nil {
		return "", fmt.Errorf("encrypt %s: %w", field, err)
	}
	return enc, nil
}

func (k cryptor) open(field string, value *string) error {
	plain, err := k.c.Decrypt(field, *value)
	if err != nil {
		return fmt.Errorf("decrypt %s: %w", field, err)
	}
	*value = plain
	return nil
}

// sortByName orders items by a decrypted name, case-insensitively: the
// database can no longer ORDER BY an encrypted column.
func sortByName[T any](items []T, name func(*T) string) {
	sort.SliceStable(items, func(i, j int) bool {
		a, b := name(&items[i]), name(&items[j])
		if la, lb := strings.ToLower(a), strings.ToLower(b); la != lb {
			return la < lb
		}
		return a < b
	})
}
