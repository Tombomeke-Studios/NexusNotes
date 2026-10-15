import { stripCode } from "./wikilinks";

/**
 * A GFM task list item (#560): a bullet (`-`, `*`, `+`) or ordered marker
 * (`1.`, `1)`) at the start of the line (after indentation or blockquote
 * markers), then `[ ]`, `[x]` or `[X]` followed by the item's text. Anchoring
 * it keeps `- [ ]` in the middle of a sentence from counting as a task.
 */
const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\][ \t]+\S)/;
/** The marker part of TASK_LINE alone: what a task line keeps once its code is stripped. */
const TASK_MARKER = /^(?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\]/;

/**
 * Toggle the checkbox state of the taskIndex-th task item (in document
 * order, the order the preview renders its checkboxes in) inside markdown
 * content. Lines inside fenced code blocks are not tasks. Returns the content
 * unchanged when the index is out of range.
 */
export function toggleTask(content: string, taskIndex: number): string {
  const lines = content.split("\n");
  // stripCode keeps the line count and empties lines inside fenced code; a
  // real task line keeps its marker (only inline code after it is removed).
  const visible = stripCode(content).split("\n");
  let i = -1;
  for (let n = 0; n < lines.length; n++) {
    if (!TASK_LINE.test(lines[n]) || !TASK_MARKER.test(visible[n] ?? "")) continue;
    i++;
    if (i !== taskIndex) continue;
    lines[n] = lines[n].replace(TASK_LINE, (_m, head: string, state: string, tail: string) =>
      `${head}${state === " " ? "x" : " "}${tail}`,
    );
    return lines.join("\n");
  }
  return content;
}
