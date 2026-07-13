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
  const cleaned = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
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

/**
 * Obsidian-compatible zip entries for a vault: one `.md` file per note named
 * by its title, nested in its folder path; title collisions inside the same
 * folder get a numeric suffix so no entry is silently overwritten.
 */
export function vaultToZipEntries(notes: Note[]): ZipEntry[] {
  const used = new Set<string>();
  return notes.map((n) => {
    const dir = n.path ? `${n.path}/` : "";
    const base = safeFilename(n.title);
    let path = `${dir}${base}.md`;
    for (let i = 2; used.has(path.toLowerCase()); i++) {
      path = `${dir}${base} ${i}.md`;
    }
    used.add(path.toLowerCase());
    return { path, content: n.content };
  });
}

/** Builds the vault zip bytes. */
export function vaultToZip(notes: Note[], now?: Date): Uint8Array {
  return buildZip(vaultToZipEntries(notes), now);
}

/** Triggers a browser download of the given content. */
export function downloadFile(filename: string, mime: string, data: string | Uint8Array): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
