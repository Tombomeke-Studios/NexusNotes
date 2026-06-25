package service

import (
	"testing"
)

func TestParseFrontmatter_empty(t *testing.T) {
	meta, body := ParseFrontmatter("just content")
	if meta.Title != "" || len(meta.Tags) != 0 {
		t.Errorf("expected empty meta, got %+v", meta)
	}
	if body != "just content" {
		t.Errorf("expected body unchanged, got %q", body)
	}
}

func TestParseFrontmatter_title(t *testing.T) {
	content := "---\ntitle: My Note\n---\nsome body"
	meta, body := ParseFrontmatter(content)
	if meta.Title != "My Note" {
		t.Errorf("expected title 'My Note', got %q", meta.Title)
	}
	if body != "some body" {
		t.Errorf("expected body 'some body', got %q", body)
	}
}

func TestParseFrontmatter_tagsInlineBrackets(t *testing.T) {
	content := "---\ntags: [work, project, todo]\n---\nbody"
	meta, _ := ParseFrontmatter(content)
	if len(meta.Tags) != 3 {
		t.Fatalf("expected 3 tags, got %d: %v", len(meta.Tags), meta.Tags)
	}
	if meta.Tags[0] != "work" || meta.Tags[1] != "project" || meta.Tags[2] != "todo" {
		t.Errorf("unexpected tags: %v", meta.Tags)
	}
}

func TestParseFrontmatter_tagsListFormat(t *testing.T) {
	content := "---\ntags:\n  - work\n  - project\n---\nbody"
	meta, _ := ParseFrontmatter(content)
	if len(meta.Tags) != 2 {
		t.Fatalf("expected 2 tags, got %d: %v", len(meta.Tags), meta.Tags)
	}
	if meta.Tags[0] != "work" || meta.Tags[1] != "project" {
		t.Errorf("unexpected tags: %v", meta.Tags)
	}
}

func TestParseFrontmatter_aliases(t *testing.T) {
	content := "---\naliases: [Other Name, Alt]\n---\nbody"
	meta, _ := ParseFrontmatter(content)
	if len(meta.Aliases) != 2 {
		t.Fatalf("expected 2 aliases, got %d: %v", len(meta.Aliases), meta.Aliases)
	}
	if meta.Aliases[0] != "Other Name" || meta.Aliases[1] != "Alt" {
		t.Errorf("unexpected aliases: %v", meta.Aliases)
	}
}

func TestParseFrontmatter_allFields(t *testing.T) {
	content := "---\ntitle: Full Note\ntags: [a, b]\naliases: [Alias]\ncreated: 2024-01-01\nupdated: 2024-06-01\n---\nbody text"
	meta, body := ParseFrontmatter(content)
	if meta.Title != "Full Note" {
		t.Errorf("title: got %q", meta.Title)
	}
	if len(meta.Tags) != 2 {
		t.Errorf("tags: got %v", meta.Tags)
	}
	if len(meta.Aliases) != 1 {
		t.Errorf("aliases: got %v", meta.Aliases)
	}
	if meta.Created != "2024-01-01" {
		t.Errorf("created: got %q", meta.Created)
	}
	if meta.Updated != "2024-06-01" {
		t.Errorf("updated: got %q", meta.Updated)
	}
	if body != "body text" {
		t.Errorf("body: got %q", body)
	}
}

func TestParseFrontmatter_noClosingDelimiter(t *testing.T) {
	// Unterminated front-matter should return empty meta and original content
	content := "---\ntitle: My Note\nno closing delimiter"
	meta, body := ParseFrontmatter(content)
	if meta.Title != "" {
		t.Errorf("expected empty meta for unterminated front-matter, got %+v", meta)
	}
	if body != content {
		t.Errorf("expected original content returned unchanged")
	}
}

func TestParseFrontmatter_bodyHasLeadingNewline(t *testing.T) {
	content := "---\ntitle: Note\n---\n\nBody starts after blank line"
	_, body := ParseFrontmatter(content)
	if body != "Body starts after blank line" {
		t.Errorf("expected body without leading newline, got %q", body)
	}
}
