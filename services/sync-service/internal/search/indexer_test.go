package search

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestIndexer(serverURL string) *Indexer {
	return &Indexer{
		baseURL:    serverURL,
		masterKey:  "test-key",
		httpClient: &http.Client{},
	}
}

func TestIndexer_upsertDoc_success(t *testing.T) {
	var received []NoteDoc
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing auth header")
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"taskUid":1}`))
	}))
	defer srv.Close()

	idx := newTestIndexer(srv.URL)
	doc := NoteDoc{ID: "note-1", VaultID: "vault-1", Title: "Hello", Content: "world"}

	if err := idx.upsertDoc(t.Context(), doc); err != nil {
		t.Fatalf("upsertDoc: %v", err)
	}
	if len(received) != 1 || received[0].ID != "note-1" {
		t.Errorf("unexpected received docs: %v", received)
	}
}

func TestIndexer_upsertDoc_serverError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	idx := newTestIndexer(srv.URL)
	err := idx.upsertDoc(t.Context(), NoteDoc{ID: "x"})
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestIndexer_deleteDoc_success(t *testing.T) {
	var deletedID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		// URL: /indexes/notes/documents/<id>
		deletedID = r.URL.Path[len("/indexes/notes/documents/"):]
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"taskUid":2}`))
	}))
	defer srv.Close()

	idx := newTestIndexer(srv.URL)
	if err := idx.deleteDoc(t.Context(), "note-42"); err != nil {
		t.Fatalf("deleteDoc: %v", err)
	}
	if deletedID != "note-42" {
		t.Errorf("expected note-42 deleted, got %q", deletedID)
	}
}

func TestIndexer_deleteDoc_serverError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	idx := newTestIndexer(srv.URL)
	err := idx.deleteDoc(t.Context(), "missing")
	if err == nil {
		t.Fatal("expected error for 404 response")
	}
}
