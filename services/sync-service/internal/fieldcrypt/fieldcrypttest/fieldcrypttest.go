// Package fieldcrypttest provides a field cipher under a fixed key for tests.
package fieldcrypttest

import (
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
)

// Key is the fixed test data key. Never use it outside tests.
const Key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

// Cipher returns a field cipher under Key.
func Cipher(t testing.TB) *fieldcrypt.Cipher {
	t.Helper()
	c, err := fieldcrypt.New(Key, nil)
	if err != nil {
		t.Fatal(err)
	}
	return c
}
