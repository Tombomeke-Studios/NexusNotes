package storage

import (
	"bytes"
	"context"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

// newTestStore connects to the MinIO at MINIO_TEST_ENDPOINT with a throwaway
// bucket that is removed afterwards. Skipped when no test MinIO is configured.
func newTestStore(t *testing.T) *Store {
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
	})
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
