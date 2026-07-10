package service

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// Argon2id parameters following the OWASP Password Storage Cheat Sheet
// (19 MiB memory, 2 iterations, 1 lane).
const (
	argonMemoryKiB uint32 = 19456
	argonTime      uint32 = 2
	argonThreads   uint8  = 1
	argonSaltLen          = 16
	argonKeyLen    uint32 = 32
)

// hashPassword hashes a password with Argon2id and encodes it as a PHC string
// so the parameters travel with the hash and can be raised later without
// breaking existing records.
func hashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryKiB, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// dummyHash is a valid Argon2id hash of an unguessable random value, used to
// equalise login timing when the email does not exist (user enumeration).
var dummyHash = sync.OnceValue(func() string {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		panic(fmt.Sprintf("generate dummy password: %v", err))
	}
	hash, err := hashPassword(base64.RawStdEncoding.EncodeToString(random))
	if err != nil {
		panic(fmt.Sprintf("hash dummy password: %v", err))
	}
	return hash
})

// dummyPasswordVerify burns the same KDF work as a real verification and
// always fails. Declared as a variable so tests can observe the call.
var dummyPasswordVerify = func(password string) {
	_, _, _ = verifyPassword(dummyHash(), password)
}

// verifyPassword checks a password against a stored Argon2id or legacy bcrypt
// hash. needsRehash reports that the stored hash uses an outdated scheme or
// parameters and should be replaced after a successful verification.
func verifyPassword(hash, password string) (ok bool, needsRehash bool, err error) {
	if strings.HasPrefix(hash, "$2a$") || strings.HasPrefix(hash, "$2b$") || strings.HasPrefix(hash, "$2y$") {
		if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
			if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				return false, false, nil
			}
			return false, false, fmt.Errorf("compare bcrypt hash: %w", err)
		}
		return true, true, nil
	}

	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, false, errors.New("unsupported password hash format")
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, false, fmt.Errorf("parse hash version: %w", err)
	}
	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false, false, fmt.Errorf("parse hash parameters: %w", err)
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, false, fmt.Errorf("decode salt: %w", err)
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, false, fmt.Errorf("decode hash: %w", err)
	}

	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want)))
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return false, false, nil
	}

	outdated := memory != argonMemoryKiB || time != argonTime || threads != argonThreads
	return true, outdated, nil
}
