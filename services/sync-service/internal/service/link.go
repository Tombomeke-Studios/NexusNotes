package service

import (
	"regexp"
	"strings"
)

// linkRe matches Obsidian-style [[wikilinks]] including optional #anchor and
// |alias parts; group 1 is the "!" of an ![[embed]].
var linkRe = regexp.MustCompile(`(!?)\[\[([^\[\]\|#]+?)(?:#([^\[\]\|]+?))?(?:\|[^\[\]]+?)?\]\]`)

// attachmentExtensions are the file extensions of attachments (#565): a
// [[name.pdf]] link points at a note's attached file, not at a note. The
// desktop app (lib/wikilinks.ts) and the MCP server keep the same list.
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

// ParsedLink holds the parts of a [[wikilink]].
type ParsedLink struct {
	TargetTitle string
	Anchor      string
}

// ParseLinks extracts all unique [[wikilinks]] from markdown content. Text in
// code spans and fenced code blocks is code, not links (#454).
func ParseLinks(content string) []ParsedLink {
	matches := linkRe.FindAllStringSubmatch(stripCode(content), -1)
	links := make([]ParsedLink, 0, len(matches))
	seen := make(map[string]bool)

	for _, m := range matches {
		title := strings.TrimSpace(m[2])
		anchor := strings.TrimSpace(m[3])
		// An ![[embed]] shows an attachment and [[file.pdf]] links one (#565);
		// neither is a link to a note.
		if m[1] == "!" || isAttachmentName(title) {
			continue
		}
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

// stripCode blanks fenced code blocks (``` or ~~~, closed by a fence of the
// same character at least as long) and inline code spans (a backtick run
// closed by a run of the same length), so their text is never read as links.
// An unclosed span or fence is left as text, as markdown renders it.
func stripCode(content string) string {
	lines := strings.Split(content, "\n")
	var fence string
	for i, line := range lines {
		trimmed := strings.TrimLeft(line, " \t")
		if fence != "" {
			if strings.HasPrefix(trimmed, fence) && strings.Trim(trimmed, string(fence[0])+" \t") == "" {
				fence = ""
			}
			lines[i] = ""
			continue
		}
		if f := openingFence(trimmed); f != "" && hasClosingFence(lines[i+1:], f) {
			fence = f
			lines[i] = ""
			continue
		}
		lines[i] = stripInlineCode(line)
	}
	return strings.Join(lines, "\n")
}

func openingFence(line string) string {
	for _, c := range []string{"`", "~"} {
		n := len(line) - len(strings.TrimLeft(line, c))
		if n >= 3 {
			return strings.Repeat(c, n)
		}
	}
	return ""
}

func hasClosingFence(rest []string, fence string) bool {
	for _, l := range rest {
		t := strings.TrimLeft(l, " \t")
		if strings.HasPrefix(t, fence) && strings.Trim(t, string(fence[0])+" \t") == "" {
			return true
		}
	}
	return false
}

func stripInlineCode(line string) string {
	var b strings.Builder
	for i := 0; i < len(line); {
		if line[i] != '`' {
			b.WriteByte(line[i])
			i++
			continue
		}
		run := 0
		for i+run < len(line) && line[i+run] == '`' {
			run++
		}
		ticks := line[i : i+run]
		end := closingRun(line, i+run, run)
		if end < 0 {
			b.WriteString(ticks)
			i += run
			continue
		}
		i = end + run
	}
	return b.String()
}

// closingRun finds the next backtick run of exactly n from start, or -1.
func closingRun(line string, start, n int) int {
	for i := start; i < len(line); {
		if line[i] != '`' {
			i++
			continue
		}
		run := 0
		for i+run < len(line) && line[i+run] == '`' {
			run++
		}
		if run == n {
			return i
		}
		i += run
	}
	return -1
}
