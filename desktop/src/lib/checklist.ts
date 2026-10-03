import { extractLinks } from "./wikilinks";

/**
 * First-launch checklist (#447): four first steps shown in the sidebar for a
 * new account. Started when the account's first vault is seeded, so existing
 * users never see it; it ticks itself from what the user does and hides when
 * dismissed or complete. Kept in localStorage (per device, not synced).
 */

export type ChecklistStepId = "create-note" | "link-notes" | "open-graph" | "open-palette";

export const CHECKLIST_STEPS: Array<{ id: ChecklistStepId; label: string; hint: string }> = [
  { id: "create-note", label: "Create a note", hint: "Ctrl+N" },
  { id: "link-notes", label: "Link two notes", hint: "[[ ]]" },
  { id: "open-graph", label: "Open the graph", hint: "Ctrl+G" },
  { id: "open-palette", label: "Open the palette", hint: "Ctrl+Shift+P" },
];

export interface ChecklistState {
  done: ChecklistStepId[];
  dismissed: boolean;
}

const KEY = "nexus_checklist";
const listeners = new Set<() => void>();

export function loadChecklist(): ChecklistState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChecklistState;
    return Array.isArray(parsed.done) ? { done: parsed.done, dismissed: !!parsed.dismissed } : null;
  } catch {
    return null;
  }
}

function save(state: ChecklistState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: the checklist just won't persist */
  }
  for (const l of listeners) l();
}

export function startChecklist() {
  save({ done: [], dismissed: false });
}

export function completeStep(id: ChecklistStepId) {
  const state = loadChecklist();
  if (!state || state.done.includes(id)) return;
  save({ ...state, done: [...state.done, id] });
}

export function dismissChecklist() {
  const state = loadChecklist();
  if (state) save({ ...state, dismissed: true });
}

export function checklistVisible(state: ChecklistState | null): boolean {
  return !!state && !state.dismissed && state.done.length < CHECKLIST_STEPS.length;
}

export function subscribeChecklist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Links in `now` that weren't in `before` and point at an existing note (lower-cased titles). */
export function addedLinks(before: string, now: string, titles: Set<string>): string[] {
  const had = new Set(extractLinks(before).map((l) => l.toLowerCase()));
  return extractLinks(now).filter((l) => !had.has(l.toLowerCase()) && titles.has(l.toLowerCase()));
}
