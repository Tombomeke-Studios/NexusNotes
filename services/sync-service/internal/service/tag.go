package service

import (
	"regexp"
	"strings"
)

// tagRe matches #tag tokens that are preceded by whitespace or start of string.
// Tags must start with a letter and may contain letters, digits, hyphens, underscores, or slashes.
var tagRe = regexp.MustCompile(`(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/\-]*)`)

// codeRe strips fenced code blocks (```...```) and inline code (`...`) before tag extraction
// so that tokens like #include inside code are ignored.
var codeRe = regexp.MustCompile("(?s)```[^`]*```|`[^`\n]+`")

// ParseTags extracts unique, normalised #tag tokens from markdown content.
// Tags inside fenced code blocks and inline code spans are ignored.
// All tags are lowercased.
func ParseTags(content string) []string {
	stripped := codeRe.ReplaceAllString(content, " ")
	matches := tagRe.FindAllStringSubmatch(stripped, -1)

	seen := make(map[string]bool)
	tags := make([]string, 0, len(matches))
	for _, m := range matches {
		tag := strings.ToLower(strings.TrimSpace(m[1]))
		if seen[tag] {
			continue
		}
		seen[tag] = true
		tags = append(tags, tag)
	}
	return tags
}
