// Package server is the NexusNotes MCP server (#221): tools that read and
// write a user's notes through the sync service, as the owner of an MCP token.
package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/nexus"
)

const instructions = `NexusNotes is a Markdown note-taking app. Notes live in vaults; a note has a
folder (its "path"), a title and Markdown content, and links to other notes with
[[Title]] wiki-links. End-to-end encrypted vaults can be listed but their notes
cannot be read, searched or written: the server never sees their text.`

// Version is reported to clients in the initialize handshake.
var Version = "dev"

// New returns an MCP server whose tools act through client. now supplies the
// date for get_daily_note (time.Now in production).
func New(client *nexus.Client, now func() time.Time) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "nexusnotes", Title: "NexusNotes", Version: Version},
		&mcp.ServerOptions{Instructions: instructions})
	t := &tools{c: client, now: now}

	readOnly := &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true}
	mcp.AddTool(s, &mcp.Tool{Name: "list_vaults", Description: "List the vaults you can access, with their id, name, your role and whether they are end-to-end encrypted.", Annotations: readOnly}, t.listVaults)
	mcp.AddTool(s, &mcp.Tool{Name: "list_notes", Description: "List the notes of a vault (optionally of one folder and its subfolders): id, folder, title and last update. Never returns content; use read_note for that.", Annotations: readOnly}, t.listNotes)
	mcp.AddTool(s, &mcp.Tool{Name: "read_note", Description: `Read a note's Markdown content, by note_id or by vault_id plus path ("Folder/Title", or just "Title" for a note at the vault root).`, Annotations: readOnly}, t.readNote)
	mcp.AddTool(s, &mcp.Tool{Name: "search_notes", Description: "Search a vault's notes by text in titles, content, tags and aliases; returns up to 50 matches, newest first, with a snippet.", Annotations: readOnly}, t.searchNotes)
	mcp.AddTool(s, &mcp.Tool{Name: "get_backlinks", Description: "List the notes that link to a note with a [[wiki-link]].", Annotations: readOnly}, t.getBacklinks)
	mcp.AddTool(s, &mcp.Tool{Name: "get_graph", Description: "Return a vault's link graph: every note as a node and every resolved [[wiki-link]] between notes as an edge.", Annotations: readOnly}, t.getGraph)
	mcp.AddTool(s, &mcp.Tool{Name: "list_tags", Description: "List the tags used in a vault with how many notes carry each.", Annotations: readOnly}, t.listTags)
	mcp.AddTool(s, &mcp.Tool{Name: "get_daily_note", Description: "Get the daily note (folder Daily, titled YYYY-MM-DD) for today or a given date, creating it when it does not exist yet and the token may write."}, t.getDailyNote)

	notDestructive := false
	destructive := true
	mcp.AddTool(s, &mcp.Tool{Name: "create_note", Description: "Create a note in a vault folder.", Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive}}, t.createNote)
	mcp.AddTool(s, &mcp.Tool{Name: "update_note", Description: `Change a note's content: "replace" it (default), or "append" / "prepend" text to it.`, Annotations: &mcp.ToolAnnotations{DestructiveHint: &destructive}}, t.updateNote)
	mcp.AddTool(s, &mcp.Tool{Name: "append_to_note", Description: "Append a block of text to the end of a note, keeping everything already in it.", Annotations: &mcp.ToolAnnotations{DestructiveHint: &notDestructive}}, t.appendToNote)
	mcp.AddTool(s, &mcp.Tool{Name: "delete_note", Description: "Delete a note permanently. Requires confirm: true.", Annotations: &mcp.ToolAnnotations{DestructiveHint: &destructive}}, t.deleteNote)
	addResources(s, t)
	addPrompts(s, t)
	return s
}

type tools struct {
	c   *nexus.Client
	now func() time.Time
}

// explain turns an API error into a message an AI client can act on.
func explain(err error) error {
	var apiErr *nexus.APIError
	if !errors.As(err, &apiErr) {
		return err
	}
	switch apiErr.Status {
	case http.StatusUnauthorized:
		return errors.New("the NexusNotes token is invalid or was revoked; create a new one in Settings > AI Access")
	case http.StatusForbidden:
		if apiErr.Message != "" {
			return fmt.Errorf("not allowed: %s", apiErr.Message)
		}
		return errors.New("not allowed with this token (a read-only token cannot write)")
	case http.StatusNotFound:
		return errors.New("not found")
	case http.StatusTooManyRequests:
		return errors.New("rate limited: too many calls in a minute, wait a moment and retry")
	}
	return err
}

// --- shared shapes -----------------------------------------------------------

type VaultInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role,omitempty"`
	Encrypted bool   `json:"encrypted"`
}

type NoteInfo struct {
	ID        string    `json:"id"`
	VaultID   string    `json:"vault_id"`
	Folder    string    `json:"folder"`
	Title     string    `json:"title"`
	UpdatedAt time.Time `json:"updated_at"`
}

func infoOf(n *nexus.Note) NoteInfo {
	return NoteInfo{ID: n.ID, VaultID: n.VaultID, Folder: n.Path, Title: n.Title, UpdatedAt: n.UpdatedAt}
}

// inVault checks a caller-given vault against the note's own ("" = any).
func inVault(n *nexus.Note, vaultID string) error {
	if vaultID != "" && n.VaultID != vaultID {
		return fmt.Errorf("note %s is not in vault %s", n.ID, vaultID)
	}
	return nil
}

// requireReadable refuses vaults whose note text the server cannot see.
func (t *tools) requireReadable(ctx context.Context, tool, vaultID string) error {
	v, err := t.c.Vault(ctx, tool, vaultID)
	if err != nil {
		return explain(err)
	}
	if v.E2EE() {
		return fmt.Errorf("vault %q is end-to-end encrypted: its notes can only be read in the NexusNotes app", v.Name)
	}
	return nil
}

// --- read tools --------------------------------------------------------------

type ListVaultsOut struct {
	Vaults []VaultInfo `json:"vaults"`
}

func (t *tools) listVaults(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, ListVaultsOut, error) {
	vaults, err := t.c.Vaults(ctx, "list_vaults")
	if err != nil {
		return nil, ListVaultsOut{}, explain(err)
	}
	out := ListVaultsOut{Vaults: []VaultInfo{}}
	for _, v := range vaults {
		out.Vaults = append(out.Vaults, VaultInfo{ID: v.ID, Name: v.Name, Role: v.Role, Encrypted: v.E2EE()})
	}
	return nil, out, nil
}

type ListNotesIn struct {
	VaultID string `json:"vault_id" jsonschema:"the vault to list"`
	Folder  string `json:"folder,omitempty" jsonschema:"only notes in this folder and its subfolders"`
	Limit   int    `json:"limit,omitempty" jsonschema:"notes per page, 1-500 (default 100)"`
	Cursor  string `json:"cursor,omitempty" jsonschema:"next_cursor from the previous page"`
}

type ListNotesOut struct {
	Notes      []NoteInfo `json:"notes"`
	NextCursor string     `json:"next_cursor,omitempty"`
}

func (t *tools) listNotes(ctx context.Context, _ *mcp.CallToolRequest, in ListNotesIn) (*mcp.CallToolResult, ListNotesOut, error) {
	limit := in.Limit
	if limit == 0 {
		limit = 100
	}
	if limit < 1 || limit > 500 {
		return nil, ListNotesOut{}, errors.New("limit must be 1-500")
	}
	offset := 0
	if in.Cursor != "" {
		n, err := strconv.Atoi(in.Cursor)
		if err != nil || n < 0 {
			return nil, ListNotesOut{}, errors.New("invalid cursor")
		}
		offset = n
	}
	notes, err := t.c.AllNotes(ctx, "list_notes", in.VaultID)
	if err != nil {
		return nil, ListNotesOut{}, explain(err)
	}
	folder := strings.Trim(in.Folder, "/")
	out := ListNotesOut{Notes: []NoteInfo{}}
	matched := 0
	for i := range notes {
		n := &notes[i]
		if folder != "" && n.Path != folder && !strings.HasPrefix(n.Path, folder+"/") {
			continue
		}
		matched++
		if matched <= offset {
			continue
		}
		if len(out.Notes) == limit {
			out.NextCursor = strconv.Itoa(offset + limit)
			break
		}
		out.Notes = append(out.Notes, infoOf(n))
	}
	return nil, out, nil
}

type ReadNoteIn struct {
	NoteID  string `json:"note_id,omitempty" jsonschema:"the note's id"`
	VaultID string `json:"vault_id,omitempty" jsonschema:"the vault, when reading by path"`
	Path    string `json:"path,omitempty" jsonschema:"Folder/Title of the note, when reading by path"`
}

type ReadNoteOut struct {
	NoteInfo
	Content string `json:"content"`
}

func (t *tools) readNote(ctx context.Context, _ *mcp.CallToolRequest, in ReadNoteIn) (*mcp.CallToolResult, ReadNoteOut, error) {
	note, err := t.findNote(ctx, "read_note", in.NoteID, in.VaultID, in.Path)
	if err != nil {
		return nil, ReadNoteOut{}, err
	}
	if err := t.requireReadable(ctx, "read_note", note.VaultID); err != nil {
		return nil, ReadNoteOut{}, err
	}
	return nil, ReadNoteOut{NoteInfo: infoOf(note), Content: note.Content}, nil
}

// findNote loads a note by id, or by vault plus "Folder/Title".
func (t *tools) findNote(ctx context.Context, tool, noteID, vaultID, path string) (*nexus.Note, error) {
	if noteID != "" {
		n, err := t.c.Note(ctx, tool, noteID)
		return n, explain(err)
	}
	if vaultID == "" || path == "" {
		return nil, errors.New("give note_id, or vault_id and path")
	}
	path = strings.TrimSuffix(strings.Trim(path, "/"), ".md")
	folder, title := "", path
	if i := strings.LastIndex(path, "/"); i >= 0 {
		folder, title = path[:i], path[i+1:]
	}
	notes, err := t.c.AllNotes(ctx, tool, vaultID)
	if err != nil {
		return nil, explain(err)
	}
	for i := range notes {
		if notes[i].Path == folder && strings.EqualFold(notes[i].Title, title) {
			return t.c.Note(ctx, tool, notes[i].ID) // the list may be a moment old
		}
	}
	return nil, fmt.Errorf("no note %q in this vault", path)
}

type SearchIn struct {
	VaultID string `json:"vault_id" jsonschema:"the vault to search"`
	Query   string `json:"query" jsonschema:"text to look for"`
}

type SearchOut struct {
	Results []nexus.SearchResult `json:"results"`
}

func (t *tools) searchNotes(ctx context.Context, _ *mcp.CallToolRequest, in SearchIn) (*mcp.CallToolResult, SearchOut, error) {
	if strings.TrimSpace(in.Query) == "" {
		return nil, SearchOut{}, errors.New("query is empty")
	}
	if err := t.requireReadable(ctx, "search_notes", in.VaultID); err != nil {
		return nil, SearchOut{}, err
	}
	results, err := t.c.Search(ctx, "search_notes", in.VaultID, in.Query)
	if err != nil {
		return nil, SearchOut{}, explain(err)
	}
	if results == nil {
		results = []nexus.SearchResult{}
	}
	return nil, SearchOut{Results: results}, nil
}

type NoteIDIn struct {
	VaultID string `json:"vault_id,omitempty" jsonschema:"optional: the vault the note must be in"`
	NoteID  string `json:"note_id" jsonschema:"the note's id"`
}

type BacklinksOut struct {
	Backlinks []nexus.Backlink `json:"backlinks"`
}

func (t *tools) getBacklinks(ctx context.Context, _ *mcp.CallToolRequest, in NoteIDIn) (*mcp.CallToolResult, BacklinksOut, error) {
	if in.VaultID != "" {
		n, err := t.c.Note(ctx, "get_backlinks", in.NoteID)
		if err != nil {
			return nil, BacklinksOut{}, explain(err)
		}
		if err := inVault(n, in.VaultID); err != nil {
			return nil, BacklinksOut{}, err
		}
	}
	links, err := t.c.Backlinks(ctx, "get_backlinks", in.NoteID)
	if err != nil {
		return nil, BacklinksOut{}, explain(err)
	}
	if links == nil {
		links = []nexus.Backlink{}
	}
	return nil, BacklinksOut{Backlinks: links}, nil
}

type VaultIDIn struct {
	VaultID string `json:"vault_id" jsonschema:"the vault"`
}

type GraphNode struct {
	ID     string `json:"id"`
	Folder string `json:"folder"`
	Title  string `json:"title"`
}

type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type GraphOut struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

func (t *tools) getGraph(ctx context.Context, _ *mcp.CallToolRequest, in VaultIDIn) (*mcp.CallToolResult, GraphOut, error) {
	if err := t.requireReadable(ctx, "get_graph", in.VaultID); err != nil {
		return nil, GraphOut{}, err
	}
	notes, err := t.c.AllNotes(ctx, "get_graph", in.VaultID)
	if err != nil {
		return nil, GraphOut{}, explain(err)
	}
	return nil, buildGraph(notes), nil
}

type TagsOut struct {
	Tags []nexus.TagCount `json:"tags"`
}

func (t *tools) listTags(ctx context.Context, _ *mcp.CallToolRequest, in VaultIDIn) (*mcp.CallToolResult, TagsOut, error) {
	tags, err := t.c.Tags(ctx, "list_tags", in.VaultID)
	if err != nil {
		return nil, TagsOut{}, explain(err)
	}
	if tags == nil {
		tags = []nexus.TagCount{}
	}
	sort.SliceStable(tags, func(i, j int) bool { return tags[i].Count > tags[j].Count })
	return nil, TagsOut{Tags: tags}, nil
}

// DailyFolder is where the desktop app keeps daily notes (lib/periodic.ts).
const DailyFolder = "Daily"

type DailyIn struct {
	VaultID string `json:"vault_id" jsonschema:"the vault"`
	Date    string `json:"date,omitempty" jsonschema:"YYYY-MM-DD; today when omitted"`
}

type DailyOut struct {
	ReadNoteOut
	Created bool `json:"created"`
}

func (t *tools) getDailyNote(ctx context.Context, _ *mcp.CallToolRequest, in DailyIn) (*mcp.CallToolResult, DailyOut, error) {
	date := in.Date
	if date == "" {
		date = t.now().Format(time.DateOnly)
	} else if _, err := time.Parse(time.DateOnly, date); err != nil {
		return nil, DailyOut{}, errors.New("date must be YYYY-MM-DD")
	}
	if err := t.requireReadable(ctx, "get_daily_note", in.VaultID); err != nil {
		return nil, DailyOut{}, err
	}
	notes, err := t.c.AllNotes(ctx, "get_daily_note", in.VaultID)
	if err != nil {
		return nil, DailyOut{}, explain(err)
	}
	for i := range notes {
		if notes[i].Path == DailyFolder && notes[i].Title == date {
			n, err := t.c.Note(ctx, "get_daily_note", notes[i].ID)
			if err != nil {
				return nil, DailyOut{}, explain(err)
			}
			return nil, DailyOut{ReadNoteOut: ReadNoteOut{NoteInfo: infoOf(n), Content: n.Content}}, nil
		}
	}
	n, err := t.c.CreateNote(ctx, "get_daily_note", in.VaultID, date, DailyFolder, "# "+date+"\n\n")
	if nexus.IsStatus(err, http.StatusForbidden) {
		return nil, DailyOut{}, fmt.Errorf("there is no daily note for %s yet, and this token cannot create one", date)
	}
	if err != nil {
		return nil, DailyOut{}, explain(err)
	}
	return nil, DailyOut{ReadNoteOut: ReadNoteOut{NoteInfo: infoOf(n), Content: n.Content}, Created: true}, nil
}

// --- write tools -------------------------------------------------------------

type CreateNoteIn struct {
	VaultID string `json:"vault_id" jsonschema:"the vault to create the note in"`
	Title   string `json:"title" jsonschema:"the note's title (its name)"`
	Folder  string `json:"folder,omitempty" jsonschema:"folder path such as Projects/2026; the vault root when omitted"`
	Content string `json:"content" jsonschema:"Markdown content"`
}

func (t *tools) createNote(ctx context.Context, _ *mcp.CallToolRequest, in CreateNoteIn) (*mcp.CallToolResult, NoteInfo, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" || strings.Contains(title, "/") {
		return nil, NoteInfo{}, errors.New("title must be non-empty and contain no /")
	}
	if err := t.requireReadable(ctx, "create_note", in.VaultID); err != nil {
		return nil, NoteInfo{}, err
	}
	n, err := t.c.CreateNote(ctx, "create_note", in.VaultID, title, strings.Trim(in.Folder, "/"), in.Content)
	if err != nil {
		return nil, NoteInfo{}, explain(err)
	}
	return nil, infoOf(n), nil
}

type UpdateNoteIn struct {
	VaultID string `json:"vault_id,omitempty" jsonschema:"optional: the vault the note must be in"`
	NoteID  string `json:"note_id" jsonschema:"the note to change"`
	Content string `json:"content" jsonschema:"the new content, or the text to add"`
	Mode    string `json:"mode,omitempty" jsonschema:"replace (default), append or prepend"`
}

func (t *tools) updateNote(ctx context.Context, _ *mcp.CallToolRequest, in UpdateNoteIn) (*mcp.CallToolResult, NoteInfo, error) {
	mode := in.Mode
	if mode == "" {
		mode = "replace"
	}
	if mode != "replace" && mode != "append" && mode != "prepend" {
		return nil, NoteInfo{}, errors.New(`mode must be "replace", "append" or "prepend"`)
	}
	n, err := t.edit(ctx, "update_note", in.VaultID, in.NoteID, func(old string) string {
		switch mode {
		case "append":
			return joinBlocks(old, in.Content)
		case "prepend":
			return joinBlocks(in.Content, old)
		}
		return in.Content
	})
	return nil, n, err
}

type AppendIn struct {
	VaultID string `json:"vault_id,omitempty" jsonschema:"optional: the vault the note must be in"`
	NoteID  string `json:"note_id" jsonschema:"the note to append to"`
	Text    string `json:"text" jsonschema:"Markdown to add at the end"`
}

func (t *tools) appendToNote(ctx context.Context, _ *mcp.CallToolRequest, in AppendIn) (*mcp.CallToolResult, NoteInfo, error) {
	n, err := t.edit(ctx, "append_to_note", in.VaultID, in.NoteID, func(old string) string { return joinBlocks(old, in.Text) })
	return nil, n, err
}

// edit applies change to the note's current content and saves it. When the
// note changed in between (someone typing in the app), it re-reads and
// applies the change once more rather than overwrite their edit.
func (t *tools) edit(ctx context.Context, tool, vaultID, noteID string, change func(string) string) (NoteInfo, error) {
	for attempt := 0; ; attempt++ {
		n, err := t.c.Note(ctx, tool, noteID)
		if err != nil {
			return NoteInfo{}, explain(err)
		}
		if attempt == 0 {
			if err := inVault(n, vaultID); err != nil {
				return NoteInfo{}, err
			}
			if err := t.requireReadable(ctx, tool, n.VaultID); err != nil {
				return NoteInfo{}, err
			}
		}
		saved, err := t.c.UpdateNote(ctx, tool, n, change(n.Content))
		if nexus.IsStatus(err, http.StatusConflict) && attempt == 0 {
			continue
		}
		if err != nil {
			return NoteInfo{}, explain(err)
		}
		return infoOf(saved), nil
	}
}

// joinBlocks puts b after a with one blank line between them.
func joinBlocks(a, b string) string {
	a, b = strings.TrimRight(a, "\n"), strings.TrimLeft(b, "\n")
	switch {
	case a == "":
		return b
	case b == "":
		return a + "\n"
	}
	return a + "\n\n" + b
}

type DeleteIn struct {
	VaultID string `json:"vault_id,omitempty" jsonschema:"optional: the vault the note must be in"`
	NoteID  string `json:"note_id" jsonschema:"the note to delete"`
	Confirm bool   `json:"confirm" jsonschema:"must be true: deleting cannot be undone"`
}

type DeleteOut struct {
	Deleted NoteInfo `json:"deleted"`
}

func (t *tools) deleteNote(ctx context.Context, _ *mcp.CallToolRequest, in DeleteIn) (*mcp.CallToolResult, DeleteOut, error) {
	if !in.Confirm {
		return nil, DeleteOut{}, errors.New("deleting a note cannot be undone; call again with confirm: true if the user asked for it")
	}
	n, err := t.c.Note(ctx, "delete_note", in.NoteID)
	if err != nil {
		return nil, DeleteOut{}, explain(err)
	}
	if err := inVault(n, in.VaultID); err != nil {
		return nil, DeleteOut{}, err
	}
	if err := t.c.DeleteNote(ctx, "delete_note", n.VaultID, n.ID); err != nil {
		return nil, DeleteOut{}, explain(err)
	}
	return nil, DeleteOut{Deleted: infoOf(n)}, nil
}
