const TASK_RE = /([-*])(\s+)\[( |x)\]/g;

/**
 * Toggle the checkbox state of the taskIndex-th task item (in document
 * order) inside markdown content. Returns the content unchanged when the
 * index is out of range.
 */
export function toggleTask(content: string, taskIndex: number): string {
  let i = -1;
  return content.replace(TASK_RE, (match, bullet, space, state) => {
    i++;
    if (i !== taskIndex) return match;
    return `${bullet}${space}[${state === "x" ? " " : "x"}]`;
  });
}
