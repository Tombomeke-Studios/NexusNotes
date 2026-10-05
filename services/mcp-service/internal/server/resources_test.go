package server

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func readResource(t *testing.T, cs *mcp.ClientSession, uri string) (string, error) {
	t.Helper()
	res, err := cs.ReadResource(context.Background(), &mcp.ReadResourceParams{URI: uri})
	if err != nil {
		return "", err
	}
	return res.Contents[0].Text, nil
}

func TestResources_BrowseVaultToNote(t *testing.T) {
	cs := connect(t, newFake(t))
	ctx := context.Background()

	list, err := cs.ListResources(ctx, nil)
	if err != nil || len(list.Resources) != 1 || list.Resources[0].URI != "nexusnotes://vaults" {
		t.Fatalf("resources/list: %+v %v", list, err)
	}
	templates, err := cs.ListResourceTemplates(ctx, nil)
	if err != nil || len(templates.ResourceTemplates) != 3 {
		t.Fatalf("templates: %+v %v", templates, err)
	}

	vaults, err := readResource(t, cs, "nexusnotes://vaults")
	if err != nil || !strings.Contains(vaults, "[Work](nexusnotes://vault/v1/)") || !strings.Contains(vaults, "Diary (end-to-end encrypted") {
		t.Fatalf("vaults: %q %v", vaults, err)
	}
	listing, err := readResource(t, cs, "nexusnotes://vault/v1/")
	if err != nil || !strings.Contains(listing, "## Projects/Old") || !strings.Contains(listing, "[Alpha](nexusnotes://vault/v1/note/Projects/Alpha)") {
		t.Fatalf("listing: %q %v", listing, err)
	}
	note, err := readResource(t, cs, "nexusnotes://vault/v1/note/Projects/Alpha")
	if err != nil || !strings.HasPrefix(note, "Back to [[plan]]") {
		t.Fatalf("note: %q %v", note, err)
	}
	tags, err := readResource(t, cs, "nexusnotes://vault/v1/tags")
	if err != nil || !strings.Contains(tags, "- #b (3)") {
		t.Fatalf("tags: %q %v", tags, err)
	}
}

func TestResources_RefuseEncryptedAndMissing(t *testing.T) {
	cs := connect(t, newFake(t))
	if _, err := readResource(t, cs, "nexusnotes://vault/v2/"); err == nil || !strings.Contains(err.Error(), "end-to-end encrypted") {
		t.Fatalf("encrypted vault: %v", err)
	}
	if _, err := readResource(t, cs, "nexusnotes://vault/v1/note/Nope"); err == nil {
		t.Fatal("missing note: no error")
	}
}

func TestNoteURI_EscapesSegments(t *testing.T) {
	if got := NoteURI("v1", "My Folder", "A note?"); got != "nexusnotes://vault/v1/note/My%20Folder/A%20note%3F" {
		t.Fatalf("NoteURI = %q", got)
	}
}

func getPrompt(t *testing.T, cs *mcp.ClientSession, name string, args map[string]string) (string, error) {
	t.Helper()
	res, err := cs.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: name, Arguments: args})
	if err != nil {
		return "", err
	}
	return res.Messages[0].Content.(*mcp.TextContent).Text, nil
}

func TestPrompts(t *testing.T) {
	fake := newFake(t)
	day := time.Date(2026, 10, 4, 8, 0, 0, 0, time.UTC)
	fake.notes[0].UpdatedAt = day                   // Plan: changed today
	fake.notes[1].UpdatedAt = day.AddDate(0, 0, -2) // Alpha: not today
	cs := connect(t, fake)

	list, err := cs.ListPrompts(context.Background(), nil)
	if err != nil || len(list.Prompts) != 4 {
		t.Fatalf("prompts/list: %+v %v", list, err)
	}
	text, err := getPrompt(t, cs, "summarize_note", map[string]string{"note_id": "n2"})
	if err != nil || !strings.Contains(text, "two or three sentences") || !strings.Contains(text, "## Alpha (in Projects)") {
		t.Fatalf("summarize_note: %q %v", text, err)
	}
	text, err = getPrompt(t, cs, "daily_reflection", map[string]string{"vault_id": "v1"})
	if err != nil || !strings.Contains(text, "## Plan") || strings.Contains(text, "## Alpha") {
		t.Fatalf("daily_reflection: %q %v", text, err)
	}
	text, err = getPrompt(t, cs, "find_connections", map[string]string{"note_id_a": "n1", "note_id_b": "n4"})
	if err != nil || !strings.Contains(text, "## Plan") || !strings.Contains(text, "## Ideas") {
		t.Fatalf("find_connections: %q %v", text, err)
	}
	if _, err := getPrompt(t, cs, "extract_tasks", map[string]string{"note_id": "s1"}); err == nil || !strings.Contains(err.Error(), "end-to-end encrypted") {
		t.Fatalf("encrypted note: %v", err)
	}
}
