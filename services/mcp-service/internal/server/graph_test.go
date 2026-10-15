package server

import (
	"reflect"
	"testing"

	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/nexus"
)

// Attachment embeds and links to attached files are not note links (#565).
func TestLinkTargets_IgnoresAttachments(t *testing.T) {
	content := "![[beach.png]] ![[photo.JPG|300]] ![[Diagram]] [[report.pdf]] [[assets/song.mp3|listen]] [[Real note]] [[v2.0 plan]]"
	got := linkTargets(content)
	if want := []string{"Real note", "v2.0 plan"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("linkTargets = %q, want %q", got, want)
	}
}

func TestBuildGraph_EmbedIsNoEdge(t *testing.T) {
	notes := []nexus.Note{
		{ID: "1", Title: "Trip", Content: "![[Diagram]] and [[Packing]]"},
		{ID: "2", Title: "Diagram"},
		{ID: "3", Title: "Packing"},
	}
	out := buildGraph(notes)
	if len(out.Edges) != 1 || out.Edges[0].Target != "3" {
		t.Fatalf("edges = %+v, want only Trip -> Packing", out.Edges)
	}
}

func TestIsAttachmentName(t *testing.T) {
	for name, want := range map[string]bool{"a/b/Scan.PDF": true, "Meeting 2026.10.15": false, ".png": false, "Notes": false} {
		if got := isAttachmentName(name); got != want {
			t.Errorf("isAttachmentName(%q) = %v, want %v", name, got, want)
		}
	}
}
