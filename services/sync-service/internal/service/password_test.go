package service

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestHashPassword_ProducesArgon2id(t *testing.T) {
	hash, err := hashPassword("secret-password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("hash = %q, want $argon2id$ prefix", hash)
	}
}

func TestVerifyPassword_Roundtrip(t *testing.T) {
	hash, err := hashPassword("secret-password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	ok, needsRehash, err := verifyPassword(hash, "secret-password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("correct password did not verify")
	}
	if needsRehash {
		t.Fatal("fresh argon2id hash should not need a rehash")
	}
}

func TestVerifyPassword_WrongPassword(t *testing.T) {
	hash, _ := hashPassword("secret-password")
	ok, _, err := verifyPassword(hash, "wrong-password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("wrong password must not verify")
	}
}

func TestVerifyPassword_LegacyBcrypt(t *testing.T) {
	legacy, _ := bcrypt.GenerateFromPassword([]byte("secret-password"), bcrypt.DefaultCost)

	ok, needsRehash, err := verifyPassword(string(legacy), "secret-password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("correct password did not verify against legacy bcrypt hash")
	}
	if !needsRehash {
		t.Fatal("legacy bcrypt hash must be flagged for rehash")
	}

	ok, _, err = verifyPassword(string(legacy), "wrong-password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("wrong password must not verify against legacy bcrypt hash")
	}
}

func TestVerifyPassword_MalformedHash(t *testing.T) {
	if _, _, err := verifyPassword("not-a-hash", "whatever"); err == nil {
		t.Fatal("expected an error for a malformed hash")
	}
}
