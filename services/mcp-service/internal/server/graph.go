package server

import (
	"regexp"
	"strings"

	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/nexus"
)

var (
	// [[Target]], [[Target#Heading]], [[Target|label]].
	wikiLink   = regexp.MustCompile(`\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]`)
	fencedCode = regexp.MustCompile("(?ms)^\\s*(```|~~~).*?^\\s*(```|~~~)\\s*$")
	inlineCode = regexp.MustCompile("`[^`\n]*`")
)

// linkTargets returns the targets of the note's wiki-links, ignoring links
// inside code, which the app does not treat as links either.
func linkTargets(content string) []string {
	content = fencedCode.ReplaceAllString(content, "")
	content = inlineCode.ReplaceAllString(content, "")
	var out []string
	for _, m := range wikiLink.FindAllStringSubmatch(content, -1) {
		if t := strings.TrimSpace(m[1]); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// buildGraph makes a node per note and an edge per resolved wiki-link. A
// link resolves to "Folder/Title" first, then to a note with that title.
func buildGraph(notes []nexus.Note) GraphOut {
	byPath := map[string]string{}
	byTitle := map[string]string{}
	out := GraphOut{Nodes: []GraphNode{}, Edges: []GraphEdge{}}
	for _, n := range notes {
		out.Nodes = append(out.Nodes, GraphNode{ID: n.ID, Folder: n.Path, Title: n.Title})
		full := strings.ToLower(strings.Trim(n.Path+"/"+n.Title, "/"))
		byPath[full] = n.ID
		if _, taken := byTitle[strings.ToLower(n.Title)]; !taken {
			byTitle[strings.ToLower(n.Title)] = n.ID
		}
	}
	for _, n := range notes {
		seen := map[string]bool{}
		for _, target := range linkTargets(n.Content) {
			key := strings.ToLower(strings.TrimSuffix(strings.Trim(target, "/"), ".md"))
			id, ok := byPath[key]
			if !ok {
				id, ok = byTitle[key]
			}
			if !ok || id == n.ID || seen[id] {
				continue
			}
			seen[id] = true
			out.Edges = append(out.Edges, GraphEdge{Source: n.ID, Target: id})
		}
	}
	return out
}
