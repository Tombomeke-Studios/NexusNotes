import type { Note, TreeNode } from "./types";

export function buildTree(notes: Note[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const note of notes) {
    const parts = note.path ? note.path.split("/").filter(Boolean) : [];
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      let folder = current.find(
        (n) => n.type === "folder" && n.name === part,
      );

      if (!folder) {
        folder = { name: part, path, type: "folder", children: [] };
        current.push(folder);
      }

      current = folder.children!;
    }

    current.push({
      name: note.title,
      path: note.path,
      type: "note",
      noteId: note.id,
    });
  }

  sortTree(root);
  return root;
}

function sortTree(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}
