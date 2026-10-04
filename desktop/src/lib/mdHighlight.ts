/**
 * Markdown syntax highlighting for the editor's source pane (#267). Lines are
 * split into plain-text segments with a class name; the editor renders them
 * as spans behind the transparent textarea. No HTML strings are built, so
 * note text can never inject markup. Every character is kept in order, so
 * the layer lines up exactly with the textarea.
 */
export interface Segment {
  cls?: string;
  text: string;
}

/** Above this size highlighting is skipped: re-tokenizing on every keystroke
 * would make typing lag. */
export const MAX_HIGHLIGHT_CHARS = 150_000;

// Inline patterns, tried left to right; the earliest match wins.
const INLINE: Array<[RegExp, string]> = [
  [/`[^`\n]+`/y, "md-code"],
  [/!?\[\[[^\]\n]+\]\]/y, "md-wikilink"],
  [/!?\[[^\]\n]*\]\([^)\n]*\)/y, "md-link"],
  [/(\*\*|__)(?=\S)[^\n]*?\S\1/y, "md-strong"],
  [/(\*|_)(?=\S)[^\n*_]*?\S\1/y, "md-em"],
  [/~~(?=\S)[^\n]*?\S~~/y, "md-strike"],
];
// A tag starts a word (checked by the caller) and begins with a letter, so
// "#12" and an email's middle stay plain.
const TAG = /#[\p{L}_][\p{L}\p{N}_/-]*/uy;

function inline(text: string): Segment[] {
  const out: Segment[] = [];
  let plain = "";
  let i = 0;
  const flush = () => {
    if (plain) out.push({ text: plain });
    plain = "";
  };
  outer: while (i < text.length) {
    for (const [re, cls] of INLINE) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) {
        flush();
        out.push({ cls, text: m[0] });
        i += m[0].length;
        continue outer;
      }
    }
    if (text[i] === "#" && (i === 0 || /[\s(]/.test(text[i - 1]))) {
      TAG.lastIndex = i;
      const t = TAG.exec(text);
      if (t) {
        flush();
        out.push({ cls: "md-tag", text: t[0] });
        i += t[0].length;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  flush();
  return out;
}

export function highlightMarkdown(text: string): Segment[][] | null {
  if (text.length > MAX_HIGHLIGHT_CHARS) return null;
  const lines = text.split("\n");
  const out: Segment[][] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
        out.push([{ cls: "md-fence", text: line }]);
      } else {
        out.push(line ? [{ cls: "md-codeblock", text: line }] : []);
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      out.push([{ cls: "md-fence", text: line }]);
      continue;
    }
    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      out.push([{ cls: "md-heading", text: line }]);
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      out.push([{ cls: "md-quote", text: line }]);
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      out.push([{ cls: "md-rule", text: line }]);
      continue;
    }
    const list = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(\[[ xX]\](?=\s|$))?/);
    if (list) {
      const segs: Segment[] = [{ cls: "md-list", text: list[1] }];
      let rest = line.slice(list[1].length);
      if (list[2]) {
        segs.push({ cls: "md-task", text: list[2] });
        rest = rest.slice(list[2].length);
      }
      out.push([...segs, ...inline(rest)]);
      continue;
    }
    out.push(line ? inline(line) : []);
  }
  return out;
}
