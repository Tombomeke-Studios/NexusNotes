import { describe, it, expect } from "vitest";
import pkg from "../../package.json";
import tauriConf from "../../src-tauri/tauri.conf.json";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_VERSION, parseVersion, assessHealth, formatVersionLabel } from "./version";

// Vitest runs from desktop/, so the repo root is one level up.
const read = (...p: string[]) => readFileSync(resolve(process.cwd(), ...p), "utf8");
const versionFile = read("..", "VERSION");
const cargoToml = read("src-tauri", "Cargo.toml");

describe("version sources", () => {
  const canonical = versionFile.trim();

  it("keeps every manifest in sync with the repo-root VERSION file", () => {
    // Fix drift with: ./scripts/set-version.sh <version>
    expect(pkg.version).toBe(canonical);
    expect(tauriConf.version).toBe(canonical);
    expect(cargoToml.split(/\r?\n/)).toContain(`version = "${canonical}"`);
  });

  it("exposes the package version as APP_VERSION", () => {
    expect(APP_VERSION).toBe(canonical);
  });

  it("is a valid pre-1.0 semver", () => {
    const v = parseVersion(canonical);
    expect(v).not.toBeNull();
    expect(v!.major).toBe(0);
  });
});

describe("parseVersion", () => {
  it("parses x.y.z, tolerating a leading v and pre-release suffix", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("v0.5.0")).toEqual({ major: 0, minor: 5, patch: 0 });
    expect(parseVersion("0.5.1-rc.1")).toEqual({ major: 0, minor: 5, patch: 1 });
  });

  it("returns null for non-versions such as dev builds", () => {
    expect(parseVersion("dev")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe("assessHealth", () => {
  it("is unreachable when there is no health payload", () => {
    expect(assessHealth(null, "0.5.0")).toEqual({ state: "unreachable" });
  });

  it("is ok when app and server share major.minor (patch may differ)", () => {
    expect(assessHealth({ status: "ok", version: "0.5.3" }, "0.5.0")).toEqual({
      state: "ok",
      serverVersion: "0.5.3",
    });
  });

  it("flags a mismatch when minor differs (pre-1.0 minors may break the API)", () => {
    expect(assessHealth({ status: "ok", version: "0.6.0" }, "0.5.0")).toEqual({
      state: "mismatch",
      serverVersion: "0.6.0",
      appVersion: "0.5.0",
    });
  });

  it("flags a mismatch when major differs", () => {
    expect(assessHealth({ status: "ok", version: "1.0.0" }, "0.5.0").state).toBe("mismatch");
  });

  it("treats a dev or missing server version as compatible", () => {
    expect(assessHealth({ status: "ok", version: "dev" }, "0.5.0").state).toBe("ok");
    expect(assessHealth({ status: "ok" }, "0.5.0").state).toBe("ok");
  });
});

describe("formatVersionLabel", () => {
  it("shows only the app version until the server has answered", () => {
    expect(formatVersionLabel("0.5.0", null)).toBe("NexusNotes v0.5.0");
  });

  it("adds the server version when known", () => {
    expect(formatVersionLabel("0.5.0", { state: "ok", serverVersion: "0.5.2" })).toBe(
      "NexusNotes v0.5.0 · server v0.5.2",
    );
    expect(
      formatVersionLabel("0.5.0", { state: "mismatch", serverVersion: "0.6.0", appVersion: "0.5.0" }),
    ).toBe("NexusNotes v0.5.0 · server v0.6.0");
  });

  it("labels an unversioned dev server and an unreachable one", () => {
    expect(formatVersionLabel("0.5.0", { state: "ok", serverVersion: "dev" })).toBe(
      "NexusNotes v0.5.0 · server dev build",
    );
    expect(formatVersionLabel("0.5.0", { state: "ok" })).toBe("NexusNotes v0.5.0 · server dev build");
    expect(formatVersionLabel("0.5.0", { state: "unreachable" })).toBe(
      "NexusNotes v0.5.0 · server unreachable",
    );
  });
});
