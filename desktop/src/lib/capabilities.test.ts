import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Tauri v2 grants commands per window label through the capability files.
// Only the main window may call into the app: the policy-page windows
// (`legal-*`, opened by the native `open_policy_page` command) and any other
// extra window get nothing. Windows are created natively only, so no
// capability may let page script create a window or webview itself.

const tauriDir = resolve(process.cwd(), "src-tauri");
const dir = resolve(tauriDir, "capabilities");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

type Permission = string | { identifier: string };

interface Capability {
  identifier?: string;
  windows?: string[];
  webviews?: string[];
  remote?: unknown;
  permissions?: Permission[];
}

const capabilities: Array<[string, Capability]> = files.map((file) => [
  file,
  JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Capability,
]);

// Capabilities can also be written inline in tauri.conf.json.
const conf = JSON.parse(readFileSync(resolve(tauriDir, "tauri.conf.json"), "utf8")) as {
  app?: { security?: { capabilities?: Array<string | Capability> } };
};
for (const cap of conf.app?.security?.capabilities ?? []) {
  if (typeof cap !== "string") capabilities.push([`tauri.conf.json (${cap.identifier ?? "inline"})`, cap]);
}

const permissionId = (p: Permission) => (typeof p === "string" ? p : p.identifier);

/** Any permission that lets page script create a window or a webview. */
const CREATES_WINDOWS = /^core:(window|webview):(allow-)?create/;

describe("Tauri capabilities", () => {
  it("has at least one capability file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("recognises window and webview creation permissions", () => {
    for (const id of [
      "core:window:allow-create",
      "core:webview:allow-create-webview",
      "core:webview:allow-create-webview-window",
    ]) {
      expect(CREATES_WINDOWS.test(id), id).toBe(true);
    }
    expect(CREATES_WINDOWS.test("core:window:allow-close")).toBe(false);
  });

  for (const [name, cap] of capabilities) {
    it(`${name} applies to the main window only`, () => {
      expect(cap.windows ?? []).toEqual(["main"]);
      expect(cap.webviews ?? []).toEqual([]);
    });

    it(`${name} grants nothing to remote pages`, () => {
      expect(cap).not.toHaveProperty("remote");
    });

    it(`${name} does not let page script create windows or webviews`, () => {
      const granted = (cap.permissions ?? []).map(permissionId);
      expect(granted.filter((id) => CREATES_WINDOWS.test(id))).toEqual([]);
    });
  }
});
