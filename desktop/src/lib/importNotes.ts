/**
 * Importing existing Markdown notes (#451): a picked folder (an Obsidian vault,
 * say) or loose .md files become notes, keeping their folder structure. Every
 * other file in the folder becomes an attachment (#551): of the notes that link
 * or embed it, or else of one "Files from …" note, so nothing is left behind.
 *
 * planImport works out what to create; runImport creates it through callbacks
 * App supplies (the vault's encryption lives there), and summarizeImport words
 * the result.
 */

/** Notes larger than this are skipped. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** The server takes attachments up to 25 MiB; an e2ee vault adds a few bytes of nonce and tag. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 - 1024;

/** The parts of a File the plan reads (a File satisfies it). */
export interface ImportFile {
  name: string;
  /** "Picked/sub/note.md" for a folder pick, "" for loose files. */
  webkitRelativePath: string;
  size: number;
  type?: string;
  text(): Promise<string>;
}

export interface PlannedAttachment<F extends ImportFile = ImportFile> {
  file: F;
  /** The name it is uploaded under: the file's own, numbered if the note already has one by that name. */
  name: string;
}

export interface PlannedNote<F extends ImportFile = ImportFile> {
  title: string;
  path: string;
  /** With links to imported files rewritten to `![[name]]` / `[[name]]`, so they resolve to the attachment. */
  content: string;
  attachments: PlannedAttachment<F>[];
}

export interface ImportPlan<F extends ImportFile = ImportFile> {
  notes: PlannedNote<F>[];
  skipped: {
    /** Notes (and their files) the vault already has. */
    existing: number;
    /** Names of the files over the size limit. */
    tooLarge: string[];
  };
}

const MARKDOWN = /\.(md|markdown)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/** Joins and normalises a vault-relative path; null when it climbs out of the vault. */
function normalisePath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * Finds the imported file a link points at, the way Obsidian resolves it: a
 * path relative to the note, a path from the vault root, or else the file
 * whose path ends in the link (a bare name), nearest the note first.
 */
function makeResolver(files: Map<string, unknown>) {
  const paths = [...files.keys()];
  return (target: string, noteDir: string): string | undefined => {
    const t = target.replace(/\\/g, "/").trim();
    if (!t) return undefined;
    for (const candidate of [noteDir ? `${noteDir}/${t}` : t, t]) {
      const p = normalisePath(candidate);
      if (p && files.has(p)) return p;
    }
    const tail = normalisePath(t)?.toLowerCase();
    if (!tail) return undefined;
    const hits = paths.filter((p) => {
      const lower = p.toLowerCase();
      return lower === tail || lower.endsWith(`/${tail}`);
    });
    hits.sort((a, b) => Number(dirOf(b) === noteDir) - Number(dirOf(a) === noteDir) || a.length - b.length);
    return hits[0];
  };
}

/** Applies fn to the text outside fenced code blocks; fenced lines are kept as they are. */
function outsideCode(text: string, fn: (prose: string) => string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence = "";
  const flush = () => {
    if (prose.length) out.push(fn(prose.join("\n")));
    prose = [];
  };
  for (const line of text.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = "";
    } else if (marker) {
      flush();
      fence = marker;
      out.push(line);
    } else prose.push(line);
  }
  flush();
  return out.join("\n");
}

const WIKI_LINK = /(!?)\[\[([^[\]|#^]+?)((?:[#^][^[\]|]*)?)((?:\|[^[\]]*)?)\]\]/g;
const MD_LINK = /(!?)\[([^\]]*)\]\((?:<([^>]+)>|([^()\s]+))(?:\s+"[^"]*")?\)/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decodeLinkPath(raw: string): string {
  const path = raw.replace(/[?#].*$/, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
}

export async function planImport<F extends ImportFile>(
  files: F[],
  existing: Array<{ title: string; path: string }>,
): Promise<ImportPlan<F>> {
  const key = (path: string, title: string) => `${path.toLowerCase()}\u0000${title.toLowerCase()}`;
  const have = new Set(existing.map((n) => key(n.path, n.title)));
  const plan: ImportPlan<F> = { notes: [], skipped: { existing: 0, tooLarge: [] } };

  // The picked folder itself is the vault root; hidden folders (.obsidian,
  // .trash, .git) are app data, not notes.
  const root = files.find((f) => f.webkitRelativePath)?.webkitRelativePath.split("/")[0] ?? "";
  const notes: Array<{ title: string; path: string; file: F }> = [];
  const attachable = new Map<string, F>();
  for (const f of files) {
    const segments = (f.webkitRelativePath || f.name).split("/").slice(f.webkitRelativePath ? 1 : 0);
    if (segments.some((s) => s.startsWith("."))) continue;
    const isNote = MARKDOWN.test(f.name);
    if (f.size > (isNote ? MAX_IMPORT_BYTES : MAX_ATTACHMENT_BYTES)) {
      plan.skipped.tooLarge.push(f.name);
      continue;
    }
    if (!isNote) {
      attachable.set(segments.join("/"), f);
      continue;
    }
    const title = f.name.replace(MARKDOWN, "");
    const path = segments.slice(0, -1).join("/");
    if (have.has(key(path, title))) {
      plan.skipped.existing++;
      continue;
    }
    have.add(key(path, title));
    notes.push({ title, path, file: f });
  }

  const resolve = makeResolver(attachable);
  const referenced = new Set<string>();
  for (const n of notes) {
    const attachments: PlannedAttachment<F>[] = [];
    const nameOf = new Map<string, string>();
    // The name the file is attached to this note under; one note can't have
    // two attachments of the same name, or its embeds couldn't tell them apart.
    const attach = (filePath: string): string => {
      const known = nameOf.get(filePath);
      if (known) return known;
      const file = attachable.get(filePath)!;
      const taken = new Set(attachments.map((a) => a.name.toLowerCase()));
      let name = file.name;
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = numbered(file.name, i);
      attachments.push({ file, name });
      nameOf.set(filePath, name);
      referenced.add(filePath);
      return name;
    };
    const raw = (await n.file.text()).replace(/\r\n/g, "\n");
    const content = outsideCode(raw, (prose) =>
      prose
        .replace(WIKI_LINK, (match, bang: string, target: string, sub: string, alias: string) => {
          const hit = resolve(target, n.path);
          return hit ? `${bang}[[${attach(hit)}${sub}${alias}]]` : match;
        })
        .replace(MD_LINK, (match, bang: string, text: string, angled?: string, bare?: string) => {
          const target = angled ?? bare ?? "";
          if (URL_SCHEME.test(target) || target.startsWith("#")) return match;
          const hit = resolve(decodeLinkPath(target), n.path);
          if (!hit) return match;
          const label = text.replace(/[|[\]]/g, " ").trim();
          return `${bang}[[${attach(hit)}${label ? `|${label}` : ""}]]`;
        }),
    );
    plan.notes.push({ title: n.title, path: n.path, content, attachments });
  }

  // Files no imported note links to get a note of their own, which embeds
  // them so they show up (and stay reachable) like any other attachment.
  const loose = [...attachable].filter(([p]) => !referenced.has(p));
  if (loose.length > 0) {
    const title = root ? `Files from ${root}` : "Imported files";
    if (have.has(key("", title))) {
      plan.skipped.existing += loose.length;
    } else {
      const attachments: PlannedAttachment<F>[] = [];
      const taken = new Set<string>();
      for (const [, file] of loose) {
        let name = file.name;
        for (let i = 2; taken.has(name.toLowerCase()); i++) name = numbered(file.name, i);
        taken.add(name.toLowerCase());
        attachments.push({ file, name });
      }
      // One paragraph each: an image in a list item renders beside its bullet.
      const blocks = attachments.map((a) =>
        IMAGE.test(a.name) || a.file.type?.startsWith("image/") ? `![[${a.name}]]` : `[[${a.name}]]`,
      );
      const content = `Imported files that no note linked to.\n\n${blocks.join("\n\n")}\n`;
      plan.notes.push({ title, path: "", content, attachments });
    }
  }
  return plan;
}

export interface ImportCallbacks<F extends ImportFile, N extends { id: string }> {
  /** Creates the note (through the vault's encryption) and returns it. */
  createNote(note: { title: string; path: string; content: string }): Promise<N>;
  /** Uploads a file as an attachment of the note (through the vault's encryption). */
  uploadAttachment(noteId: string, file: File): Promise<unknown>;
  /** Called before each note or file: done so far, out of total. */
  onProgress?(done: number, total: number): void;
  /** Turns a planned file into the File to upload under the given name. */
  toFile?(file: F, name: string): File;
}

export interface ImportResult<N> {
  created: N[];
  /** Attachments uploaded. */
  files: number;
  /** Names of the notes and files that could not be created or uploaded. */
  failed: string[];
  skipped: ImportPlan["skipped"];
}

function defaultToFile(file: ImportFile, name: string): File {
  const blob = file as unknown as Blob;
  if (file instanceof File && file.name === name) return file;
  return new File([blob], name, { type: file.type ?? "" });
}

export async function runImport<F extends ImportFile, N extends { id: string }>(
  plan: ImportPlan<F>,
  cb: ImportCallbacks<F, N>,
): Promise<ImportResult<N>> {
  const toFile = cb.toFile ?? defaultToFile;
  const total = plan.notes.reduce((sum, n) => sum + 1 + n.attachments.length, 0);
  const result: ImportResult<N> = { created: [], files: 0, failed: [], skipped: plan.skipped };
  let done = 0;
  for (const n of plan.notes) {
    cb.onProgress?.(done++, total);
    let note: N;
    try {
      note = await cb.createNote({ title: n.title, path: n.path, content: n.content });
    } catch {
      result.failed.push(`${n.title}.md`, ...n.attachments.map((a) => a.name));
      done += n.attachments.length;
      continue;
    }
    result.created.push(note);
    for (const a of n.attachments) {
      cb.onProgress?.(done++, total);
      try {
        await cb.uploadAttachment(note.id, toFile(a.file, a.name));
        result.files++;
      } catch {
        result.failed.push(a.name);
      }
    }
  }
  return result;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function nameList(names: string[], max = 5): string {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/** The summary toast: what was imported, what was skipped and why, what failed. */
export function summarizeImport(r: ImportResult<unknown>): { message: string; kind: "success" | "error" } {
  const sentences = [`Imported ${plural(r.created.length, "note")} and ${plural(r.files, "file")}.`];
  const skipped = r.skipped.existing + r.skipped.tooLarge.length;
  if (skipped > 0) {
    const why: string[] = [];
    if (r.skipped.existing > 0) why.push(`${r.skipped.existing} already in the vault`);
    if (r.skipped.tooLarge.length > 0) {
      why.push(
        `${r.skipped.tooLarge.length} over the size limit (5 MB per note, 25 MB per file): ${nameList(r.skipped.tooLarge)}`,
      );
    }
    sentences.push(`Skipped ${skipped}: ${why.join("; ")}.`);
  }
  if (r.failed.length > 0) sentences.push(`Failed: ${nameList(r.failed)}.`);
  return { message: sentences.join(" "), kind: r.failed.length > 0 ? "error" : "success" };
}
