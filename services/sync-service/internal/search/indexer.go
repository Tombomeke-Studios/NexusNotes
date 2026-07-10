package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
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
// All methods return immediately; the actual HTTP call happens in a goroutine
// so note-save latency is never increased.
type Indexer struct {
	baseURL    string
	masterKey  string
	httpClient *http.Client
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
	go func() {
		if err := idx.upsertDoc(context.Background(), doc); err != nil {
			fmt.Printf("search: index note %s: %v\n", doc.ID, err)
		}
	}()
}

// DeleteNote enqueues a deletion for the given note ID.
func (idx *Indexer) DeleteNote(noteID string) {
	go func() {
		if err := idx.deleteDoc(context.Background(), noteID); err != nil {
			fmt.Printf("search: delete note %s: %v\n", noteID, err)
		}
	}()
}

// DeleteVaultNotes enqueues deletion of every indexed note belonging to the
// given vaults (used when an account or vault is erased).
func (idx *Indexer) DeleteVaultNotes(vaultIDs []string) {
	go func() {
		if err := idx.deleteByVaults(context.Background(), vaultIDs); err != nil {
			fmt.Printf("search: delete vault notes %v: %v\n", vaultIDs, err)
		}
	}()
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
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("meilisearch responded %d", resp.StatusCode)
	}
	return nil
}

func (idx *Indexer) upsertDoc(ctx context.Context, doc NoteDoc) error {
	body, err := json.Marshal([]NoteDoc{doc})
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
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("meilisearch responded %d", resp.StatusCode)
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
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("meilisearch responded %d", resp.StatusCode)
	}
	return nil
}
