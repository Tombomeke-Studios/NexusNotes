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
	"bytes"
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
	rawID []byte
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
	return &dataKey{id: hex.EncodeToString(idBytes), rawID: idBytes, aead: aead, index: indexKey}, nil
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

// CurrentPrefix is the prefix every value encrypted under the current key
// starts with; a stored value without it needs NeedsReencrypt's rewrite. Lets
// a backfill select only the rows that still need work.
func (c *Cipher) CurrentPrefix() string {
	return envelopePrefix + c.current.id + ":"
}

// NeedsReencrypt reports whether a stored value should be rewritten: it is
// legacy plaintext, or encrypted under a key other than the current one.
func (c *Cipher) NeedsReencrypt(value string) bool {
	if !IsEncrypted(value) {
		return true
	}
	return !strings.HasPrefix(value, c.CurrentPrefix())
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

// Binary values (attachment files) use a compact envelope:
//
//	"NXE1" || 4-byte key id || nonce || ciphertext
//
// so a file stored before encryption at rest (any other first bytes) is
// recognised and returned as is.
var bytesMagic = []byte("NXE1")

const keyIDBytes = 4

// IsEncryptedBytes reports whether data is a binary encrypted envelope.
func IsEncryptedBytes(data []byte) bool {
	return bytes.HasPrefix(data, bytesMagic)
}

// EncryptBytes seals binary data for the given field (for a file, its object
// key) under the current key.
func (c *Cipher) EncryptBytes(field string, plaintext []byte) ([]byte, error) {
	k := c.current
	head := make([]byte, 0, len(bytesMagic)+keyIDBytes+k.aead.NonceSize())
	head = append(head, bytesMagic...)
	head = append(head, k.rawID...)
	nonce := make([]byte, k.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	head = append(head, nonce...)
	return k.aead.Seal(head, nonce, plaintext, []byte(field)), nil
}

// DecryptBytes opens data sealed by EncryptBytes for field. Data without the
// envelope magic is legacy plaintext and is returned unchanged.
func (c *Cipher) DecryptBytes(field string, data []byte) ([]byte, error) {
	if !IsEncryptedBytes(data) {
		return data, nil
	}
	rest := data[len(bytesMagic):]
	if len(rest) < keyIDBytes {
		return nil, errMalformed
	}
	id := hex.EncodeToString(rest[:keyIDBytes])
	k, ok := c.byID[id]
	if !ok {
		return nil, fmt.Errorf("fieldcrypt: data is encrypted under unknown key %q (is an old DATA_ENCRYPTION_KEY missing?)", id)
	}
	rest = rest[keyIDBytes:]
	if len(rest) < k.aead.NonceSize() {
		return nil, errMalformed
	}
	plain, err := k.aead.Open(nil, rest[:k.aead.NonceSize()], rest[k.aead.NonceSize():], []byte(field))
	if err != nil {
		return nil, errors.New("fieldcrypt: data failed authentication (wrong field, key or tampered data)")
	}
	return plain, nil
}

// NeedsReencryptBytes reports whether binary data is plaintext or sealed under
// a key other than the current one.
func (c *Cipher) NeedsReencryptBytes(data []byte) bool {
	if !IsEncryptedBytes(data) || len(data) < len(bytesMagic)+keyIDBytes {
		return true
	}
	return !bytes.Equal(data[len(bytesMagic):len(bytesMagic)+keyIDBytes], c.current.rawID)
}
