package server

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Resources let a client browse vaults by URI (#221):
//
//	nexusnotes://vaults                          the vaults you can open
//	nexusnotes://vault/{vault_id}/               a vault's notes, with their URIs
//	nexusnotes://vault/{vault_id}/note/{path}    a note's Markdown ("Folder/Title")
//	nexusnotes://vault/{vault_id}/tags           a vault's tags with counts
const (
	scheme       = "nexusnotes://"
	vaultsURI    = scheme + "vaults"
	vaultPrefix  = scheme + "vault/"
	markdownMIME = "text/markdown"
)

func addResources(s *mcp.Server, t *tools) {
	s.AddResource(&mcp.Resource{
		URI: vaultsURI, Name: "vaults", Title: "Vaults", MIMEType: markdownMIME,
		Description: "The vaults you can open, each with the URI of its note list.",
	}, t.readVaults)
	s.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: vaultPrefix + "{vault_id}/", Name: "vault", Title: "Vault notes", MIMEType: markdownMIME,
		Description: "A vault's notes by folder, each with its URI.",
	}, t.readVaultResource)
	s.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: vaultPrefix + "{vault_id}/note/{+path}", Name: "note", Title: "Note", MIMEType: markdownMIME,
		Description: `A note's Markdown content; path is "Folder/Title".`,
	}, t.readVaultResource)
	s.AddResourceTemplate(&mcp.ResourceTemplate{
		URITemplate: vaultPrefix + "{vault_id}/tags", Name: "tags", Title: "Vault tags", MIMEType: markdownMIME,
		Description: "A vault's tags with how many notes carry each.",
	}, t.readVaultResource)
}

// NoteURI is the resource URI of a note.
func NoteURI(vaultID, folder, title string) string {
	full := strings.Trim(folder+"/"+title, "/")
	parts := strings.Split(full, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return vaultPrefix + url.PathEscape(vaultID) + "/note/" + strings.Join(parts, "/")
}

func markdown(uri, text string) *mcp.ReadResourceResult {
	return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: uri, MIMEType: markdownMIME, Text: text}}}
}

func (t *tools) readVaults(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	vaults, err := t.c.Vaults(ctx, "read_resource")
	if err != nil {
		return nil, explain(err)
	}
	var b strings.Builder
	b.WriteString("# Vaults\n\n")
	for _, v := range vaults {
		if v.E2EE() {
			fmt.Fprintf(&b, "- %s (end-to-end encrypted: not readable here)\n", v.Name)
			continue
		}
		fmt.Fprintf(&b, "- [%s](%s%s/)\n", v.Name, vaultPrefix, url.PathEscape(v.ID))
	}
	return markdown(req.Params.URI, b.String()), nil
}

// readVaultResource serves every nexusnotes://vault/... URI.
func (t *tools) readVaultResource(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	uri := req.Params.URI
	rest, ok := strings.CutPrefix(uri, vaultPrefix)
	if !ok {
		return nil, mcp.ResourceNotFoundError(uri)
	}
	rawVault, sub, _ := strings.Cut(rest, "/")
	vaultID, err := url.PathUnescape(rawVault)
	if err != nil || vaultID == "" {
		return nil, mcp.ResourceNotFoundError(uri)
	}
	if err := t.requireReadable(ctx, "read_resource", vaultID); err != nil {
		return nil, err
	}
	switch {
	case sub == "":
		return t.vaultListing(ctx, uri, vaultID)
	case sub == "tags":
		tags, err := t.c.Tags(ctx, "read_resource", vaultID)
		if err != nil {
			return nil, explain(err)
		}
		var b strings.Builder
		b.WriteString("# Tags\n\n")
		for _, tag := range tags {
			fmt.Fprintf(&b, "- #%s (%d)\n", tag.Tag, tag.Count)
		}
		return markdown(uri, b.String()), nil
	case strings.HasPrefix(sub, "note/"):
		path, err := url.PathUnescape(strings.TrimPrefix(sub, "note/"))
		if err != nil {
			return nil, mcp.ResourceNotFoundError(uri)
		}
		note, err := t.findNote(ctx, "read_resource", "", vaultID, path)
		if err != nil {
			return nil, mcp.ResourceNotFoundError(uri)
		}
		return markdown(uri, note.Content), nil
	}
	return nil, mcp.ResourceNotFoundError(uri)
}

func (t *tools) vaultListing(ctx context.Context, uri, vaultID string) (*mcp.ReadResourceResult, error) {
	notes, err := t.c.AllNotes(ctx, "read_resource", vaultID)
	if err != nil {
		return nil, explain(err)
	}
	var b strings.Builder
	b.WriteString("# Notes\n")
	folder := "\x00"
	for i := range notes {
		n := &notes[i]
		if n.Path != folder {
			folder = n.Path
			name := folder
			if name == "" {
				name = "(vault root)"
			}
			fmt.Fprintf(&b, "\n## %s\n\n", name)
		}
		fmt.Fprintf(&b, "- [%s](%s)\n", n.Title, NoteURI(vaultID, n.Path, n.Title))
	}
	if len(notes) == 0 {
		b.WriteString("\nNo notes yet.\n")
	}
	return markdown(uri, b.String()), nil
}
