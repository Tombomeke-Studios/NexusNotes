import { describe, it, expect, vi } from "vitest";
import {
  planImport,
  runImport,
  summarizeImport,
  MAX_IMPORT_BYTES,
  MAX_ATTACHMENT_BYTES,
  type ImportFile,
  type ImportResult,
} from "./importNotes";

function file(path: string, text = "x", size?: number): ImportFile {
  return { name: path.split("/").pop()!, webkitRelativePath: path, size: size ?? text.length, text: async () => text };
}

const titles = (plan: { notes: Array<{ title: string }> }) => plan.notes.map((n) => n.title);

describe("planImport (#451)", () => {
  it("turns a picked folder into notes with their folder paths", async () => {
    const plan = await planImport(
      [
        file("MyVault/Welcome.md", "# hi"),
        file("MyVault/Projects/2026/Plan.markdown", "plan"),
        file("MyVault/.obsidian/workspace.json"),
        file("MyVault/.trash/Old.md"),
      ],
      [],
    );
    expect(plan.notes).toEqual([
      { title: "Welcome", path: "", content: "# hi", attachments: [] },
      { title: "Plan", path: "Projects/2026", content: "plan", attachments: [] },
    ]);
    // Hidden app folders are left out silently.
    expect(plan.skipped).toEqual({ existing: 0, tooLarge: [] });
  });

  it("takes loose files at the root", async () => {
    const plan = await planImport([{ ...file("a.md"), webkitRelativePath: "" }], []);
    expect(plan.notes).toEqual([{ title: "a", path: "", content: "x", attachments: [] }]);
  });

  it("skips notes the vault already has and names files that are too large", async () => {
    const plan = await planImport(
      [
        file("V/Welcome.md"),
        file("V/Big.md", "x", MAX_IMPORT_BYTES + 1),
        file("V/New.md"),
        file("V/movie.mp4", "x", MAX_ATTACHMENT_BYTES + 1),
      ],
      [{ title: "welcome", path: "" }],
    );
    expect(titles(plan)).toEqual(["New"]);
    expect(plan.skipped).toEqual({ existing: 1, tooLarge: ["Big.md", "movie.mp4"] });
  });

  it("normalises Windows line endings", async () => {
    const plan = await planImport([file("V/a.md", "one\r\ntwo")], []);
    expect(plan.notes[0].content).toBe("one\ntwo");
  });
});

describe("planImport attachments (#551)", () => {
  it("attaches the files a note embeds or links and rewrites the links to resolve", async () => {
    const trip = [
      "![[beach.png]]",
      "![[assets/map.png|300]]",
      "![A photo](../assets/photo%201.jpg)",
      "[the doc](<../assets/doc v2.pdf>)",
      "[[doc v2.pdf]]",
      "![[Other note]] and [site](https://example.com/x.png)",
      "```",
      "![[beach.png]] in code stays",
      "```",
    ].join("\n");
    const plan = await planImport(
      [
        file("V/Notes/Trip.md", trip),
        file("V/Other note.md"),
        file("V/assets/beach.png"),
        file("V/assets/map.png"),
        file("V/assets/photo 1.jpg"),
        file("V/assets/doc v2.pdf"),
      ],
      [],
    );
    const note = plan.notes.find((n) => n.title === "Trip")!;
    expect(note.attachments.map((a) => a.name).sort()).toEqual(["beach.png", "doc v2.pdf", "map.png", "photo 1.jpg"]);
    expect(note.content.split("\n")).toEqual([
      "![[beach.png]]",
      "![[map.png|300]]",
      "![[photo 1.jpg|A photo]]",
      "[[doc v2.pdf|the doc]]",
      "[[doc v2.pdf]]",
      "![[Other note]] and [site](https://example.com/x.png)",
      "```",
      "![[beach.png]] in code stays",
      "```",
    ]);
    // Every file was linked, so no catch-all note.
    expect(titles(plan)).toEqual(["Trip", "Other note"]);
  });

  it("numbers files of the same name that one note embeds", async () => {
    const plan = await planImport(
      [file("V/n.md", "![[a/pic.png]] ![[b/pic.png]] ![[a/pic.png]]"), file("V/a/pic.png"), file("V/b/pic.png")],
      [],
    );
    expect(plan.notes[0].attachments.map((a) => [a.file.webkitRelativePath, a.name])).toEqual([
      ["V/a/pic.png", "pic.png"],
      ["V/b/pic.png", "pic 2.png"],
    ]);
    expect(plan.notes[0].content).toBe("![[pic.png]] ![[pic 2.png]] ![[pic.png]]");
  });

  it("resolves a bare name to the file nearest the note", async () => {
    const plan = await planImport(
      [file("V/Notes/n.md", "![[pic.png]]"), file("V/pic.png"), file("V/Notes/pic.png")],
      [],
    );
    expect(plan.notes[0].attachments[0].file.webkitRelativePath).toBe("V/Notes/pic.png");
    // The other one is not linked, so it lands in the catch-all note.
    expect(plan.notes[1].title).toBe("Files from V");
    expect(plan.notes[1].attachments[0].file.webkitRelativePath).toBe("V/pic.png");
  });

  it("gives files no note links to a note of their own that embeds them", async () => {
    const plan = await planImport([file("V/a.md"), file("V/scan.pdf"), file("V/x/photo.JPG"), file("V/y/scan.pdf")], []);
    const loose = plan.notes[1];
    expect(loose.title).toBe("Files from V");
    expect(loose.path).toBe("");
    expect(loose.attachments.map((a) => a.name)).toEqual(["scan.pdf", "photo.JPG", "scan 2.pdf"]);
    expect(loose.content).toContain("[[scan.pdf]]\n\n![[photo.JPG]]\n\n[[scan 2.pdf]]\n");
  });

  it("calls the catch-all note Imported files for loose picks, and skips it when it exists", async () => {
    const loose = { ...file("pic.png"), webkitRelativePath: "" };
    expect(titles(await planImport([loose], []))).toEqual(["Imported files"]);
    const again = await planImport([file("V/a.png"), file("V/b.png")], [{ title: "Files from V", path: "" }]);
    expect(again.notes).toEqual([]);
    expect(again.skipped.existing).toBe(2);
  });

  it("leaves operating-system clutter out", async () => {
    const plan = await planImport(
      [
        file("V/a.md"),
        file("V/Thumbs.db"),
        file("V/sub/desktop.ini"),
        file("V/sub/.DS_Store"),
        { ...file("thumbs.db"), webkitRelativePath: "" },
      ],
      [],
    );
    expect(titles(plan)).toEqual(["a"]);
    expect(plan.skipped).toEqual({ existing: 0, tooLarge: [] });
  });
});

describe("runImport (#551)", () => {
  const realFile = (name: string) => new File(["data"], name, { type: "image/png" });

  it("creates each note, then uploads its files to it", async () => {
    const plan = await planImport(
      [file("V/a.md", "![[pic.png]]"), file("V/pic.png"), file("V/b.md")],
      [],
    );
    let id = 0;
    const createNote = vi.fn(async (n: { title: string }) => ({ id: `n${++id}`, title: n.title }));
    const uploads: Array<[string, string]> = [];
    const progress: Array<[number, number]> = [];
    const result = await runImport(plan, {
      createNote,
      uploadAttachment: async (noteId, f) => void uploads.push([noteId, f.name]),
      onProgress: (done, total) => void progress.push([done, total]),
      toFile: (_f, name) => realFile(name),
    });
    expect(result.created.map((n) => n.title)).toEqual(["a", "b"]);
    expect(uploads).toEqual([["n1", "pic.png"]]);
    expect(result.files).toBe(1);
    expect(result.failed).toEqual([]);
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
  });

  it("uploads under the planned name", async () => {
    const plan = await planImport([file("V/n.md", "![[a/p.png]] ![[b/p.png]]"), file("V/a/p.png"), file("V/b/p.png")], []);
    const names: string[] = [];
    await runImport(plan, {
      createNote: async () => ({ id: "n" }),
      uploadAttachment: async (_id, f) => void names.push(f.name),
      toFile: (_f, name) => realFile(name),
    });
    expect(names).toEqual(["p.png", "p 2.png"]);
  });

  it("renames a picked File by default, keeping its type", async () => {
    const picked = (path: string, type: string) => {
      const f = new File(["data"], path.split("/").pop()!, { type });
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      Object.defineProperty(f, "text", { value: async () => "![[a/p.png]] ![[b/p.png]]" });
      return f;
    };
    const plan = await planImport(
      [picked("V/n.md", "text/markdown"), picked("V/a/p.png", "image/png"), picked("V/b/p.png", "image/png")],
      [],
    );
    const sent: File[] = [];
    await runImport(plan, {
      createNote: async () => ({ id: "n" }),
      uploadAttachment: async (_id, f) => void sent.push(f),
    });
    expect(sent.map((f) => [f.name, f.type, f.size])).toEqual([
      ["p.png", "image/png", 4],
      ["p 2.png", "image/png", 4],
    ]);
    expect(sent[0]).toBe(plan.notes[0].attachments[0].file);
  });

  it("lists what failed: a note's files fail with it", async () => {
    const plan = await planImport(
      [file("V/bad.md", "![[one.png]]"), file("V/one.png"), file("V/good.md", "![[two.png]]"), file("V/two.png")],
      [],
    );
    const result = await runImport(plan, {
      createNote: async (n) => {
        if (n.title === "bad") throw new Error("boom");
        return { id: n.title };
      },
      uploadAttachment: async () => {
        throw new Error("nope");
      },
      toFile: (_f, name) => realFile(name),
    });
    expect(result.created.map((n) => n.id)).toEqual(["good"]);
    expect(result.failed).toEqual(["bad.md", "one.png", "two.png"]);
    expect(result.files).toBe(0);
  });
});

describe("summarizeImport (#551)", () => {
  const result = (over: Partial<ImportResult<unknown>>): ImportResult<unknown> => ({
    created: [],
    files: 0,
    failed: [],
    skipped: { existing: 0, tooLarge: [] },
    ...over,
  });

  it("counts notes and files", () => {
    expect(summarizeImport(result({ created: [1, 2], files: 1 }))).toEqual({
      message: "Imported 2 notes and 1 file.",
      kind: "success",
    });
  });

  it("counts skipped files and names those over the size limit", () => {
    const { message, kind } = summarizeImport(
      result({ created: [1], files: 3, skipped: { existing: 2, tooLarge: ["movie.mp4", "Huge.md"] } }),
    );
    expect(message).toBe(
      "Imported 1 note and 3 files. Skipped 4: 2 already in the vault; " +
        "2 over the size limit (5 MB per note, 25 MB per file): movie.mp4, Huge.md.",
    );
    expect(kind).toBe("success");
  });

  it("names failures and shortens long lists", () => {
    const { message, kind } = summarizeImport(result({ failed: ["a", "b", "c", "d", "e", "f", "g"] }));
    expect(message).toBe("Imported 0 notes and 0 files. Failed: a, b, c, d, e and 2 more.");
    expect(kind).toBe("error");
  });
});
