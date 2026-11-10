/**
 * Every keyboard shortcut, grouped, for the shortcut reference (`?`, #452)
 * and the Settings list. Keep it in step with the handlers in App.tsx (and
 * the editor's own: Ctrl+S and Ctrl+F live in Editor.tsx, [[ in LinkSuggest.tsx,
 * Enter / Tab / Ctrl+B / Ctrl+I / Ctrl+K in lib/editorKeys.ts).
 */
export interface ShortcutGroup {
  title: string;
  items: Array<[label: string, keys: string]>;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Find and navigate",
    items: [
      ["Find and replace in the note", "Ctrl+F"],
      ["Quick open", "Ctrl+P"],
      ["Command palette", "Ctrl+Shift+P"],
      ["Global search", "Ctrl+Shift+F"],
      ["Open graph", "Ctrl+G"],
      ["Today's daily note", "Ctrl+D"],
    ],
  },
  {
    title: "Notes",
    items: [
      ["New note", "Ctrl+N"],
      ["Save", "Ctrl+S"],
      ["Insert template", "Ctrl+T"],
      ["Link to a note, with name suggestions", "[["],
      ["Continue a list, task list or quote", "Enter"],
      ["Indent / outdent the line or selection", "Tab / Shift+Tab"],
      ["Leave the editor with the keyboard", "Esc, then Tab"],
      ["Bold", "Ctrl+B"],
      ["Italic", "Ctrl+I"],
      ["Insert a link", "Ctrl+K"],
      ["Cycle edit / split / read", "Ctrl+E"],
      ["Version history", "Ctrl+Shift+H"],
    ],
  },
  {
    title: "Workspace",
    items: [
      ["Toggle sidebar", "Ctrl+Shift+B (Ctrl+B outside the editor)"],
      ["Toggle side panel", "Ctrl+."],
      ["Settings", "Ctrl+,"],
      ["This list of shortcuts", "?"],
    ],
  },
];

export const SHORTCUTS = SHORTCUT_GROUPS.flatMap((g) => g.items);

/** Whether a key press lands in something the user types into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable === true;
}
