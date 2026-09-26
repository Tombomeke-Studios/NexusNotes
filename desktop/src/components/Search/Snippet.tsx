import { snippetParts } from "../../lib/snippet";

/** A search-result snippet, rendered as text with the match emphasised. */
export function Snippet({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {snippetParts(text).map((part, i) =>
        part.highlight ? <em key={i}>{part.text}</em> : <span key={i}>{part.text}</span>,
      )}
    </div>
  );
}
