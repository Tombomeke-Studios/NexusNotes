import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Tauri v2 grants commands per window label through the capability files.
// Only the main window may call into the app: the policy-page windows
// (`legal-*`, see openBundledPage) and any other extra window get nothing.

const dir = resolve(process.cwd(), "src-tauri/capabilities");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

interface Capability {
  windows?: string[];
  webviews?: string[];
  remote?: unknown;
}

describe("Tauri capabilities", () => {
  it("has at least one capability file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const cap = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Capability;

    it(`${file} applies to the main window only`, () => {
      expect(cap.windows ?? []).toEqual(["main"]);
      expect(cap.webviews ?? []).toEqual([]);
    });

    it(`${file} grants nothing to remote pages`, () => {
      expect(cap.remote).toBeUndefined();
    });
  }
});
