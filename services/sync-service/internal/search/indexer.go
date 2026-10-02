package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const indexName = "notes"

// NoteDoc is the document shape sent to Meilisearch.
type NoteDoc struct {
	ID             string   `json:"id"`
	VaultID        string   `json:"vault_id"`
	Title          string   `json:"title"`
	Content        string   `json:"content"`
	Tags           []string `json:"tags"`
	Aliases        []string `json:"aliases,omitempty"`
	Path           string   `json:"path"`
	UpdatedAt      string   `json:"updated_at"`
	BacklinkTitles []string `json:"backlink_titles,omitempty"`
}

// Indexer sends note documents to Meilisearch over its REST API.
// IndexNote/DeleteNote/DeleteVaultNotes return immediately: the HTTP calls run
// on one worker behind a bounded queue, with retries (#401), so note-save
// latency is never increased. Close drains the queue on shutdown.
type Indexer struct {
	baseURL    string
	masterKey  string
	httpClient *http.Client

	startOnce  sync.Once
	mu         sync.Mutex
	closed     bool
	jobs       chan job
	done       chan struct{}
	retryDelay func(attempt int) time.Duration
}

func NewIndexer(meiliURL, masterKey string) *Indexer {
	return &Indexer{
		baseURL:   meiliURL,
		masterKey: masterKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// IndexNote enqueues an upsert for the given note document.
// Errors are logged to stderr; they do not propagate to callers.
func (idx *Indexer) IndexNote(doc NoteDoc) {
	idx.enqueue("index note "+doc.ID, func(ctx context.Context) error { return idx.upsertDoc(ctx, doc) })
}

// DeleteNote enqueues a deletion for the given note ID.
func (idx *Indexer) DeleteNote(noteID string) {
	idx.enqueue("delete note "+noteID, func(ctx context.Context) error { return idx.deleteDoc(ctx, noteID) })
}

// DeleteVaultNotes enqueues deletion of every indexed note belonging to the
// given vaults (used when an account or vault is erased).
func (idx *Indexer) DeleteVaultNotes(vaultIDs []string) {
	idx.enqueue(fmt.Sprintf("delete vault notes %v", vaultIDs), func(ctx context.Context) error {
		return idx.deleteByVaults(ctx, vaultIDs)
	})
}

func (idx *Indexer) deleteByVaults(ctx context.Context, vaultIDs []string) error {
	ids, err := json.Marshal(vaultIDs)
	if err != nil {
		return fmt.Errorf("marshal vault ids: %w", err)
	}
	body, err := json.Marshal(map[string]string{
		"filter": fmt.Sprintf("vault_id IN %s", ids),
	})
	if err != nil {
		return fmt.Errorf("marshal filter: %w", err)
	}

	url := fmt.Sprintf("%s/indexes/%s/documents/delete", idx.baseURL, indexName)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if idx.masterKey != "" {
		req.Header.Set("Authorization", "Bearer "+idx.masterKey)
	}

	resp, err := idx.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 300 {
		return statusError{resp.StatusCode}
	}
	return nil
}

// IndexDocs upserts a batch of documents in one request and waits for
// Meilisearch to accept it (used to rebuild the index, #365).
func (idx *Indexer) IndexDocs(ctx context.Context, docs []NoteDoc) error {
	if len(docs) == 0 {
		return nil
	}
	return idx.upsertDocs(ctx, docs)
}

// DocumentCount returns how many documents the notes index holds; a missing
// index counts as empty.
func (idx *Indexer) DocumentCount(ctx context.Context) (int, error) {
	url := fmt.Sprintf("%s/indexes/%s/stats", idx.baseURL, indexName)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, fmt.Errorf("build request: %w", err)
	}
	if idx.masterKey != "" {
		req.Header.Set("Authorization", "Bearer "+idx.masterKey)
	}
	resp, err := idx.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound {
		return 0, nil
	}
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("meilisearch responded %d", resp.StatusCode)
	}
	var stats struct {
		NumberOfDocuments int `json:"numberOfDocuments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return 0, fmt.Errorf("decode stats: %w", err)
	}
	return stats.NumberOfDocuments, nil
}

func (idx *Indexer) upsertDoc(ctx context.Context, doc NoteDoc) error {
	return idx.upsertDocs(ctx, []NoteDoc{doc})
}

func (idx *Indexer) upsertDocs(ctx context.Context, docs []NoteDoc) error {
	body, err := json.Marshal(docs)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	url := fmt.Sprintf("%s/indexes/%s/documents", idx.baseURL, indexName)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if idx.masterKey != "" {
		req.Header.Set("Authorization", "Bearer "+idx.masterKey)
	}

	resp, err := idx.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 300 {
		return statusError{resp.StatusCode}
	}
	return nil
}

func (idx *Indexer) deleteDoc(ctx context.Context, noteID string) error {
	url := fmt.Sprintf("%s/indexes/%s/documents/%s", idx.baseURL, indexName, noteID)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	if idx.masterKey != "" {
		req.Header.Set("Authorization", "Bearer "+idx.masterKey)
	}

	resp, err := idx.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 300 {
		return statusError{resp.StatusCode}
	}
	return nil
}
