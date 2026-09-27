package service

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/sync-service/internal/model"
)

type fakeObjectRemover struct {
	deleted  []string
	prefixes []string
	failKey  string
}

func (f *fakeObjectRemover) Delete(_ context.Context, key string) error {
	if key == f.failKey {
		return errors.New("storage down")
	}
	f.deleted = append(f.deleted, key)
	return nil
}

func (f *fakeObjectRemover) DeletePrefix(_ context.Context, prefix string) error {
	f.prefixes = append(f.prefixes, prefix)
	return nil
}

type fakeNoteAttachments struct {
	byNote map[string][]model.Attachment
	err    error
}

func (f *fakeNoteAttachments) ListByNote(_ context.Context, noteID string) ([]model.Attachment, error) {
	return f.byNote[noteID], f.err
}

func TestFileCleanup_NoteFilesListsTheStorageKeys(t *testing.T) {
	c := NewFileCleanup(&fakeObjectRemover{}, &fakeNoteAttachments{byNote: map[string][]model.Attachment{
		"n1": {{StoragePath: "v1/a.png"}, {StoragePath: "v1/b.pdf"}},
	}})
	if got := c.NoteFiles(context.Background(), "n1"); !reflect.DeepEqual(got, []string{"v1/a.png", "v1/b.pdf"}) {
		t.Fatalf("NoteFiles = %v", got)
	}
}

func TestFileCleanup_NoteFilesIsEmptyWhenTheLookupFails(t *testing.T) {
	c := NewFileCleanup(&fakeObjectRemover{}, &fakeNoteAttachments{err: errors.New("db down")})
	if got := c.NoteFiles(context.Background(), "n1"); len(got) != 0 {
		t.Fatalf("NoteFiles = %v, want none", got)
	}
}

func TestFileCleanup_RemoveFilesKeepsGoingAfterAFailure(t *testing.T) {
	store := &fakeObjectRemover{failKey: "v1/a.png"}
	c := NewFileCleanup(store, &fakeNoteAttachments{})
	c.RemoveFiles(context.Background(), []string{"v1/a.png", "v1/b.pdf"})
	if !reflect.DeepEqual(store.deleted, []string{"v1/b.pdf"}) {
		t.Fatalf("deleted = %v, want the second key despite the first failing", store.deleted)
	}
}

func TestFileCleanup_RemoveVaultFilesDeletesEachVaultPrefix(t *testing.T) {
	store := &fakeObjectRemover{}
	c := NewFileCleanup(store, &fakeNoteAttachments{})
	c.RemoveVaultFiles(context.Background(), "v1", "v2")
	if !reflect.DeepEqual(store.prefixes, []string{"v1/", "v2/"}) {
		t.Fatalf("prefixes = %v, want [v1/ v2/]", store.prefixes)
	}
}

// An empty vault id would become the prefix "/" (or "") and could match every
// object in the bucket; it must never reach the store.
func TestFileCleanup_RemoveVaultFilesSkipsEmptyAndSlashyIDs(t *testing.T) {
	store := &fakeObjectRemover{}
	c := NewFileCleanup(store, &fakeNoteAttachments{})
	c.RemoveVaultFiles(context.Background(), "", "  ", "a/b", "v1")
	if !reflect.DeepEqual(store.prefixes, []string{"v1/"}) {
		t.Fatalf("prefixes = %v, want only [v1/]", store.prefixes)
	}
}

func TestFileCleanup_NilIsANoOp(t *testing.T) {
	var c *FileCleanup // attachments disabled: no object store configured
	if got := c.NoteFiles(context.Background(), "n1"); got != nil {
		t.Fatalf("NoteFiles on nil = %v", got)
	}
	c.RemoveFiles(context.Background(), []string{"k"})
	c.RemoveVaultFiles(context.Background(), "v1")
}
