import { describe, it, expect } from "vitest";
import { planImport, MAX_IMPORT_BYTES } from "./importNotes";

function file(path: string, text = "x", size?: number) {
  return { name: path.split("/").pop()!, webkitRelativePath: path, size: size ?? text.length, text: async () => text };
}

describe("planImport (#451)", () => {
  it("turns a picked folder into notes with their folder paths", async () => {
    const plan = await planImport(
      [
        file("MyVault/Welcome.md", "# hi"),
        file("MyVault/Projects/2026/Plan.markdown", "plan"),
        file("MyVault/.obsidian/workspace.json"),
        file("MyVault/.trash/Old.md"),
        file("MyVault/image.png"),
      ],
      [],
    );
    expect(plan.notes).toEqual([
      { title: "Welcome", path: "", content: "# hi" },
      { title: "Plan", path: "Projects/2026", content: "plan" },
    ]);
    // Hidden app folders are left out silently; only the image counts as skipped.
    expect(plan.skipped).toEqual({ notMarkdown: 1, existing: 0, tooLarge: 0 });
  });

  it("takes loose files at the root", async () => {
    const plan = await planImport([{ ...file("a.md"), webkitRelativePath: "" }], []);
    expect(plan.notes).toEqual([{ title: "a", path: "", content: "x" }]);
  });

  it("skips notes the vault already has and files that are too large", async () => {
    const plan = await planImport(
      [file("V/Welcome.md"), file("V/Big.md", "x", MAX_IMPORT_BYTES + 1), file("V/New.md")],
      [{ title: "welcome", path: "" }],
    );
    expect(plan.notes.map((n) => n.title)).toEqual(["New"]);
    expect(plan.skipped).toEqual({ notMarkdown: 0, existing: 1, tooLarge: 1 });
  });

  it("normalises Windows line endings", async () => {
    const plan = await planImport([file("V/a.md", "one\r\ntwo")], []);
    expect(plan.notes[0].content).toBe("one\ntwo");
  });
});
