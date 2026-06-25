package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type indexSettings struct {
	SearchableAttributes []string            `json:"searchableAttributes"`
	FilterableAttributes []string            `json:"filterableAttributes"`
	SortableAttributes   []string            `json:"sortableAttributes"`
	RankingRules         []string            `json:"rankingRules"`
	TypoTolerance        typoToleranceConfig `json:"typoTolerance"`
}

type typoToleranceConfig struct {
	Enabled          bool                 `json:"enabled"`
	MinWordSizeForTypos minWordSizeConfig  `json:"minWordSizeForTypos"`
}

type minWordSizeConfig struct {
	OneTypo  int `json:"oneTypo"`
	TwoTypos int `json:"twoTypos"`
}

// ConfigureIndex pushes index settings to Meilisearch. It is called once at
// startup and is idempotent — re-running it is safe.
func (idx *Indexer) ConfigureIndex(ctx context.Context) error {
	settings := indexSettings{
		SearchableAttributes: []string{"title", "content", "tags", "path"},
		FilterableAttributes: []string{"vault_id", "tags", "updated_at"},
		SortableAttributes:   []string{"updated_at"},
		RankingRules:         []string{"words", "typo", "proximity", "attribute", "sort", "exactness"},
		TypoTolerance: typoToleranceConfig{
			Enabled: true,
			MinWordSizeForTypos: minWordSizeConfig{
				OneTypo:  4,
				TwoTypos: 8,
			},
		},
	}

	body, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}

	url := fmt.Sprintf("%s/indexes/%s/settings", idx.baseURL, indexName)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(body))
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
