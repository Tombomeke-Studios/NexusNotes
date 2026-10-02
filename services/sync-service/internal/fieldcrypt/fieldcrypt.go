// Package fieldcrypt encrypts individual text fields at rest with a
// server-held data key (#353), so a database dump or backup does not expose
// user data. It complements end-to-end encryption: e2ee content arrives as
// ciphertext already and is wrapped once more here.
//
// Values are AES-256-GCM sealed and stored as a self-describing envelope:
//
//	nxe1:<key id>:<base64url(nonce || ciphertext)>
//
// The field name ("notes.content") is the GCM additional data, so a value
// copied into another column does not decrypt. The key id lets an old key
// keep decrypting after rotation while new writes use the current key.
// Values without the envelope prefix are legacy plaintext and are returned
// unchanged until the startup backfill has encrypted them.
package fieldcrypt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const (
	envelopePrefix = "nxe1:"
	// KeyHexLength is the length of a data key: 32 random bytes as hex
	// (generate one with `openssl rand -hex 32`).
	KeyHexLength = 64
)

var errMalformed = errors.New("fieldcrypt: malformed encrypted value")

type dataKey struct {
	id    string
	aead  cipher.AEAD
	index []byte
}

// Cipher encrypts with the current key and decrypts with any configured key.
type Cipher struct {
	current *dataKey
	byID    map[string]*dataKey
	// keys lists every configured key, the current one first.
	keys []*dataKey
}

// New builds a Cipher from the current data key and any retired keys that
// existing values may still be encrypted under. Keys are 64 hex characters.
func New(currentHex string, oldHex []string) (*Cipher, error) {
	current, err := parseKey(currentHex)
	if err != nil {
		return nil, fmt.Errorf("data encryption key: %w", err)
	}
	c := &Cipher{current: current, byID: map[string]*dataKey{current.id: current}, keys: []*dataKey{current}}
	for i, h := range oldHex {
		k, err := parseKey(h)
		if err != nil {
			return nil, fmt.Errorf("old data encryption key %d: %w", i+1, err)
		}
		if _, dup := c.byID[k.id]; !dup {
			c.byID[k.id] = k
			c.keys = append(c.keys, k)
		}
	}
	return c, nil
}

func parseKey(h string) (*dataKey, error) {
	if len(h) != KeyHexLength {
		return nil, fmt.Errorf("must be %d hex characters (generate one with: openssl rand -hex 32)", KeyHexLength)
	}
	master, err := hex.DecodeString(h)
	if err != nil {
		return nil, errors.New("must be hex encoded (generate one with: openssl rand -hex 32)")
	}
	// Separate subkeys per purpose, so the encryption key never doubles as
	// the blind-index MAC key or leaks through the public key id.
	encKey, err := hkdf.Key(sha256.New, master, nil, "nexusnotes field encryption v1", 32)
	if err != nil {
		return nil, err
	}
	indexKey, err := hkdf.Key(sha256.New, master, nil, "nexusnotes blind index v1", 32)
	if err != nil {
		return nil, err
	}
	idBytes, err := hkdf.Key(sha256.New, master, nil, "nexusnotes key id v1", 4)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(encKey)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &dataKey{id: hex.EncodeToString(idBytes), aead: aead, index: indexKey}, nil
}

// IsEncrypted reports whether v is an encrypted envelope (vs legacy plaintext).
func IsEncrypted(v string) bool {
	return strings.HasPrefix(v, envelopePrefix)
}

// Encrypt seals plaintext for the given field under the current key.
func (c *Cipher) Encrypt(field, plaintext string) (string, error) {
	k := c.current
	nonce := make([]byte, k.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := k.aead.Seal(nonce, nonce, []byte(plaintext), []byte(field))
	return envelopePrefix + k.id + ":" + base64.RawURLEncoding.EncodeToString(sealed), nil
}

// Decrypt opens a value encrypted for field. Legacy plaintext (no envelope
// prefix) is returned as is.
func (c *Cipher) Decrypt(field, value string) (string, error) {
	if !IsEncrypted(value) {
		return value, nil
	}
	id, payload, ok := strings.Cut(strings.TrimPrefix(value, envelopePrefix), ":")
	if !ok {
		return "", errMalformed
	}
	k, ok := c.byID[id]
	if !ok {
		return "", fmt.Errorf("fieldcrypt: value is encrypted under unknown key %q (is an old DATA_ENCRYPTION_KEY missing?)", id)
	}
	sealed, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil || len(sealed) < k.aead.NonceSize() {
		return "", errMalformed
	}
	nonce, ct := sealed[:k.aead.NonceSize()], sealed[k.aead.NonceSize():]
	plain, err := k.aead.Open(nil, nonce, ct, []byte(field))
	if err != nil {
		return "", errors.New("fieldcrypt: value failed authentication (wrong field, key or tampered data)")
	}
	return string(plain), nil
}

// NeedsReencrypt reports whether a stored value should be rewritten: it is
// legacy plaintext, or encrypted under a key other than the current one.
func (c *Cipher) NeedsReencrypt(value string) bool {
	if !IsEncrypted(value) {
		return true
	}
	return !strings.HasPrefix(value, envelopePrefix+c.current.id+":")
}

// BlindIndex returns a deterministic, non-reversible token for value, for
// equality lookups on an encrypted field (e.g. finding a user by email).
// Callers normalise value first (e.g. lower-case an email address).
func (c *Cipher) BlindIndex(field, value string) string {
	return c.current.blindIndex(field, value)
}

// BlindIndexes returns value's blind index under every configured key, the
// current key's first. Lookups match any of them, so rows indexed before a
// key rotation are still found until they are re-indexed.
func (c *Cipher) BlindIndexes(field, value string) []string {
	out := make([]string, len(c.keys))
	for i, k := range c.keys {
		out[i] = k.blindIndex(field, value)
	}
	return out
}

func (k *dataKey) blindIndex(field, value string) string {
	mac := hmac.New(sha256.New, k.index)
	mac.Write([]byte(field))
	mac.Write([]byte{0})
	mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
