/**
 * Importing existing Markdown notes (#451): a picked folder (an Obsidian vault,
 * say) or loose .md files become notes, keeping their folder structure. This
 * plans the import; App creates the notes through the vault's encryption.
 */

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** The parts of a File the plan reads (a File satisfies it). */
export interface ImportFile {
  name: string;
  /** "Picked/sub/note.md" for a folder pick, "" for loose files. */
  webkitRelativePath: string;
  size: number;
  text(): Promise<string>;
}

export interface ImportPlan {
  notes: Array<{ title: string; path: string; content: string }>;
  skipped: { notMarkdown: number; existing: number; tooLarge: number };
}

const MARKDOWN = /\.(md|markdown)$/i;

export async function planImport(
  files: ImportFile[],
  existing: Array<{ title: string; path: string }>,
): Promise<ImportPlan> {
  const key = (path: string, title: string) => `${path.toLowerCase()}\u0000${title.toLowerCase()}`;
  const have = new Set(existing.map((n) => key(n.path, n.title)));
  const plan: ImportPlan = { notes: [], skipped: { notMarkdown: 0, existing: 0, tooLarge: 0 } };

  for (const f of files) {
    // The picked folder itself is the vault root; hidden folders (.obsidian,
    // .trash, .git) are app data, not notes.
    const segments = (f.webkitRelativePath || f.name).split("/").slice(f.webkitRelativePath ? 1 : 0);
    if (segments.some((s) => s.startsWith("."))) continue;
    if (!MARKDOWN.test(f.name)) {
      plan.skipped.notMarkdown++;
      continue;
    }
    if (f.size > MAX_IMPORT_BYTES) {
      plan.skipped.tooLarge++;
      continue;
    }
    const title = f.name.replace(MARKDOWN, "");
    const path = segments.slice(0, -1).join("/");
    if (have.has(key(path, title))) {
      plan.skipped.existing++;
      continue;
    }
    have.add(key(path, title));
    plan.notes.push({ title, path, content: (await f.text()).replace(/\r\n/g, "\n") });
  }
  return plan;
}
