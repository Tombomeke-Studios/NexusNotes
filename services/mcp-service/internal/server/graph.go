package server

import (
	"regexp"
	"strings"

	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/nexus"
)

var (
	// [[Target]], [[Target#Heading]], [[Target|label]]; group 1 is the "!"
	// of an ![[embed]].
	wikiLink   = regexp.MustCompile(`(!?)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]`)
	fencedCode = regexp.MustCompile("(?ms)^\\s*(```|~~~).*?^\\s*(```|~~~)\\s*$")
	inlineCode = regexp.MustCompile("`[^`\n]*`")
)

// attachmentExtensions are the file extensions of attachments (#565): a
// [[name.pdf]] link points at a note's attached file, not at a note. The sync
// service (service/link.go) and the desktop app keep the same list.
var attachmentExtensions = func() map[string]bool {
	set := map[string]bool{}
	for _, ext := range strings.Fields(`png jpg jpeg gif webp bmp avif svg ico tif tiff heic
		pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt csv epub
		mp3 wav ogg oga m4a flac aac opus mp4 webm mov mkv avi m4v
		zip rar 7z tar gz`) {
		set[ext] = true
	}
	return set
}()

// isAttachmentName reports whether a link target names an attached file (by
// its extension) rather than a note.
func isAttachmentName(target string) bool {
	base := target[strings.LastIndex(target, "/")+1:]
	dot := strings.LastIndex(base, ".")
	return dot > 0 && attachmentExtensions[strings.ToLower(base[dot+1:])]
}

// linkTargets returns the targets of the note's wiki-links, ignoring links
// inside code, which the app does not treat as links either, and attachment
// embeds and links to attached files, which point at files, not notes.
func linkTargets(content string) []string {
	content = fencedCode.ReplaceAllString(content, "")
	content = inlineCode.ReplaceAllString(content, "")
	var out []string
	for _, m := range wikiLink.FindAllStringSubmatch(content, -1) {
		if t := strings.TrimSpace(m[2]); t != "" && m[1] != "!" && !isAttachmentName(t) {
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
