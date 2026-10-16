/**
 * Edits a textarea through the browser's own editing commands, so the change
 * lands on its undo stack (Ctrl+Z) and goes through the textarea's input
 * event, like typing (autosave included). Falls back to setting the text
 * when the command is unavailable. Focus returns to whatever held it before.
 * Used by find & replace (#547) and the [[link]] autocomplete (#548).
 */
export function editTextarea(
  ta: HTMLTextAreaElement | null,
  start: number,
  end: number,
  insert: string,
  next: string,
  fallback: (next: string) => void,
) {
  const back = document.activeElement as HTMLElement | null;
  let done = false;
  if (ta && typeof document.execCommand === "function") {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    done = document.execCommand(insert ? "insertText" : "delete", false, insert) && ta.value === next;
  }
  if (!done) fallback(next);
  back?.focus({ preventScroll: true });
}
