package service

import (
	"reflect"
	"testing"
)

func TestParseFrontmatter_aliases_inline(t *testing.T) {
	content := "---\ntitle: My Note\naliases: [alias one, alt title]\n---\nBody text."
	meta, body := ParseFrontmatter(content)
	if meta.Title != "My Note" {
		t.Errorf("title: want %q, got %q", "My Note", meta.Title)
	}
	want := []string{"alias one", "alt title"}
	if !reflect.DeepEqual(meta.Aliases, want) {
		t.Errorf("aliases: want %v, got %v", want, meta.Aliases)
	}
	if body != "Body text." {
		t.Errorf("body: want %q, got %q", "Body text.", body)
	}
}

func TestParseFrontmatter_aliases_list(t *testing.T) {
	content := "---\naliases:\n  - first alias\n  - second alias\n---\n"
	meta, _ := ParseFrontmatter(content)
	want := []string{"first alias", "second alias"}
	if !reflect.DeepEqual(meta.Aliases, want) {
		t.Errorf("aliases: want %v, got %v", want, meta.Aliases)
	}
}

func TestParseFrontmatter_no_aliases(t *testing.T) {
	content := "---\ntitle: Plain Note\n---\nContent."
	meta, _ := ParseFrontmatter(content)
	if len(meta.Aliases) != 0 {
		t.Errorf("expected no aliases, got %v", meta.Aliases)
	}
}

func TestMergeTags_includesFrontmatterAndInline(t *testing.T) {
	content := "---\ntags: [go, backend]\n---\nThis note is #work related."
	tags := mergeTags(content)
	seen := make(map[string]bool)
	for _, tag := range tags {
		seen[tag] = true
	}
	for _, want := range []string{"go", "backend", "work"} {
		if !seen[want] {
			t.Errorf("expected tag %q in merged tags %v", want, tags)
		}
	}
}

func TestMergeTags_deduplicates(t *testing.T) {
	content := "---\ntags: [work]\n---\n#work is in front-matter and content."
	tags := mergeTags(content)
	count := 0
	for _, tag := range tags {
		if tag == "work" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("expected 'work' exactly once, got %d times in %v", count, tags)
	}
}
