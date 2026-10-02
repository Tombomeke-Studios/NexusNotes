package search

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

const (
	// queueSize bounds how many index updates may wait; beyond it updates are
	// dropped with a warning (the index is derived data, never the only copy).
	queueSize = 1024
	// maxAttempts is how often one update is tried before it is given up.
	maxAttempts = 4
)

// job is one queued index update.
type job struct {
	name string
	run  func(ctx context.Context) error
}

// statusError is a non-2xx answer from Meilisearch.
type statusError struct{ code int }

func (e statusError) Error() string { return fmt.Sprintf("meilisearch responded %d", e.code) }

// retryable reports whether trying again may help: not for a request
// Meilisearch rejected as invalid (4xx other than 408/429).
func retryable(err error) bool {
	var se statusError
	if errors.As(err, &se) {
		return se.code >= 500 || se.code == http.StatusRequestTimeout || se.code == http.StatusTooManyRequests
	}
	return true
}

func defaultRetryDelay(attempt int) time.Duration {
	return time.Duration(1<<attempt) * 250 * time.Millisecond // 0.5s, 1s, 2s
}

// enqueue hands an update to the single worker (#401). It never blocks a save:
// a full queue or a closed indexer drops the update with a warning.
func (idx *Indexer) enqueue(name string, run func(ctx context.Context) error) {
	idx.startOnce.Do(idx.start)
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.closed {
		slog.Warn("search: indexer closed; update dropped", "job", name)
		return
	}
	select {
	case idx.jobs <- job{name: name, run: run}:
	default:
		slog.Warn("search: index queue full; update dropped", "job", name)
	}
}

func (idx *Indexer) start() {
	idx.jobs = make(chan job, queueSize)
	idx.done = make(chan struct{})
	if idx.retryDelay == nil {
		idx.retryDelay = defaultRetryDelay
	}
	go idx.work()
}

// work runs queued updates one at a time, in order, retrying failures.
func (idx *Indexer) work() {
	defer close(idx.done)
	for j := range idx.jobs {
		var err error
		for attempt := 1; attempt <= maxAttempts; attempt++ {
			err = j.run(context.Background())
			if err == nil || !retryable(err) {
				break
			}
			if attempt < maxAttempts {
				time.Sleep(idx.retryDelay(attempt))
			}
		}
		if err != nil {
			slog.Warn("search: index update failed", "job", j.name, "error", err)
		}
	}
}

// Close stops accepting updates and waits until the queued ones are done, or
// ctx ends (it then returns ctx's error and the rest is abandoned).
func (idx *Indexer) Close(ctx context.Context) error {
	idx.startOnce.Do(idx.start)
	idx.mu.Lock()
	if !idx.closed {
		idx.closed = true
		close(idx.jobs)
	}
	idx.mu.Unlock()
	select {
	case <-idx.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
