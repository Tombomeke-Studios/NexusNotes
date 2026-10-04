// Package nexus is a small client for the NexusNotes sync service REST API,
// used by the MCP server with the user's MCP token (#221).
package nexus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Vault is a vault as the API returns it.
type Vault struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Encryption string `json:"encryption"`
	Role       string `json:"role,omitempty"`
}

// E2EE reports whether the vault's notes are end-to-end encrypted.
func (v Vault) E2EE() bool { return v.Encryption == "e2ee" }

// Note is a note as the API returns it. Path is the note's folder; Title is
// its name within that folder.
type Note struct {
	ID        string    `json:"id"`
	VaultID   string    `json:"vault_id"`
	Path      string    `json:"path"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Checksum  string    `json:"checksum"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SearchResult is one hit of the vault search.
type SearchResult struct {
	ID        string    `json:"id"`
	Path      string    `json:"path"`
	Title     string    `json:"title"`
	Snippet   string    `json:"snippet"`
	Tags      []string  `json:"tags"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Backlink is a note linking to another one.
type Backlink struct {
	ID        string    `json:"id"`
	Path      string    `json:"path"`
	Title     string    `json:"title"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TagCount is a tag and how many notes carry it.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// APIError is a non-2xx answer from the sync service.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("sync service answered %d", e.Status)
	}
	return fmt.Sprintf("sync service answered %d: %s", e.Status, e.Message)
}

// IsStatus reports whether err is an APIError with this status.
func IsStatus(err error, status int) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Status == status
}

// Client calls the sync service as the token's owner.
type Client struct {
	base  string
	token string
	http  *http.Client
}

func NewClient(baseURL, token string) *Client {
	return &Client{base: baseURL, token: token, http: &http.Client{Timeout: 30 * time.Second}}
}

// deviceID identifies writes made through MCP in note versions.
const deviceID = "mcp"

func (c *Client) do(ctx context.Context, tool, method, path string, body, out any) (http.Header, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	// Names the tool in the sync service's audit log.
	req.Header.Set("X-MCP-Tool", tool)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sync service unreachable: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &e)
		return resp.Header, &APIError{Status: resp.StatusCode, Message: e.Error}
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return resp.Header, fmt.Errorf("decode response: %w", err)
		}
	}
	return resp.Header, nil
}

func (c *Client) Vaults(ctx context.Context, tool string) ([]Vault, error) {
	var out []Vault
	_, err := c.do(ctx, tool, http.MethodGet, "/api/vaults", nil, &out)
	return out, err
}

func (c *Client) Vault(ctx context.Context, tool, id string) (*Vault, error) {
	var out Vault
	if _, err := c.do(ctx, tool, http.MethodGet, "/api/vaults/"+url.PathEscape(id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// NotesPage returns up to limit notes of the vault in path order after the
// cursor ("" = from the start) and the next cursor ("" = last page).
func (c *Client) NotesPage(ctx context.Context, tool, vaultID string, limit int, after string) ([]Note, string, error) {
	q := url.Values{"limit": {strconv.Itoa(limit)}}
	if after != "" {
		q.Set("after", after)
	}
	var out []Note
	h, err := c.do(ctx, tool, http.MethodGet, "/api/vaults/"+url.PathEscape(vaultID)+"/notes?"+q.Encode(), nil, &out)
	if err != nil {
		return nil, "", err
	}
	return out, h.Get("X-Next-Cursor"), nil
}

// AllNotes walks every page of the vault's notes.
func (c *Client) AllNotes(ctx context.Context, tool, vaultID string) ([]Note, error) {
	var all []Note
	after := ""
	for {
		page, next, err := c.NotesPage(ctx, tool, vaultID, 1000, after)
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		if next == "" {
			return all, nil
		}
		after = next
	}
}

func (c *Client) Note(ctx context.Context, tool, id string) (*Note, error) {
	var out Note
	if _, err := c.do(ctx, tool, http.MethodGet, "/api/notes/"+url.PathEscape(id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Search(ctx context.Context, tool, vaultID, query string) ([]SearchResult, error) {
	var out []SearchResult
	_, err := c.do(ctx, tool, http.MethodGet, "/api/vaults/"+url.PathEscape(vaultID)+"/search?q="+url.QueryEscape(query), nil, &out)
	return out, err
}

func (c *Client) Backlinks(ctx context.Context, tool, noteID string) ([]Backlink, error) {
	var out []Backlink
	_, err := c.do(ctx, tool, http.MethodGet, "/api/notes/"+url.PathEscape(noteID)+"/backlinks", nil, &out)
	return out, err
}

func (c *Client) Tags(ctx context.Context, tool, vaultID string) ([]TagCount, error) {
	var out []TagCount
	_, err := c.do(ctx, tool, http.MethodGet, "/api/vaults/"+url.PathEscape(vaultID)+"/tags", nil, &out)
	return out, err
}

func (c *Client) CreateNote(ctx context.Context, tool, vaultID, title, folder, content string) (*Note, error) {
	body := map[string]string{"title": title, "path": folder, "content": content, "device_id": deviceID}
	var out Note
	if _, err := c.do(ctx, tool, http.MethodPost, "/api/vaults/"+url.PathEscape(vaultID)+"/notes", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// UpdateNote saves new content over prevChecksum; a stale checksum is a 409.
func (c *Client) UpdateNote(ctx context.Context, tool string, n *Note, content string) (*Note, error) {
	body := map[string]string{
		"title": n.Title, "path": n.Path, "content": content,
		"prev_checksum": n.Checksum, "device_id": deviceID,
	}
	var out Note
	if _, err := c.do(ctx, tool, http.MethodPut, "/api/notes/"+url.PathEscape(n.ID), body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteNote(ctx context.Context, tool, vaultID, noteID string) error {
	_, err := c.do(ctx, tool, http.MethodDelete, "/api/vaults/"+url.PathEscape(vaultID)+"/notes/"+url.PathEscape(noteID), nil, nil)
	return err
}
