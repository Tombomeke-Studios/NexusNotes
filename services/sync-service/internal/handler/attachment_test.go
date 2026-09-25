package handler

import (
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/storage"
)

// fakeNotes resolves every note to one vault, standing in for the database.
type fakeNotes struct{}

func (fakeNotes) GetNote(_ context.Context, noteID string) (*model.Note, error) {
	return &model.Note{ID: noteID, VaultID: "vault-1"}, nil
}

// fakeRoles grants the same role on every vault.
type fakeRoles struct{ role string }

func (f fakeRoles) AccessRole(context.Context, string, string) (string, error) {
	return f.role, nil
}

// newUploadTestHandler builds a handler whose note lookup and write check pass
// without a database. The object store is never reached on the paths tested
// here, so an unconnected one is enough to count as "configured".
func newUploadTestHandler() *AttachmentHandler {
	return &AttachmentHandler{
		store:       &storage.Store{},
		syncService: fakeNotes{},
		vaultRepo:   fakeRoles{role: model.VaultRoleOwner},
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

// countingReader records how many bytes the handler actually pulled.
type countingReader struct {
	r io.Reader
	n atomic.Int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n.Add(int64(n))
	return n, err
}

// uploadRequest streams a multipart body whose single part (named field) holds
// size zero bytes, without ever holding the body in memory.
func uploadRequest(t *testing.T, field string, size int64) (*http.Request, *countingReader) {
	t.Helper()
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		part, err := mw.CreateFormFile(field, "big.bin")
		if err == nil {
			_, err = io.CopyN(part, zeros{}, size)
		}
		if err == nil {
			err = mw.Close()
		}
		_ = pw.CloseWithError(err)
	}()
	body := &countingReader{r: pr}
	req := httptest.NewRequest(http.MethodPost, "/api/notes/note-1/attachments", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.SetPathValue("noteId", "note-1")
	t.Cleanup(func() {
		_ = pr.Close() // unblocks the writer if the handler stopped reading
		if req.MultipartForm != nil {
			_ = req.MultipartForm.RemoveAll()
		}
	})
	return req, body
}

func TestUpload_OversizedBodyIsCutOffWith413(t *testing.T) {
	req, body := uploadRequest(t, "file", maxAttachmentBytes+8<<20)
	rec := httptest.NewRecorder()

	newUploadTestHandler().Upload(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body: %s)", rec.Code, rec.Body.String())
	}
	// The cap must stop the read, not merely reject after reading everything.
	if limit := int64(maxAttachmentBytes + 1<<20 + 1); body.n.Load() > limit {
		t.Errorf("read %d bytes of the body, want at most %d", body.n.Load(), limit)
	}
}

func TestUpload_FileJustOverTheLimitIs413(t *testing.T) {
	// Fits within the multipart framing allowance, so it is the per-file size
	// check rather than the body cap that has to catch it.
	req, _ := uploadRequest(t, "file", maxAttachmentBytes+1)
	rec := httptest.NewRecorder()

	newUploadTestHandler().Upload(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestUpload_BodyUnderTheCapIsParsedNormally(t *testing.T) {
	// Control: a small body is parsed, and the missing "file" field is what fails.
	req, _ := uploadRequest(t, "not-file", 1024)
	rec := httptest.NewRecorder()

	newUploadTestHandler().Upload(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body: %s)", rec.Code, rec.Body.String())
	}
}
