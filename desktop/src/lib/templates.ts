import type { Note } from "./types";
import { toIsoDate } from "./daily";

/**
 * Note templates (#155): notes living in the vault's "Templates" folder are
 * offered by the Ctrl+T insert-template picker, and the daily-note template
 * is user-editable in Settings. Both support {{date}}, {{time}} and
 * {{title}} variables.
 */

/** Top-level folder (case-insensitive) whose notes act as templates. */
export const TEMPLATES_FOLDER = "Templates";

export const DEFAULT_DAILY_TEMPLATE = "# {{date}}\n\n## Log\n\n- [ ] First entry\n\n#daily";

export interface TemplateVars {
  date: string;
  time: string;
  title: string;
}

/** The variable values for "now" and the note being written into. */
export function templateVars(now: Date, title: string): TemplateVars {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return { date: toIsoDate(now), time: `${hh}:${mm}`, title };
}

/** Substitutes {{date}}/{{time}}/{{title}} (whitespace-tolerant); anything else is left as typed. */
export function renderTemplate(content: string, vars: TemplateVars): string {
  return content.replace(
    /\{\{\s*(date|time|title)\s*\}\}/g,
    (_, key: keyof TemplateVars) => vars[key],
  );
}

/** Notes inside the Templates folder (or its subfolders), sorted by title. */
export function listTemplates(notes: Note[]): Note[] {
  const folder = TEMPLATES_FOLDER.toLowerCase();
  return notes
    .filter((n) => {
      const p = n.path.toLowerCase();
      return p === folder || p.startsWith(`${folder}/`);
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}
