package service

import (
	"testing"
)

func TestParseTags_basic(t *testing.T) {
	tags := ParseTags("This note is about #work and #project management")
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d: %v", len(tags), tags)
	}
	if tags[0] != "work" || tags[1] != "project" {
		t.Errorf("unexpected tags: %v", tags)
	}
}

func TestParseTags_deduplicated(t *testing.T) {
	tags := ParseTags("#todo Do this task #todo and that task #todo")
	if len(tags) != 1 {
		t.Fatalf("expected 1 tag, got %d: %v", len(tags), tags)
	}
	if tags[0] != "todo" {
		t.Errorf("expected 'todo', got %q", tags[0])
	}
}

func TestParseTags_caseNormalized(t *testing.T) {
	tags := ParseTags("#Work and #WORK and #work")
	if len(tags) != 1 {
		t.Fatalf("expected 1 tag after normalization, got %d: %v", len(tags), tags)
	}
	if tags[0] != "work" {
		t.Errorf("expected 'work', got %q", tags[0])
	}
}

func TestParseTags_ignoredInsideInlineCode(t *testing.T) {
	tags := ParseTags("Use `#tag` syntax here")
	if len(tags) != 0 {
		t.Errorf("expected no tags (inside inline code), got %v", tags)
	}
}

func TestParseTags_ignoredInsideFencedCode(t *testing.T) {
	tags := ParseTags("Example:\n```\n#include <stdio.h>\n```\n Real tag: #real")
	if len(tags) != 1 {
		t.Fatalf("expected 1 tag, got %d: %v", len(tags), tags)
	}
	if tags[0] != "real" {
		t.Errorf("expected 'real', got %q", tags[0])
	}
}

func TestParseTags_noMatchOnMarkdownHeading(t *testing.T) {
	// Markdown headings start with # followed by a space — must not be parsed as tags
	tags := ParseTags("# Heading\n## Section\n### Sub\nsome #tag here")
	if len(tags) != 1 {
		t.Fatalf("expected 1 tag, got %d: %v", len(tags), tags)
	}
	if tags[0] != "tag" {
		t.Errorf("expected 'tag', got %q", tags[0])
	}
}

func TestParseTags_noMatchNumericStart(t *testing.T) {
	// Tags must start with a letter; tokens like #1a2b3c (digit start) are not tags
	tags := ParseTags("hex value #1a2b3c and #123 are not tags")
	if len(tags) != 0 {
		t.Errorf("expected no tags, got %v", tags)
	}
}

func TestParseTags_noMatchMidWord(t *testing.T) {
	// # not preceded by whitespace or start-of-string must not match
	tags := ParseTags("C#, F#, and a_#b are not tags")
	if len(tags) != 0 {
		t.Errorf("expected no tags (mid-word #), got %v", tags)
	}
}

func TestParseTags_hierarchicalTag(t *testing.T) {
	tags := ParseTags("categorized as #work/deep-work")
	if len(tags) != 1 {
		t.Fatalf("expected 1 tag, got %d: %v", len(tags), tags)
	}
	if tags[0] != "work/deep-work" {
		t.Errorf("expected 'work/deep-work', got %q", tags[0])
	}
}

func TestParseTags_atStartOfContent(t *testing.T) {
	tags := ParseTags("#important note at the start")
	if len(tags) != 1 {
		t.Fatalf("expected 1 tag, got %d: %v", len(tags), tags)
	}
	if tags[0] != "important" {
		t.Errorf("expected 'important', got %q", tags[0])
	}
}

func TestParseTags_empty(t *testing.T) {
	tags := ParseTags("")
	if len(tags) != 0 {
		t.Errorf("expected no tags for empty input, got %v", tags)
	}
}

func TestParseTags_noTags(t *testing.T) {
	tags := ParseTags("Just plain text with no tags at all")
	if len(tags) != 0 {
		t.Errorf("expected no tags, got %v", tags)
	}
}
