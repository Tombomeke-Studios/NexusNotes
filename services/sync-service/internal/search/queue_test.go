package search

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func quickIndexer(url string) *Indexer {
	idx := NewIndexer(url, "k")
	idx.retryDelay = func(int) time.Duration { return time.Millisecond }
	return idx
}

// A failed index call is retried instead of lost (#401).
func TestQueue_RetriesTransientFailures(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()
	idx := quickIndexer(srv.URL)

	idx.IndexNote(NoteDoc{ID: "n1"})
	if err := idx.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := calls.Load(); n != 3 {
		t.Fatalf("%d calls, want 2 failures then a success", n)
	}
}

// A request Meilisearch rejects as invalid is not retried.
func TestQueue_DoesNotRetryClientErrors(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	idx := quickIndexer(srv.URL)
	idx.DeleteNote("n1")
	_ = idx.Close(context.Background())
	if n := calls.Load(); n != 1 {
		t.Fatalf("%d calls for a 400, want 1", n)
	}
}

// Close waits for everything already queued, in order (#401).
func TestQueue_CloseDrainsInOrder(t *testing.T) {
	var mu sync.Mutex
	var order []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Millisecond)
		mu.Lock()
		order = append(order, r.Method)
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()
	idx := quickIndexer(srv.URL)
	for i := 0; i < 5; i++ {
		idx.IndexNote(NoteDoc{ID: "n"})
	}
	idx.DeleteNote("n")
	if err := idx.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(order) != 6 || order[5] != http.MethodDelete {
		t.Fatalf("handled %v, want 5 upserts then the delete", order)
	}
	idx.IndexNote(NoteDoc{ID: "late"}) // after Close: dropped, must not panic
}

// Close gives up at the deadline rather than hang on an unreachable server.
func TestQueue_CloseRespectsTheDeadline(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	idx := quickIndexer(srv.URL)
	idx.IndexNote(NoteDoc{ID: "n"})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := idx.Close(ctx); err == nil {
		t.Fatal("Close must report that it hit the deadline")
	}
}
