/**
 * Plain-text opening of a note for the [[link]] hover preview (#425): front
 * matter, a leading heading that repeats the title, code blocks and markdown
 * syntax are dropped, and the text is cut at a word boundary. Plain text only,
 * so a preview can never inject markup.
 */
export function previewExcerpt(content: string, title: string, max = 320): string {
  let text = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  text = text.replace(/```[\s\S]*?(```|$)/g, "");
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
        .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, "$2")
        .trim(),
    )
    .filter((line) => line !== "");
  if (lines.length > 0 && lines[0].toLowerCase() === title.trim().toLowerCase()) lines.shift();
  const joined = lines.join("\n");
  if (joined.length <= max) return joined;
  const cut = joined.slice(0, max);
  const space = cut.search(/\s\S*$/);
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}
