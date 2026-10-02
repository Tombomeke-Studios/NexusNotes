package fieldcrypt

import (
	"encoding/base64"
	"strings"
	"testing"
)

const (
	keyA = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
	keyB = "1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100"
)

func mustNew(t *testing.T, current string, old ...string) *Cipher {
	t.Helper()
	c, err := New(current, old)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	c := mustNew(t, keyA)
	for _, plain := range []string{"", "hello", "# Note\n\nwith ünïcode ✓", strings.Repeat("x", 1<<16)} {
		enc, err := c.Encrypt("notes.content", plain)
		if err != nil {
			t.Fatalf("Encrypt: %v", err)
		}
		if !IsEncrypted(enc) {
			t.Fatalf("Encrypt output %q lacks the envelope prefix", enc[:min(len(enc), 20)])
		}
		if plain != "" && strings.Contains(enc, plain) {
			t.Fatal("ciphertext contains the plaintext")
		}
		got, err := c.Decrypt("notes.content", enc)
		if err != nil {
			t.Fatalf("Decrypt: %v", err)
		}
		if got != plain {
			t.Fatalf("round trip: got %q, want %q", got, plain)
		}
	}
}

func TestEncryptIsRandomised(t *testing.T) {
	c := mustNew(t, keyA)
	a, _ := c.Encrypt("f", "same")
	b, _ := c.Encrypt("f", "same")
	if a == b {
		t.Fatal("two encryptions of the same value must differ (random nonce)")
	}
}

func TestDecryptPassesLegacyPlaintextThrough(t *testing.T) {
	c := mustNew(t, keyA)
	got, err := c.Decrypt("notes.content", "plain old note")
	if err != nil || got != "plain old note" {
		t.Fatalf("legacy plaintext: got %q, %v", got, err)
	}
}

func TestDecryptRejectsAnotherField(t *testing.T) {
	c := mustNew(t, keyA)
	enc, _ := c.Encrypt("users.email", "a@example.com")
	if _, err := c.Decrypt("notes.content", enc); err == nil {
		t.Fatal("a value encrypted for one field must not decrypt as another")
	}
}

func TestDecryptRejectsTampering(t *testing.T) {
	c := mustNew(t, keyA)
	enc, _ := c.Encrypt("f", "secret")
	// Flip one ciphertext byte (not a base64 character, whose padding bits
	// may be ignored by the decoder).
	cut := strings.LastIndex(enc, ":") + 1
	sealed, err := base64.RawURLEncoding.DecodeString(enc[cut:])
	if err != nil {
		t.Fatal(err)
	}
	sealed[len(sealed)-1] ^= 1
	if _, err := c.Decrypt("f", enc[:cut]+base64.RawURLEncoding.EncodeToString(sealed)); err == nil {
		t.Fatal("tampered ciphertext must not decrypt")
	}
	if _, err := c.Decrypt("f", envelopePrefix+"garbage"); err == nil {
		t.Fatal("malformed envelope must not decrypt")
	}
}

func TestDecryptWithUnknownKeyFails(t *testing.T) {
	enc, _ := mustNew(t, keyA).Encrypt("f", "secret")
	if _, err := mustNew(t, keyB).Decrypt("f", enc); err == nil {
		t.Fatal("a value under a key that is not configured must not decrypt")
	}
}

func TestRotation(t *testing.T) {
	old := mustNew(t, keyA)
	enc, _ := old.Encrypt("f", "secret")

	rotated := mustNew(t, keyB, keyA)
	got, err := rotated.Decrypt("f", enc)
	if err != nil || got != "secret" {
		t.Fatalf("old key must still decrypt after rotation: %q, %v", got, err)
	}
	if !rotated.NeedsReencrypt(enc) {
		t.Fatal("a value under a retired key needs re-encryption")
	}
	fresh, _ := rotated.Encrypt("f", "secret")
	if rotated.NeedsReencrypt(fresh) {
		t.Fatal("a value under the current key needs no re-encryption")
	}
	if !strings.HasPrefix(fresh, rotated.CurrentPrefix()) || strings.HasPrefix(enc, rotated.CurrentPrefix()) {
		t.Fatal("CurrentPrefix must match exactly the values under the current key")
	}
	if !rotated.NeedsReencrypt("legacy plaintext") {
		t.Fatal("legacy plaintext needs encryption")
	}
}

func TestBlindIndex(t *testing.T) {
	c := mustNew(t, keyA)
	a := c.BlindIndex("users.email", "a@example.com")
	if a != c.BlindIndex("users.email", "a@example.com") {
		t.Fatal("blind index must be deterministic")
	}
	if a == c.BlindIndex("users.email", "b@example.com") {
		t.Fatal("different values must index differently")
	}
	if a == c.BlindIndex("other.field", "a@example.com") {
		t.Fatal("the field must be part of the index")
	}
	if strings.Contains(a, "example") {
		t.Fatal("blind index must not reveal the value")
	}
	if a == mustNew(t, keyB).BlindIndex("users.email", "a@example.com") {
		t.Fatal("the index must depend on the key")
	}
}

func TestBlindIndexesCoverOldKeys(t *testing.T) {
	old := mustNew(t, keyA).BlindIndex("users.email", "a@example.com")
	rotated := mustNew(t, keyB, keyA)
	all := rotated.BlindIndexes("users.email", "a@example.com")
	if len(all) != 2 || all[0] != rotated.BlindIndex("users.email", "a@example.com") || all[1] != old {
		t.Fatalf("BlindIndexes = %v, want [current, old]", all)
	}
}

func TestNewValidatesKeys(t *testing.T) {
	bad := []string{"", "short", strings.Repeat("z", 64), keyA[:62], keyA + "00"}
	for _, k := range bad {
		if _, err := New(k, nil); err == nil {
			t.Errorf("key %q must be rejected", k)
		}
	}
	if _, err := New(keyA, []string{"nope"}); err == nil {
		t.Error("an invalid old key must be rejected")
	}
	if _, err := New(strings.ToUpper(keyA), nil); err != nil {
		t.Errorf("upper-case hex must be accepted: %v", err)
	}
}
