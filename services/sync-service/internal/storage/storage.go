// Package storage wraps S3-compatible object storage (MinIO) for note
// attachments (#153). When not configured it returns a disabled store so the
// rest of the service runs without object storage in dev/test.
//
// Files are encrypted at rest (#358) with the server data key before they are
// written, bound to their object key, and decrypted when read; a file stored
// before that is served as it is until EncryptExisting has sealed it.
package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/fieldcrypt"
)

type Config struct {
	Endpoint  string // host:port, no scheme
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

// Store persists attachment bytes in object storage.
type Store struct {
	client *minio.Client
	bucket string
	crypt  *fieldcrypt.Cipher
}

// field binds a file's ciphertext to its object key, so stored objects
// cannot be swapped for one another.
func field(key string) string {
	return "attachments/" + key
}

// New connects to MinIO and ensures the bucket exists. Returns (nil, nil) when
// no endpoint is configured — callers treat a nil store as "attachments off".
func New(ctx context.Context, cfg Config, crypt *fieldcrypt.Cipher) (*Store, error) {
	if cfg.Endpoint == "" {
		return nil, nil
	}
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("connect object storage: %w", err)
	}
	exists, err := client.BucketExists(ctx, cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("check bucket: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("create bucket: %w", err)
		}
	}
	return &Store{client: client, bucket: cfg.Bucket, crypt: crypt}, nil
}

// Put encrypts and stores an object; the caller owns the key. size is the
// plaintext size the caller expects r to deliver (uploads are capped well
// below what fits in memory).
func (s *Store) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	plain, err := io.ReadAll(io.LimitReader(r, size+1))
	if err != nil {
		return fmt.Errorf("read upload: %w", err)
	}
	if int64(len(plain)) != size {
		return fmt.Errorf("put object: got %d bytes, want %d", len(plain), size)
	}
	return s.putSealed(ctx, key, plain, contentType)
}

func (s *Store) putSealed(ctx context.Context, key string, plain []byte, contentType string) error {
	sealed, err := s.crypt.EncryptBytes(field(key), plain)
	if err != nil {
		return fmt.Errorf("encrypt object: %w", err)
	}
	_, err = s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(sealed), int64(len(sealed)), minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return fmt.Errorf("put object: %w", err)
	}
	return nil
}

// Get reads and decrypts an object. The caller must Close the returned reader.
func (s *Store) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	raw, _, err := s.getRaw(ctx, key)
	if err != nil {
		return nil, err
	}
	plain, err := s.crypt.DecryptBytes(field(key), raw)
	if err != nil {
		return nil, fmt.Errorf("decrypt object %s: %w", key, err)
	}
	return io.NopCloser(bytes.NewReader(plain)), nil
}

func (s *Store) getRaw(ctx context.Context, key string) ([]byte, minio.ObjectInfo, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, minio.ObjectInfo{}, fmt.Errorf("get object: %w", err)
	}
	defer func() { _ = obj.Close() }()
	info, err := obj.Stat()
	if err != nil {
		return nil, minio.ObjectInfo{}, fmt.Errorf("stat object: %w", err)
	}
	raw, err := io.ReadAll(obj)
	if err != nil {
		return nil, minio.ObjectInfo{}, fmt.Errorf("read object: %w", err)
	}
	return raw, info, nil
}

// EncryptExisting seals every object that is not yet encrypted under the
// current key: files stored before encryption at rest, or under a retired
// key after a rotation. Safe to run again; returns how many it rewrote.
// An object that changed or vanished while it was being read is skipped.
func (s *Store) EncryptExisting(ctx context.Context) (int, error) {
	rewritten := 0
	for listed := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{Recursive: true}) {
		if listed.Err != nil {
			return rewritten, fmt.Errorf("list objects: %w", listed.Err)
		}
		raw, info, err := s.getRaw(ctx, listed.Key)
		if err != nil {
			slog.Warn("attachment encryption: cannot read object; left as is", "key", listed.Key, "error", err)
			continue
		}
		if !s.crypt.NeedsReencryptBytes(raw) {
			continue
		}
		plain, err := s.crypt.DecryptBytes(field(listed.Key), raw)
		if err != nil {
			slog.Warn("attachment encryption: cannot decrypt object; left as is", "key", listed.Key, "error", err)
			continue
		}
		// Do not resurrect or overwrite an object deleted or replaced meanwhile.
		now, err := s.client.StatObject(ctx, s.bucket, listed.Key, minio.StatObjectOptions{})
		if err != nil || now.ETag != info.ETag {
			continue
		}
		if err := s.putSealed(ctx, listed.Key, plain, info.ContentType); err != nil {
			return rewritten, err
		}
		rewritten++
	}
	return rewritten, nil
}

// DeletePrefix removes every object whose key starts with prefix. An empty
// prefix is refused: it would match the whole bucket.
func (s *Store) DeletePrefix(ctx context.Context, prefix string) error {
	if prefix == "" {
		return fmt.Errorf("delete prefix: refusing an empty prefix")
	}
	// Listing errors arrive as entries with Err set; keep them out of the
	// removal stream (they carry no key) and report the first one.
	listed := s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true})
	toRemove := make(chan minio.ObjectInfo)
	var listErr error
	go func() {
		defer close(toRemove)
		for obj := range listed {
			if obj.Err != nil {
				if listErr == nil {
					listErr = obj.Err
				}
				continue
			}
			toRemove <- obj
		}
	}()
	// Drain every result, even after a failure: stopping early would leave
	// minio-go's forwarding goroutine blocked on a send.
	var removeErr error
	for rerr := range s.client.RemoveObjects(ctx, s.bucket, toRemove, minio.RemoveObjectsOptions{}) {
		if rerr.Err != nil && removeErr == nil {
			removeErr = fmt.Errorf("delete object %s: %w", rerr.ObjectName, rerr.Err)
		}
	}
	// toRemove was closed before RemoveObjects finished, so listErr is settled.
	if listErr != nil {
		return fmt.Errorf("list objects under %s: %w", prefix, listErr)
	}
	return removeErr
}

// Delete removes an object; a missing key is not an error.
func (s *Store) Delete(ctx context.Context, key string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}

// ListObjects calls fn with the key and last-modified time of every object,
// stopping at the first error fn returns (used by the orphan sweep, #316).
func (s *Store) ListObjects(ctx context.Context, fn func(key string, modified time.Time) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel() // stops minio-go's listing goroutine if fn bails out early
	for obj := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{Recursive: true}) {
		if obj.Err != nil {
			return fmt.Errorf("list objects: %w", obj.Err)
		}
		if err := fn(obj.Key, obj.LastModified); err != nil {
			return err
		}
	}
	return nil
}
