#!/usr/bin/env node
// Builds the Go backend as a Tauri sidecar binary, named per Tauri's
// externalBin convention (<name>-<rust-target-triple>[.exe]) so `tauri build`
// picks it up and bundles it into the desktop installer.
//
// Node instead of a shell script: `npm run tauri build` invokes this without
// going through a shell, so it works the same from PowerShell, cmd, or bash
// with no dependency on which `bash` (if any) happens to be on PATH.
const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const triple = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
  .split("\n")
  .find((line) => line.startsWith("host:"))
  .split(":")[1]
  .trim();

const ext = process.platform === "win32" ? ".exe" : "";
const outDir = path.join(root, "desktop", "src-tauri", "binaries");
const out = path.join(outDir, `sync-service-${triple}${ext}`);

mkdirSync(outDir, { recursive: true });
console.log(`▶ Building backend sidecar for ${triple} -> ${out}`);
execFileSync("go", ["build", "-o", out, "./cmd/server"], {
  cwd: path.join(root, "services", "sync-service"),
  stdio: "inherit",
});
