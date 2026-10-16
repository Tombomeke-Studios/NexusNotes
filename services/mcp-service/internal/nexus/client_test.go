package nexus

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// recorded is one request the stub received.
type recorded struct {
	method, path, query string
	auth, tool, ctype   string
	body                map[string]string
}

// stub answers every request with the reply registered for "METHOD path",
// recording what it received.
type stub struct {
	t       *testing.T
	seen    []recorded
	replies map[string]func(w http.ResponseWriter, r *http.Request)
}

func (s *stub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rec := recorded{
		method: r.Method, path: r.URL.EscapedPath(), query: r.URL.RawQuery,
		auth: r.Header.Get("Authorization"), tool: r.Header.Get("X-MCP-Tool"), ctype: r.Header.Get("Content-Type"),
	}
	if b, _ := io.ReadAll(r.Body); len(b) > 0 {
		if err := json.Unmarshal(b, &rec.body); err != nil {
			s.t.Errorf("request body is not a JSON object: %s", b)
		}
	}
	s.seen = append(s.seen, rec)
	reply, ok := s.replies[r.Method+" "+r.URL.Path]
	if !ok {
		s.t.Errorf("unexpected request %s %s", r.Method, r.URL)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	reply(w, r)
}

func jsonReply(status int, v any) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
}

func newStub(t *testing.T, replies map[string]func(http.ResponseWriter, *http.Request)) (*stub, *Client) {
	t.Helper()
	s := &stub{t: t, replies: replies}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	return s, NewClient(srv.URL, "nn_secret")
}

var ctx = context.Background()

func TestClient_SendsTokenAndToolName(t *testing.T) {
	s, c := newStub(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /api/vaults": jsonReply(200, []Vault{{ID: "v1", Name: "Work", Encryption: "e2ee"}}),
	})
	vaults, err := c.Vaults(ctx, "list_vaults")
	if err != nil {
		t.Fatal(err)
	}
	if len(vaults) != 1 || vaults[0].ID != "v1" || !vaults[0].E2EE() {
		t.Fatalf("vaults = %+v", vaults)
	}
	got := s.seen[0]
	if got.auth != "Bearer nn_secret" || got.tool != "list_vaults" {
		t.Fatalf("headers: Authorization %q, X-MCP-Tool %q", got.auth, got.tool)
	}
	if got.ctype != "" {
		t.Fatalf("a GET without a body sent Content-Type %q", got.ctype)
	}
}

func TestClient_EscapesPathSegmentsAndQueries(t *testing.T) {
	s, c := newStub(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /api/notes/a/b":         jsonReply(200, Note{ID: "a/b"}),
		"GET /api/vaults/v 1/search": jsonReply(200, []SearchResult{{ID: "n1", Title: "Hit"}}),
	})
	if n, err := c.Note(ctx, "read_note", "a/b"); err != nil || n.ID != "a/b" {
		t.Fatalf("note = %+v, %v", n, err)
	}
	if hits, err := c.Search(ctx, "search_notes", "v 1", "tag:x & y"); err != nil || len(hits) != 1 {
		t.Fatalf("search = %+v, %v", hits, err)
	}
	if s.seen[0].path != "/api/notes/a%2Fb" {
		t.Errorf("note path = %q, want the id escaped as one segment", s.seen[0].path)
	}
	if s.seen[1].path != "/api/vaults/v%201/search" || s.seen[1].query != "q=tag%3Ax+%26+y" {
		t.Errorf("search = %q ? %q", s.seen[1].path, s.seen[1].query)
	}
}

func TestClient_NotesPagingFollowsTheCursor(t *testing.T) {
	s, c := newStub(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /api/vaults/v1/notes": func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Query().Get("after") {
			case "":
				w.Header().Set("X-Next-Cursor", "c1")
				jsonReply(200, []Note{{ID: "n1"}, {ID: "n2"}})(w, r)
			case "c1":
				w.Header().Set("X-Next-Cursor", "c2")
				jsonReply(200, []Note{{ID: "n3"}})(w, r)
			default:
				jsonReply(200, []Note{{ID: "n4"}})(w, r)
			}
		},
	})
	page, next, err := c.NotesPage(ctx, "list_notes", "v1", 2, "")
	if err != nil || len(page) != 2 || next != "c1" {
		t.Fatalf("page = %+v, next %q, %v", page, next, err)
	}
	if s.seen[0].query != "limit=2" {
		t.Errorf("first page query = %q", s.seen[0].query)
	}
	all, err := c.AllNotes(ctx, "get_graph", "v1")
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, n := range all {
		ids = append(ids, n.ID)
	}
	if strings.Join(ids, ",") != "n1,n2,n3,n4" {
		t.Fatalf("AllNotes = %v", ids)
	}
	if q := s.seen[len(s.seen)-1].query; q != "after=c2&limit=1000" {
		t.Errorf("last page query = %q", q)
	}
}

func TestClient_WritesCarryDeviceAndChecksum(t *testing.T) {
	s, c := newStub(t, map[string]func(http.ResponseWriter, *http.Request){
		"POST /api/vaults/v1/notes": jsonReply(201, Note{ID: "n9", Title: "New", Checksum: "c0"}),
		"PUT /api/notes/n9":         jsonReply(200, Note{ID: "n9", Checksum: "c1"}),
		"POST /api/notes/n9/trash":  jsonReply(200, map[string]string{"id": "n9"}),
	})
	created, err := c.CreateNote(ctx, "create_note", "v1", "New", "Inbox", "hello")
	if err != nil || created.ID != "n9" {
		t.Fatalf("create = %+v, %v", created, err)
	}
	updated, err := c.UpdateNote(ctx, "update_note", created, "hello again")
	if err != nil || updated.Checksum != "c1" {
		t.Fatalf("update = %+v, %v", updated, err)
	}
	if err := c.TrashNote(ctx, "delete_note", "n9"); err != nil {
		t.Fatal(err)
	}

	create, update := s.seen[0], s.seen[1]
	if create.ctype != "application/json" || create.body["title"] != "New" || create.body["path"] != "Inbox" ||
		create.body["content"] != "hello" || create.body["device_id"] != "mcp" {
		t.Errorf("create request = %+v", create)
	}
	if update.body["prev_checksum"] != "c0" || update.body["content"] != "hello again" || update.body["device_id"] != "mcp" {
		t.Errorf("update request = %+v", update)
	}
	if s.seen[2].method != http.MethodPost || s.seen[2].tool != "delete_note" {
		t.Errorf("trash request = %+v", s.seen[2])
	}
}

func TestClient_ErrorsCarryStatusAndMessage(t *testing.T) {
	_, c := newStub(t, map[string]func(http.ResponseWriter, *http.Request){
		"PUT /api/notes/n1":       jsonReply(409, map[string]string{"error": "conflict"}),
		"GET /api/vaults/v1":      func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) },
		"GET /api/vaults/v1/tags": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("not json")) },
	})
	_, err := c.UpdateNote(ctx, "update_note", &Note{ID: "n1"}, "x")
	if !IsStatus(err, http.StatusConflict) || err.Error() != "sync service answered 409: conflict" {
		t.Fatalf("409: %v", err)
	}
	if IsStatus(err, http.StatusNotFound) || IsStatus(errors.New("plain"), http.StatusConflict) {
		t.Fatal("IsStatus matched the wrong status or a plain error")
	}
	_, err = c.Vault(ctx, "list_notes", "v1")
	if !IsStatus(err, http.StatusForbidden) || err.Error() != "sync service answered 403" {
		t.Fatalf("403 without a body: %v", err)
	}
	if _, err := c.Tags(ctx, "list_tags", "v1"); err == nil || !strings.Contains(err.Error(), "decode response") {
		t.Fatalf("bad JSON: %v", err)
	}
}

func TestClient_UnreachableServer(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	_, err := NewClient(url, "nn_x").Vaults(ctx, "list_vaults")
	if err == nil || !strings.Contains(err.Error(), "sync service unreachable") {
		t.Fatalf("err = %v", err)
	}
}

func TestClient_HonoursContextCancellation(t *testing.T) {
	_, c := newStub(t, map[string]func(http.ResponseWriter, *http.Request){
		"GET /api/vaults": jsonReply(200, []Vault{}),
	})
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := c.Vaults(cancelled, "list_vaults"); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
