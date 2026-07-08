import type { Note, TreeNode } from "./types";

export interface BuildTreeOptions {
  /** Preserve the input order of notes (folders stay alphabetical and first). */
  keepNoteOrder?: boolean;
  /** Folder paths that should appear even when they contain no notes. */
  emptyFolders?: string[];
}

/** Walk/create a folder chain, returning the deepest folder's children array. */
function ensureFolder(root: TreeNode[], folderPath: string): TreeNode[] {
  const parts = folderPath.split("/").filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const path = parts.slice(0, i + 1).join("/");
    let folder = current.find((n) => n.type === "folder" && n.name === part);
    if (!folder) {
      folder = { name: part, path, type: "folder", children: [] };
      current.push(folder);
    }
    current = folder.children!;
  }
  return current;
}

export function buildTree(notes: Note[], options: BuildTreeOptions = {}): TreeNode[] {
  const root: TreeNode[] = [];

  for (const note of notes) {
    // note.path is the folder the note lives in ("" = root); the note's display
    // name is its title.
    const parent = note.path ? ensureFolder(root, note.path) : root;
    parent.push({
      name: note.title,
      path: note.path,
      type: "note",
      noteId: note.id,
    });
  }

  for (const folderPath of options.emptyFolders ?? []) {
    ensureFolder(root, folderPath);
  }

  sortTree(root, options.keepNoteOrder ?? false);
  return root;
}

function sortTree(nodes: TreeNode[], keepNoteOrder: boolean) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    if (a.type === "note" && keepNoteOrder) return 0;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children, keepNoteOrder);
  }
}
