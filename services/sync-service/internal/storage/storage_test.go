package storage

import (
	"bytes"
	"context"
	"io"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt/fieldcrypttest"
)

// newTestStore connects to the MinIO at MINIO_TEST_ENDPOINT with a throwaway
// bucket that is removed afterwards. Skipped when no test MinIO is configured.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	return newTestStoreWith(t, fieldcrypttest.Cipher(t))
}

func newTestStoreWith(t *testing.T, crypt *fieldcrypt.Cipher) *Store {
	t.Helper()
	endpoint := os.Getenv("MINIO_TEST_ENDPOINT")
	if endpoint == "" {
		t.Skip("MINIO_TEST_ENDPOINT not set; skipping object storage integration test")
	}
	ctx := context.Background()
	s, err := New(ctx, Config{
		Endpoint:  endpoint,
		AccessKey: os.Getenv("MINIO_TEST_ACCESS_KEY"),
		SecretKey: os.Getenv("MINIO_TEST_SECRET_KEY"),
		Bucket:    "nexus-test-" + strings.ReplaceAll(uuid.New().String(), "-", ""),
	}, crypt)
	if err != nil || s == nil {
		t.Fatalf("connect test MinIO: %v", err)
	}
	t.Cleanup(func() {
		_ = s.DeletePrefix(ctx, "") // refused; the loop below empties the bucket
		for obj := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{Recursive: true}) {
			_ = s.client.RemoveObject(ctx, s.bucket, obj.Key, minio.RemoveObjectOptions{})
		}
		_ = s.client.RemoveBucket(ctx, s.bucket)
	})
	return s
}

func keys(t *testing.T, s *Store) []string {
	t.Helper()
	var out []string
	for obj := range s.client.ListObjects(context.Background(), s.bucket, minio.ListObjectsOptions{Recursive: true}) {
		if obj.Err != nil {
			t.Fatalf("list: %v", obj.Err)
		}
		out = append(out, obj.Key)
	}
	sort.Strings(out)
	return out
}

// DeletePrefix can wipe a whole vault, so it must match the vault's directory
// exactly: "v1/" must not touch "v10/…" or "v1x/…".
func TestDeletePrefix_RemovesOnlyThatPrefix(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for _, k := range []string{"v1/a.png", "v1/sub/b.pdf", "v10/c.png", "v1x/d.png"} {
		if err := s.Put(ctx, k, bytes.NewReader([]byte("x")), 1, "application/octet-stream"); err != nil {
			t.Fatalf("put %s: %v", k, err)
		}
	}
	// More objects than one RemoveObjects batch step, to exercise the drain.
	for i := 0; i < 5; i++ {
		k := "v1/bulk/" + uuid.New().String()
		if err := s.Put(ctx, k, bytes.NewReader([]byte("x")), 1, "application/octet-stream"); err != nil {
			t.Fatalf("put %s: %v", k, err)
		}
	}

	if err := s.DeletePrefix(ctx, "v1/"); err != nil {
		t.Fatalf("DeletePrefix: %v", err)
	}
	if got := keys(t, s); strings.Join(got, ",") != "v10/c.png,v1x/d.png" {
		t.Fatalf("remaining objects = %v, want [v10/c.png v1x/d.png]", got)
	}
}

func TestDeletePrefix_RefusesAnEmptyPrefix(t *testing.T) {
	s := &Store{} // never reaches the client
	if err := s.DeletePrefix(context.Background(), ""); err == nil {
		t.Fatal("an empty prefix must be refused: it would match the whole bucket")
	}
}

// rawObject reads an object's stored bytes, bypassing decryption.
func rawObject(t *testing.T, s *Store, key string) []byte {
	t.Helper()
	obj, err := s.client.GetObject(context.Background(), s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = obj.Close() }()
	data, err := io.ReadAll(obj)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// putRaw stores bytes as they are, the way files were stored before
// encryption at rest.
func putRaw(t *testing.T, s *Store, key string, data []byte) {
	t.Helper()
	if _, err := s.client.PutObject(context.Background(), s.bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{}); err != nil {
		t.Fatal(err)
	}
}

func readAll(t *testing.T, s *Store, key string) []byte {
	t.Helper()
	rc, err := s.Get(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rc.Close() }()
	data, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// Attachment files are encrypted before they reach object storage (#358).
func TestStore_EncryptsFilesAtRest(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	plain := []byte("%PDF-1.7 private contract text")
	if err := s.Put(ctx, "v1/a.pdf", bytes.NewReader(plain), int64(len(plain)), "application/pdf"); err != nil {
		t.Fatal(err)
	}
	raw := rawObject(t, s, "v1/a.pdf")
	if bytes.Contains(raw, []byte("contract")) || !fieldcrypt.IsEncryptedBytes(raw) {
		t.Fatalf("object stored readable: %q", raw)
	}
	if got := readAll(t, s, "v1/a.pdf"); !bytes.Equal(got, plain) {
		t.Fatalf("Get = %q, want the plaintext", got)
	}

	// A file stored before encryption at rest is served as it is.
	putRaw(t, s, "v1/legacy.png", []byte("legacy bytes"))
	if got := readAll(t, s, "v1/legacy.png"); string(got) != "legacy bytes" {
		t.Fatalf("legacy Get = %q", got)
	}
}

func TestStore_EncryptExistingSealsLegacyAndRotatedFiles(t *testing.T) {
	old := fieldcrypttest.Cipher(t)
	s := newTestStoreWith(t, old)
	ctx := context.Background()
	putRaw(t, s, "v1/legacy.png", []byte("legacy bytes"))
	if err := s.Put(ctx, "v1/old-key.png", bytes.NewReader([]byte("old key bytes")), 13, "image/png"); err != nil {
		t.Fatal(err)
	}

	rotated, err := fieldcrypt.New("1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100", []string{fieldcrypttest.Key})
	if err != nil {
		t.Fatal(err)
	}
	s.crypt = rotated
	n, err := s.EncryptExisting(ctx)
	if err != nil || n != 2 {
		t.Fatalf("EncryptExisting rewrote %d (%v), want 2", n, err)
	}
	for key, want := range map[string]string{"v1/legacy.png": "legacy bytes", "v1/old-key.png": "old key bytes"} {
		if rotated.NeedsReencryptBytes(rawObject(t, s, key)) {
			t.Errorf("%s is not under the current key", key)
		}
		if got := readAll(t, s, key); string(got) != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
	if again, err := s.EncryptExisting(ctx); err != nil || again != 0 {
		t.Fatalf("second run rewrote %d (%v), want 0", again, err)
	}
}

func TestStore_ListObjects(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for _, k := range []string{"v1/a.png", "v2/b.pdf"} {
		if err := s.Put(ctx, k, bytes.NewReader([]byte("x")), 1, "application/octet-stream"); err != nil {
			t.Fatal(err)
		}
	}
	var got []string
	if err := s.ListObjects(ctx, func(key string, modified time.Time) error {
		if modified.IsZero() {
			t.Errorf("%s: no modification time", key)
		}
		got = append(got, key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	if strings.Join(got, ",") != "v1/a.png,v2/b.pdf" {
		t.Fatalf("listed %v", got)
	}
}
