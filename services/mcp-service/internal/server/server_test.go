package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/nexus"
)

// fakeAPI is a tiny in-memory stand-in for the sync service's REST API.
type fakeAPI struct {
	mu        sync.Mutex
	t         *testing.T
	token     string
	readOnly  bool
	vaults    []nexus.Vault
	notes     []*nexus.Note
	nextID    int
	conflicts int      // PUTs to answer with 409 before accepting
	tools     []string // X-MCP-Tool of each request
	deleted   []string
}

func (f *fakeAPI) note(id string) *nexus.Note {
	for _, n := range f.notes {
		if n.ID == id {
			return n
		}
	}
	return nil
}

func (f *fakeAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer "+f.token {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	f.tools = append(f.tools, r.Header.Get("X-MCP-Tool"))
	write := func(status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/") // api, vaults|notes, ...
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/vaults":
		write(200, f.vaults)
	case r.Method == http.MethodGet && len(parts) == 3 && parts[1] == "vaults":
		for _, v := range f.vaults {
			if v.ID == parts[2] {
				write(200, v)
				return
			}
		}
		write(404, map[string]string{"error": "vault not found"})
	case r.Method == http.MethodGet && len(parts) == 4 && parts[3] == "notes":
		var list []nexus.Note
		for _, n := range f.notes {
			if n.VaultID == parts[2] {
				list = append(list, *n)
			}
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		start, _ := strconv.Atoi(r.URL.Query().Get("after"))
		end := min(start+limit, len(list))
		if end < len(list) {
			w.Header().Set("X-Next-Cursor", strconv.Itoa(end))
		}
		write(200, list[start:end])
	case r.Method == http.MethodPost && len(parts) == 4 && parts[3] == "notes":
		if f.readOnly {
			write(403, map[string]string{"error": "not available to this MCP token"})
			return
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.nextID++
		n := &nexus.Note{ID: "new" + strconv.Itoa(f.nextID), VaultID: parts[2], Title: body["title"], Path: body["path"], Content: body["content"], Checksum: "c0"}
		f.notes = append(f.notes, n)
		write(201, n)
	case r.Method == http.MethodGet && len(parts) == 3 && parts[1] == "notes":
		if n := f.note(parts[2]); n != nil {
			write(200, n)
			return
		}
		write(404, map[string]string{"error": "note not found"})
	case r.Method == http.MethodPut && len(parts) == 3 && parts[1] == "notes":
		n := f.note(parts[2])
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if f.conflicts > 0 {
			f.conflicts--
			n.Content += "\n(typed in the app)"
			n.Checksum += "x"
			write(409, map[string]string{"note_id": n.ID})
			return
		}
		if body["prev_checksum"] != n.Checksum {
			write(409, map[string]string{"note_id": n.ID})
			return
		}
		n.Content, n.Checksum = body["content"], n.Checksum+"+"
		write(200, n)
	case r.Method == http.MethodDelete && len(parts) == 5:
		f.deleted = append(f.deleted, parts[4])
		w.WriteHeader(204)
	case r.Method == http.MethodGet && len(parts) == 4 && parts[3] == "search":
		write(200, []nexus.SearchResult{{ID: "n1", Title: "Plan", Snippet: r.URL.Query().Get("q")}})
	case r.Method == http.MethodGet && len(parts) == 4 && parts[3] == "tags":
		write(200, []nexus.TagCount{{Tag: "a", Count: 1}, {Tag: "b", Count: 3}})
	default:
		f.t.Errorf("unexpected request %s %s", r.Method, r.URL)
		w.WriteHeader(500)
	}
}

func newFake(t *testing.T) *fakeAPI {
	return &fakeAPI{
		t:     t,
		token: "nn_test",
		vaults: []nexus.Vault{
			{ID: "v1", Name: "Work", Encryption: "none", Role: "owner"},
			{ID: "v2", Name: "Diary", Encryption: "e2ee", Role: "owner"},
		},
		notes: []*nexus.Note{
			{ID: "n1", VaultID: "v1", Path: "", Title: "Plan", Content: "See [[Projects/Alpha]] and [[Ideas|my ideas]].\n\n```\n[[Not A Link]]\n```", Checksum: "c1"},
			{ID: "n2", VaultID: "v1", Path: "Projects", Title: "Alpha", Content: "Back to [[plan]]. Also `[[Code]]`.", Checksum: "c2"},
			{ID: "n3", VaultID: "v1", Path: "Projects/Old", Title: "Beta", Content: "", Checksum: "c3"},
			{ID: "n4", VaultID: "v1", Path: "", Title: "Ideas", Content: "- one", Checksum: "c4"},
			{ID: "s1", VaultID: "v2", Path: "", Title: "sealed", Content: "iv:ciphertext", Checksum: "c5"},
		},
	}
}

// connect runs the MCP server against fake and returns a connected client.
func connect(t *testing.T, fake *fakeAPI) *mcp.ClientSession {
	t.Helper()
	api := httptest.NewServer(fake)
	t.Cleanup(api.Close)
	now := func() time.Time { return time.Date(2026, 10, 4, 9, 0, 0, 0, time.UTC) }
	srv := New(nexus.NewClient(api.URL, fake.token), now)
	st, ct := mcp.NewInMemoryTransports()
	ctx := context.Background()
	ss, err := srv.Connect(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ss.Close() })
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

// call runs a tool and decodes its structured result into out; it returns
// the error text when the tool reported an error.
func call(t *testing.T, cs *mcp.ClientSession, tool string, args map[string]any, out any) string {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", tool, err)
	}
	if res.IsError {
		var msg strings.Builder
		for _, c := range res.Content {
			if tc, ok := c.(*mcp.TextContent); ok {
				msg.WriteString(tc.Text)
			}
		}
		return msg.String()
	}
	if out != nil {
		b, _ := json.Marshal(res.StructuredContent)
		if err := json.Unmarshal(b, out); err != nil {
			t.Fatalf("%s: decode %s: %v", tool, b, err)
		}
	}
	return ""
}

func TestTools_AreListed(t *testing.T) {
	cs := connect(t, newFake(t))
	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range res.Tools {
		names = append(names, tool.Name)
	}
	want := "list_vaults list_notes read_note search_notes get_backlinks get_graph list_tags get_daily_note create_note update_note append_to_note delete_note"
	for _, name := range strings.Fields(want) {
		if !strings.Contains(" "+strings.Join(names, " ")+" ", " "+name+" ") {
			t.Errorf("tool %s missing from %v", name, names)
		}
	}
}

func TestListVaults_MarksEncryptedAndNamesTheTool(t *testing.T) {
	fake := newFake(t)
	cs := connect(t, fake)
	var out ListVaultsOut
	if msg := call(t, cs, "list_vaults", nil, &out); msg != "" {
		t.Fatal(msg)
	}
	if len(out.Vaults) != 2 || out.Vaults[0].Encrypted || !out.Vaults[1].Encrypted {
		t.Fatalf("vaults: %+v", out.Vaults)
	}
	if fake.tools[0] != "list_vaults" {
		t.Fatalf("X-MCP-Tool = %q", fake.tools[0])
	}
}

func TestListNotes_FiltersByFolderAndPages(t *testing.T) {
	cs := connect(t, newFake(t))
	var out ListNotesOut
	if msg := call(t, cs, "list_notes", map[string]any{"vault_id": "v1", "folder": "Projects"}, &out); msg != "" {
		t.Fatal(msg)
	}
	if len(out.Notes) != 2 || out.Notes[0].Title != "Alpha" || out.Notes[1].Title != "Beta" {
		t.Fatalf("folder filter: %+v", out.Notes)
	}
	var page1, page2 ListNotesOut
	call(t, cs, "list_notes", map[string]any{"vault_id": "v1", "limit": 3}, &page1)
	if len(page1.Notes) != 3 || page1.NextCursor == "" {
		t.Fatalf("page 1: %+v", page1)
	}
	call(t, cs, "list_notes", map[string]any{"vault_id": "v1", "limit": 3, "cursor": page1.NextCursor}, &page2)
	if len(page2.Notes) != 1 || page2.NextCursor != "" {
		t.Fatalf("page 2: %+v", page2)
	}
}

func TestReadNote_ByIDAndPath_RefusesEncrypted(t *testing.T) {
	cs := connect(t, newFake(t))
	var out ReadNoteOut
	if msg := call(t, cs, "read_note", map[string]any{"vault_id": "v1", "path": "Projects/alpha"}, &out); msg != "" {
		t.Fatal(msg)
	}
	if out.ID != "n2" || !strings.HasPrefix(out.Content, "Back to") {
		t.Fatalf("by path: %+v", out)
	}
	if msg := call(t, cs, "read_note", map[string]any{"note_id": "s1"}, nil); !strings.Contains(msg, "end-to-end encrypted") {
		t.Fatalf("encrypted note: %q", msg)
	}
	if msg := call(t, cs, "read_note", map[string]any{"vault_id": "v1", "path": "Nope"}, nil); !strings.Contains(msg, "no note") {
		t.Fatalf("missing note: %q", msg)
	}
}

func TestGetGraph_ResolvesLinksAndSkipsCode(t *testing.T) {
	cs := connect(t, newFake(t))
	var out GraphOut
	if msg := call(t, cs, "get_graph", map[string]any{"vault_id": "v1"}, &out); msg != "" {
		t.Fatal(msg)
	}
	got := map[string]bool{}
	for _, e := range out.Edges {
		got[e.Source+">"+e.Target] = true
	}
	want := map[string]bool{"n1>n2": true, "n1>n4": true, "n2>n1": true}
	if len(out.Nodes) != 4 || len(got) != len(want) {
		t.Fatalf("graph: %d nodes, edges %v", len(out.Nodes), got)
	}
	for e := range want {
		if !got[e] {
			t.Fatalf("missing edge %s in %v", e, got)
		}
	}
}

func TestDailyNote_FindsOrCreates(t *testing.T) {
	fake := newFake(t)
	cs := connect(t, fake)
	var created DailyOut
	if msg := call(t, cs, "get_daily_note", map[string]any{"vault_id": "v1"}, &created); msg != "" {
		t.Fatal(msg)
	}
	if !created.Created || created.Folder != "Daily" || created.Title != "2026-10-04" {
		t.Fatalf("created: %+v", created)
	}
	var again DailyOut
	call(t, cs, "get_daily_note", map[string]any{"vault_id": "v1"}, &again)
	if again.Created || again.ID != created.ID {
		t.Fatalf("second call: %+v", again)
	}

	fake.readOnly = true
	if msg := call(t, cs, "get_daily_note", map[string]any{"vault_id": "v1", "date": "2026-10-05"}, nil); !strings.Contains(msg, "cannot create") {
		t.Fatalf("read-only token: %q", msg)
	}
}

func TestAppend_RetriesOnceAfterAConcurrentEdit(t *testing.T) {
	fake := newFake(t)
	fake.conflicts = 1
	cs := connect(t, fake)
	if msg := call(t, cs, "append_to_note", map[string]any{"vault_id": "v2", "note_id": "n4", "text": "x"}, nil); !strings.Contains(msg, "not in vault") {
		t.Fatalf("wrong vault: %q", msg)
	}
	if msg := call(t, cs, "append_to_note", map[string]any{"vault_id": "v1", "note_id": "n4", "text": "- two"}, nil); msg != "" {
		t.Fatal(msg)
	}
	if got := fake.note("n4").Content; got != "- one\n(typed in the app)\n\n- two" {
		t.Fatalf("content = %q", got)
	}
}

func TestUpdateNote_Modes(t *testing.T) {
	fake := newFake(t)
	cs := connect(t, fake)
	call(t, cs, "update_note", map[string]any{"note_id": "n4", "content": "# Ideas", "mode": "prepend"}, nil)
	if got := fake.note("n4").Content; got != "# Ideas\n\n- one" {
		t.Fatalf("prepend: %q", got)
	}
	call(t, cs, "update_note", map[string]any{"note_id": "n4", "content": "fresh"}, nil)
	if got := fake.note("n4").Content; got != "fresh" {
		t.Fatalf("replace: %q", got)
	}
	if msg := call(t, cs, "update_note", map[string]any{"note_id": "n4", "content": "x", "mode": "merge"}, nil); msg == "" {
		t.Fatal("unknown mode accepted")
	}
	if msg := call(t, cs, "update_note", map[string]any{"note_id": "s1", "content": "plain"}, nil); !strings.Contains(msg, "end-to-end encrypted") {
		t.Fatalf("encrypted note: %q", msg)
	}
}

func TestDeleteNote_NeedsConfirm(t *testing.T) {
	fake := newFake(t)
	cs := connect(t, fake)
	if msg := call(t, cs, "delete_note", map[string]any{"note_id": "n3", "confirm": false}, nil); !strings.Contains(msg, "confirm: true") {
		t.Fatalf("without confirm: %q", msg)
	}
	if len(fake.deleted) != 0 {
		t.Fatal("deleted without confirm")
	}
	if msg := call(t, cs, "delete_note", map[string]any{"note_id": "n3", "confirm": true}, nil); msg != "" {
		t.Fatal(msg)
	}
	if len(fake.deleted) != 1 || fake.deleted[0] != "n3" {
		t.Fatalf("deleted: %v", fake.deleted)
	}
}

func TestRevokedToken_IsExplained(t *testing.T) {
	fake := newFake(t)
	cs := connect(t, fake)
	fake.token = "nn_rotated"
	if msg := call(t, cs, "list_vaults", nil, nil); !strings.Contains(msg, "invalid or was revoked") {
		t.Fatalf("revoked token: %q", msg)
	}
}

func TestSearchAndTags(t *testing.T) {
	cs := connect(t, newFake(t))
	var s SearchOut
	if msg := call(t, cs, "search_notes", map[string]any{"vault_id": "v1", "query": "plan"}, &s); msg != "" || len(s.Results) != 1 {
		t.Fatalf("search: %q %+v", msg, s)
	}
	if msg := call(t, cs, "search_notes", map[string]any{"vault_id": "v2", "query": "x"}, nil); !strings.Contains(msg, "end-to-end encrypted") {
		t.Fatalf("encrypted search: %q", msg)
	}
	var tags TagsOut
	call(t, cs, "list_tags", map[string]any{"vault_id": "v1"}, &tags)
	if len(tags.Tags) != 2 || tags.Tags[0].Tag != "b" {
		t.Fatalf("tags: %+v", tags)
	}
}
