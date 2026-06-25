package service

import (
	"testing"
)

func TestParseLinks_basic(t *testing.T) {
	links := ParseLinks("See [[Project Ideas]] and [[Meeting Notes]].")
	if len(links) != 2 {
		t.Fatalf("want 2 links, got %d", len(links))
	}
	if links[0].TargetTitle != "Project Ideas" {
		t.Errorf("want 'Project Ideas', got %q", links[0].TargetTitle)
	}
	if links[1].TargetTitle != "Meeting Notes" {
		t.Errorf("want 'Meeting Notes', got %q", links[1].TargetTitle)
	}
}

func TestParseLinks_withAnchor(t *testing.T) {
	links := ParseLinks("Read [[Architecture#Data Flow]] for details.")
	if len(links) != 1 {
		t.Fatalf("want 1 link, got %d", len(links))
	}
	if links[0].TargetTitle != "Architecture" {
		t.Errorf("want 'Architecture', got %q", links[0].TargetTitle)
	}
	if links[0].Anchor != "Data Flow" {
		t.Errorf("want 'Data Flow', got %q", links[0].Anchor)
	}
}

func TestParseLinks_withAlias(t *testing.T) {
	links := ParseLinks("Check [[Architecture|the arch doc]] here.")
	if len(links) != 1 {
		t.Fatalf("want 1 link, got %d", len(links))
	}
	if links[0].TargetTitle != "Architecture" {
		t.Errorf("want 'Architecture', got %q", links[0].TargetTitle)
	}
}

func TestParseLinks_deduplicated(t *testing.T) {
	links := ParseLinks("[[Ideas]] and [[Ideas]] again.")
	if len(links) != 1 {
		t.Errorf("want 1 deduplicated link, got %d", len(links))
	}
}

func TestParseLinks_empty(t *testing.T) {
	links := ParseLinks("No links here.")
	if len(links) != 0 {
		t.Errorf("want 0 links, got %d", len(links))
	}
}

func TestParseLinks_noContent(t *testing.T) {
	links := ParseLinks("")
	if links == nil {
		t.Error("want empty slice, got nil")
	}
	if len(links) != 0 {
		t.Errorf("want 0 links, got %d", len(links))
	}
}

func TestParseLinks_anchorAndAlias(t *testing.T) {
	links := ParseLinks("See [[Docs#Setup|setup guide]].")
	if len(links) != 1 {
		t.Fatalf("want 1 link, got %d", len(links))
	}
	if links[0].TargetTitle != "Docs" {
		t.Errorf("want 'Docs', got %q", links[0].TargetTitle)
	}
	if links[0].Anchor != "Setup" {
		t.Errorf("want 'Setup', got %q", links[0].Anchor)
	}
}

func TestParseLinks_multilineContent(t *testing.T) {
	content := "# My Note\n\nSee [[Note A]].\n\nAlso [[Note B#Section]]."
	links := ParseLinks(content)
	if len(links) != 2 {
		t.Fatalf("want 2 links, got %d", len(links))
	}
}
