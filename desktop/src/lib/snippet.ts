export interface SnippetPart {
  text: string;
  highlight: boolean;
}

/**
 * Splits a search snippet into plain and highlighted parts. Snippets are
 * plain text (raw note content, from the server or the client-side search)
 * in which only `<em>` / `</em>` mark the match. Everything else, including
 * any markup inside a note, stays literal text: snippets must never be
 * rendered as HTML, or a note's content could run script in the app.
 */
export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let highlight = false;
  for (const piece of snippet.split(/(<\/?em>)/)) {
    if (piece === "<em>") {
      highlight = true;
    } else if (piece === "</em>") {
      highlight = false;
    } else if (piece !== "") {
      parts.push({ text: piece, highlight });
    }
  }
  return parts;
}
