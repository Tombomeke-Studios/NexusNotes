import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Note } from "./types";
import { buildZip, type ZipEntry } from "./zip";

/**
 * Note export (#152): plain markdown (front-matter stripped), a standalone
 * HTML document rendered through the same ReactMarkdown pipeline as the
 * preview, and an Obsidian-compatible vault zip. Everything runs client-side
 * so exports of e2ee vaults never leave the device in plaintext.
 */

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/** Plain markdown export: front-matter removed, content otherwise verbatim. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "");
}

/** Makes a note title safe as a filename across platforms. */
export function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "Untitled";
}

const EXPORT_CSS = `
  body { max-width: 720px; margin: 3rem auto; padding: 0 1.5rem; color: #1a1a24;
         font: 16px/1.65 -apple-system, "Segoe UI", Roboto, sans-serif; }
  h1, h2, h3 { line-height: 1.25; }
  pre { background: #f4f4f8; padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 0.92em; }
  blockquote { border-left: 3px solid #c7c7d4; margin-left: 0; padding-left: 1rem; color: #55556a; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d8d8e2; padding: 5px 10px; }
  img { max-width: 100%; }
`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Renders the note's markdown body to an HTML fragment (same pipeline as the preview). */
export function noteBodyToHtml(content: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, stripFrontmatter(content)),
  );
}

/** A complete, self-contained HTML document for one note. */
export function noteToHtmlDocument(note: Pick<Note, "title" | "content">): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(note.title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<h1>${escapeHtml(note.title)}</h1>
${noteBodyToHtml(note.content)}
</body>
</html>
`;
}

/** An attachment's decrypted bytes, for the vault zip (#550). */
export interface ExportAttachment {
  noteId: string;
  /** The attachment's file name, as the note's `![[name]]` embeds refer to it. */
  name: string;
  bytes: Uint8Array;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
}

/** Points a note's `![[name]]` / `[[name]]` links at `path` (a vault-root path, as Obsidian reads it). */
function relinkAttachment(content: string, name: string, path: string): string {
  return content.replace(/(!?)\[\[([^\]|#]+)((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]/g, (match, bang, target: string, sub, alias) =>
    target.trim() === name ? `${bang}[[${path}${sub}${alias}]]` : match,
  );
}

/**
 * Obsidian-compatible zip entries for a vault: one `.md` file per note named
 * by its title, nested in its folder path; title collisions inside the same
 * folder get a numeric suffix so no entry is silently overwritten.
 *
 * Attachments (#550) go next to their note, where `![[name]]` resolves in
 * Obsidian and similar tools. The same file attached to two notes of a folder
 * is stored once; a different file whose name is taken goes to a
 * "<note> files" folder, and only then is that note's link to it rewritten
 * to the new path.
 */
export function vaultToZipEntries(notes: Note[], attachments: ExportAttachment[] = []): ZipEntry[] {
  const used = new Map<string, Uint8Array | null>(); // lowercased path → bytes (null for a note)
  const notePaths = notes.map((n) => {
    const dir = n.path ? `${n.path}/` : "";
    const base = safeFilename(n.title);
    let path = `${dir}${base}.md`;
    for (let i = 2; used.has(path.toLowerCase()); i++) {
      path = `${dir}${base} ${i}.md`;
    }
    used.set(path.toLowerCase(), null);
    return path;
  });

  const byNote = new Map(notes.map((n) => [n.id, n]));
  const content = new Map(notes.map((n) => [n.id, n.content]));
  const files: ZipEntry[] = [];
  const place = (path: string, bytes: Uint8Array): "new" | "same" | "taken" => {
    const held = used.get(path.toLowerCase());
    if (held === undefined) {
      used.set(path.toLowerCase(), bytes);
      files.push({ path, content: bytes });
      return "new";
    }
    return held && sameBytes(held, bytes) ? "same" : "taken";
  };
  for (const att of attachments) {
    const n = byNote.get(att.noteId);
    if (!n) continue;
    const dir = n.path ? `${n.path}/` : "";
    const name = safeFilename(att.name);
    let path = `${dir}${name}`;
    if (place(path, att.bytes) === "taken") {
      const own = `${dir}${safeFilename(n.title)} files/`;
      path = `${own}${name}`;
      for (let i = 2; place(path, att.bytes) === "taken"; i++) path = `${own}${numberedName(name, i)}`;
    }
    if (path !== `${dir}${att.name}`) content.set(n.id, relinkAttachment(content.get(n.id)!, att.name, path));
  }

  return [...notes.map((n, i) => ({ path: notePaths[i], content: content.get(n.id)! })), ...files];
}

/** Builds the vault zip bytes. */
export function vaultToZip(notes: Note[], now?: Date, attachments: ExportAttachment[] = []): Uint8Array {
  return buildZip(vaultToZipEntries(notes, attachments), now);
}

/** The toast after a vault export: how many files went in, and which could not be downloaded. */
export function describeExport(
  vaultName: string,
  files: number,
  failed: string[],
): { message: string; kind: "success" | "error" } {
  const withFiles = files > 0 ? ` with ${files} attached file${files === 1 ? "" : "s"}` : "";
  const message = `Exported “${vaultName}” as a zip${withFiles}.`;
  if (failed.length === 0) return { message, kind: "success" };
  const shown = failed.slice(0, 5).join(", ") + (failed.length > 5 ? ` and ${failed.length - 5} more` : "");
  return { message: `${message} Not included (download failed): ${shown}.`, kind: "error" };
}

/** Where the vault export gets each note's attachments (through the vault's encryption). */
export interface AttachmentSource<A extends { filename: string }> {
  list(noteId: string): Promise<A[]>;
  /** The attachment's plaintext bytes. */
  read(att: A): Promise<Uint8Array>;
  onProgress?(done: number, total: number): void;
}

/**
 * Downloads every note's attachments for the vault zip (#550), a few notes
 * at a time. Nothing is skipped silently: an attachment that fails to
 * download, or a note whose list fails, is named in `failed`.
 */
export async function collectAttachments<A extends { filename: string }>(
  notes: Note[],
  source: AttachmentSource<A>,
  concurrency = 4,
): Promise<{ attachments: ExportAttachment[]; failed: string[] }> {
  const perNote: ExportAttachment[][] = notes.map(() => []);
  const failed: string[][] = notes.map(() => []);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < notes.length) {
      const i = next++;
      const n = notes[i];
      try {
        for (const att of await source.list(n.id)) {
          try {
            perNote[i].push({ noteId: n.id, name: att.filename, bytes: await source.read(att) });
          } catch {
            failed[i].push(att.filename);
          }
        }
      } catch {
        failed[i].push(`the files of “${n.title}”`);
      }
      source.onProgress?.(++done, notes.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, notes.length) }, worker));
  // Note order, not finishing order, so the zip is the same on every run.
  return { attachments: perNote.flat(), failed: failed.flat() };
}

/** How long a download's object URL stays valid after the click. */
export const DOWNLOAD_URL_LIFETIME_MS = 60_000;

/**
 * Saves an object URL as a file. The URL is revoked a minute later, not right
 * away: WebKit (the macOS/Linux webview) starts the download asynchronously
 * and cancels it when the URL is already gone (#392).
 */
export function startDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
}

/** Triggers a browser download of the given content. */
export function downloadFile(filename: string, mime: string, data: string | Uint8Array | Blob): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  startDownload(URL.createObjectURL(blob), filename);
}

/**
 * PDF export: loads the standalone HTML into a hidden iframe and opens the
 * print dialog (native "save as PDF" everywhere, including the Tauri shell).
 */
export function printNote(note: Pick<Note, "title" | "content">): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "100%";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(noteToHtmlDocument(note));
  doc.close();
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Leave time for the print dialog to grab the frame before removal.
    setTimeout(() => frame.remove(), 60_000);
  };
}
