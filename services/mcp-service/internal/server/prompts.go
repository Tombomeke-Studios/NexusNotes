package server

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/Tombomeke-Studios/NexusNotes/services/mcp-service/internal/nexus"
)

// Prompts are reusable instructions with a note's content filled in (#221).
func addPrompts(s *mcp.Server, t *tools) {
	noteArg := &mcp.PromptArgument{Name: "note_id", Description: "the note's id", Required: true}
	s.AddPrompt(&mcp.Prompt{
		Name: "summarize_note", Title: "Summarize a note",
		Description: "Summarize a note in two or three sentences.",
		Arguments:   []*mcp.PromptArgument{noteArg},
	}, t.notePrompt("summarize_note", "Summarize the note below in two or three sentences. Keep names, dates and decisions."))
	s.AddPrompt(&mcp.Prompt{
		Name: "extract_tasks", Title: "Extract tasks",
		Description: "List a note's action items as a Markdown checklist.",
		Arguments:   []*mcp.PromptArgument{noteArg},
	}, t.notePrompt("extract_tasks", "List every action item in the note below as a Markdown checklist (`- [ ] …`), with owner and due date when the note gives them. Leave out anything already done."))
	s.AddPrompt(&mcp.Prompt{
		Name: "daily_reflection", Title: "Daily reflection",
		Description: "Reflect on the notes written or changed on a day.",
		Arguments: []*mcp.PromptArgument{
			{Name: "vault_id", Description: "the vault", Required: true},
			{Name: "date", Description: "YYYY-MM-DD; today when omitted"},
		},
	}, t.dailyReflection)
	s.AddPrompt(&mcp.Prompt{
		Name: "find_connections", Title: "Find connections",
		Description: "Find the thematic connections between two notes.",
		Arguments: []*mcp.PromptArgument{
			{Name: "note_id_a", Description: "the first note", Required: true},
			{Name: "note_id_b", Description: "the second note", Required: true},
		},
	}, t.findConnections)
}

func userText(text string) *mcp.PromptMessage {
	return &mcp.PromptMessage{Role: "user", Content: &mcp.TextContent{Text: text}}
}

// quoteNote renders a note for a prompt: title, folder and its content.
func quoteNote(n *nexus.Note) string {
	where := ""
	if n.Path != "" {
		where = " (in " + n.Path + ")"
	}
	return fmt.Sprintf("## %s%s\n\n%s\n", n.Title, where, strings.TrimSpace(n.Content))
}

// readableNote loads a note for a prompt, refusing encrypted vaults.
func (t *tools) readableNote(ctx context.Context, tool, id string) (*nexus.Note, error) {
	if id == "" {
		return nil, errors.New("note_id is required")
	}
	n, err := t.c.Note(ctx, tool, id)
	if err != nil {
		return nil, explain(err)
	}
	if err := t.requireReadable(ctx, tool, n.VaultID); err != nil {
		return nil, err
	}
	return n, nil
}

func (t *tools) notePrompt(name, instruction string) mcp.PromptHandler {
	return func(ctx context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		n, err := t.readableNote(ctx, name, req.Params.Arguments["note_id"])
		if err != nil {
			return nil, err
		}
		return &mcp.GetPromptResult{
			Description: fmt.Sprintf("%s: %s", name, n.Title),
			Messages:    []*mcp.PromptMessage{userText(instruction + "\n\n" + quoteNote(n))},
		}, nil
	}
}

// maxReflectionNotes keeps a busy day's prompt to a reasonable size.
const maxReflectionNotes = 20

func (t *tools) dailyReflection(ctx context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	vaultID := req.Params.Arguments["vault_id"]
	if vaultID == "" {
		return nil, errors.New("vault_id is required")
	}
	date := req.Params.Arguments["date"]
	if date == "" {
		date = t.now().Format(time.DateOnly)
	}
	day, err := time.ParseInLocation(time.DateOnly, date, t.now().Location())
	if err != nil {
		return nil, errors.New("date must be YYYY-MM-DD")
	}
	if err := t.requireReadable(ctx, "daily_reflection", vaultID); err != nil {
		return nil, err
	}
	notes, err := t.c.AllNotes(ctx, "daily_reflection", vaultID)
	if err != nil {
		return nil, explain(err)
	}
	var b strings.Builder
	count := 0
	for i := range notes {
		n := &notes[i]
		local := n.UpdatedAt.In(day.Location())
		onDay := !local.Before(day) && local.Before(day.AddDate(0, 0, 1))
		isDaily := n.Path == DailyFolder && n.Title == date
		if !onDay && !isDaily {
			continue
		}
		if count == maxReflectionNotes {
			fmt.Fprintf(&b, "\n(More notes changed that day; only the first %d are included.)\n", maxReflectionNotes)
			break
		}
		b.WriteString("\n" + quoteNote(n))
		count++
	}
	if count == 0 {
		return nil, fmt.Errorf("no notes were written or changed on %s", date)
	}
	text := fmt.Sprintf("Here are the notes I wrote or changed on %s. Reflect on the day: what I worked on, what went well, what is unresolved, and one question to think about tomorrow.\n%s", date, b.String())
	return &mcp.GetPromptResult{
		Description: "daily_reflection: " + date,
		Messages:    []*mcp.PromptMessage{userText(text)},
	}, nil
}

func (t *tools) findConnections(ctx context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	a, err := t.readableNote(ctx, "find_connections", req.Params.Arguments["note_id_a"])
	if err != nil {
		return nil, err
	}
	b, err := t.readableNote(ctx, "find_connections", req.Params.Arguments["note_id_b"])
	if err != nil {
		return nil, err
	}
	text := "Find the thematic connections between the two notes below: shared ideas, tensions, and how one could build on the other. Suggest wiki-links ([[Title]]) worth adding to either note.\n\n" + quoteNote(a) + "\n" + quoteNote(b)
	return &mcp.GetPromptResult{
		Description: fmt.Sprintf("find_connections: %s / %s", a.Title, b.Title),
		Messages:    []*mcp.PromptMessage{userText(text)},
	}, nil
}
