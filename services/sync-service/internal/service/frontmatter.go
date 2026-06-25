package service

import (
	"strings"
)

// FrontmatterMeta holds parsed YAML front-matter fields.
type FrontmatterMeta struct {
	Title   string
	Tags    []string
	Aliases []string
	Created string
	Updated string
}

// ParseFrontmatter extracts YAML front-matter from markdown content.
// It supports the --- delimited block at the start of a document.
// Returns the parsed metadata and the remaining body (front-matter stripped).
// If no valid front-matter is found, meta is zero-value and body equals content.
func ParseFrontmatter(content string) (FrontmatterMeta, string) {
	var meta FrontmatterMeta

	if !strings.HasPrefix(content, "---\n") {
		return meta, content
	}

	rest := content[4:] // skip opening "---\n"
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return meta, content // unterminated — return original
	}

	block := rest[:end]
	body := strings.TrimLeft(rest[end+4:], "\n") // skip closing "\n---" + any blank separator lines

	meta = parseFrontmatterBlock(block)
	return meta, body
}

func parseFrontmatterBlock(block string) FrontmatterMeta {
	var meta FrontmatterMeta
	lines := strings.Split(block, "\n")
	var listKey string // active key when parsing a YAML list (- item format)

	for _, line := range lines {
		if strings.HasPrefix(line, "  - ") || strings.HasPrefix(line, "- ") {
			// List item under the current listKey
			item := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(line, "  - "), "- "))
			switch listKey {
			case "tags":
				meta.Tags = append(meta.Tags, item)
			case "aliases":
				meta.Aliases = append(meta.Aliases, item)
			}
			continue
		}

		colon := strings.Index(line, ":")
		if colon < 0 {
			listKey = ""
			continue
		}

		key := strings.TrimSpace(line[:colon])
		value := strings.TrimSpace(line[colon+1:])
		listKey = "" // reset list mode until we see a blank value

		switch key {
		case "title":
			meta.Title = value
		case "created":
			meta.Created = value
		case "updated":
			meta.Updated = value
		case "tags":
			if value == "" {
				listKey = "tags" // next lines are list items
			} else {
				meta.Tags = parseInlineList(value)
			}
		case "aliases":
			if value == "" {
				listKey = "aliases"
			} else {
				meta.Aliases = parseInlineList(value)
			}
		}
	}
	return meta
}

// parseInlineList parses "[item1, item2, item3]" into a string slice.
func parseInlineList(s string) []string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		item := strings.TrimSpace(p)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}
