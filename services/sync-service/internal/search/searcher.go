package search

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// SearchParams holds the validated query parameters for a search request.
type SearchParams struct {
	Query    string
	VaultID  string
	Tag      string
	DateFrom string
	DateTo   string
	Limit    int
	Offset   int
}

// Hit is a single search result returned to callers.
type Hit struct {
	ID        string   `json:"id"`
	VaultID   string   `json:"vault_id"`
	Title     string   `json:"title"`
	Path      string   `json:"path"`
	Tags      []string `json:"tags"`
	UpdatedAt string   `json:"updated_at"`
	Snippet   string   `json:"snippet,omitempty"`
}

type meiliSearchRequest struct {
	Q                  string   `json:"q"`
	Filter             string   `json:"filter,omitempty"`
	Limit              int      `json:"limit"`
	Offset             int      `json:"offset"`
	AttributesToHighlight []string `json:"attributesToHighlight"`
	CropLength         int      `json:"cropLength"`
	AttributesToCrop   []string `json:"attributesToCrop"`
}

type meiliSearchResponse struct {
	Hits []meiliHit `json:"hits"`
}

type meiliHit struct {
	ID        string                 `json:"id"`
	VaultID   string                 `json:"vault_id"`
	Title     string                 `json:"title"`
	Path      string                 `json:"path"`
	Tags      []string               `json:"tags"`
	UpdatedAt string                 `json:"updated_at"`
	Formatted map[string]interface{} `json:"_formatted"`
}

// Search executes a full-text search query against the notes index.
func (idx *Indexer) Search(ctx context.Context, p SearchParams) ([]Hit, error) {
	if p.Limit <= 0 {
		p.Limit = 20
	}

	filter := buildFilter(p)

	reqBody := meiliSearchRequest{
		Q:                     p.Query,
		Filter:                filter,
		Limit:                 p.Limit,
		Offset:                p.Offset,
		AttributesToHighlight: []string{"content"},
		CropLength:            120,
		AttributesToCrop:      []string{"content"},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal search request: %w", err)
	}

	searchURL := fmt.Sprintf("%s/indexes/%s/search", idx.baseURL, indexName)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, searchURL, strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if idx.masterKey != "" {
		req.Header.Set("Authorization", "Bearer "+idx.masterKey)
	}

	resp, err := idx.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("meilisearch responded %d", resp.StatusCode)
	}

	var result meiliSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	hits := make([]Hit, 0, len(result.Hits))
	for _, h := range result.Hits {
		hit := Hit{
			ID:        h.ID,
			VaultID:   h.VaultID,
			Title:     h.Title,
			Path:      h.Path,
			Tags:      h.Tags,
			UpdatedAt: h.UpdatedAt,
		}
		// Extract snippet from highlighted content
		if h.Formatted != nil {
			if content, ok := h.Formatted["content"]; ok {
				if s, ok := content.(string); ok {
					hit.Snippet = s
				}
			}
		}
		hits = append(hits, hit)
	}
	return hits, nil
}

func buildFilter(p SearchParams) string {
	var parts []string

	if p.VaultID != "" {
		parts = append(parts, fmt.Sprintf(`vault_id = "%s"`, p.VaultID))
	}
	if p.Tag != "" {
		parts = append(parts, fmt.Sprintf(`tags = "%s"`, p.Tag))
	}
	if p.DateFrom != "" {
		parts = append(parts, fmt.Sprintf(`updated_at >= "%s"`, p.DateFrom))
	}
	if p.DateTo != "" {
		parts = append(parts, fmt.Sprintf(`updated_at <= "%s"`, p.DateTo))
	}

	return strings.Join(parts, " AND ")
}
