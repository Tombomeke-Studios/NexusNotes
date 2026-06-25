package service

import (
	"regexp"
	"strings"
)

// linkRe matches Obsidian-style [[wikilinks]] including optional #anchor and |alias parts.
var linkRe = regexp.MustCompile(`\[\[([^\[\]\|#]+?)(?:#([^\[\]\|]+?))?(?:\|[^\[\]]+?)?\]\]`)

// ParsedLink holds the parts of a [[wikilink]].
type ParsedLink struct {
	TargetTitle string
	Anchor      string
}

// ParseLinks extracts all unique [[wikilinks]] from markdown content.
func ParseLinks(content string) []ParsedLink {
	matches := linkRe.FindAllStringSubmatch(content, -1)
	links := make([]ParsedLink, 0, len(matches))
	seen := make(map[string]bool)

	for _, m := range matches {
		title := strings.TrimSpace(m[1])
		anchor := strings.TrimSpace(m[2])
		key := title + "\x00" + anchor
		if seen[key] {
			continue
		}
		seen[key] = true
		links = append(links, ParsedLink{
			TargetTitle: title,
			Anchor:      anchor,
		})
	}
	return links
}
