package search

import (
	"context"
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

	if err := idx.upsertDoc(context.Background(), doc); err != nil {
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
	err := idx.upsertDoc(context.Background(), NoteDoc{ID: "x"})
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
	if err := idx.deleteDoc(context.Background(), "note-42"); err != nil {
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
	err := idx.deleteDoc(context.Background(), "missing")
	if err == nil {
		t.Fatal("expected error for 404 response")
	}
}

func TestIndexer_DocumentCount(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/indexes/notes/stats" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"numberOfDocuments":42,"isIndexing":false}`))
	}))
	defer srv.Close()
	n, err := newTestIndexer(srv.URL).DocumentCount(context.Background())
	if err != nil || n != 42 {
		t.Fatalf("DocumentCount = %d, %v; want 42", n, err)
	}

	missing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"code":"index_not_found"}`))
	}))
	defer missing.Close()
	if n, err := newTestIndexer(missing.URL).DocumentCount(context.Background()); err != nil || n != 0 {
		t.Fatalf("missing index: %d, %v; want 0, nil", n, err)
	}

	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer down.Close()
	if _, err := newTestIndexer(down.URL).DocumentCount(context.Background()); err == nil {
		t.Fatal("a failing Meilisearch must be an error, not an empty index")
	}
}

func TestIndexer_IndexDocsSendsOneBatch(t *testing.T) {
	var calls int
	var received []NoteDoc
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()
	docs := []NoteDoc{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	if err := newTestIndexer(srv.URL).IndexDocs(context.Background(), docs); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || len(received) != 3 {
		t.Fatalf("calls = %d, docs = %d; want one request with 3 docs", calls, len(received))
	}
	if err := newTestIndexer(srv.URL).IndexDocs(context.Background(), nil); err != nil || calls != 1 {
		t.Fatalf("an empty batch must not call Meilisearch (calls = %d, %v)", calls, err)
	}
}
