import { describe, it, expect } from "vitest";
import { resolveApiBase } from "./apiBase";

describe("resolveApiBase (#399)", () => {
  it("uses an explicit VITE_API_URL", () => {
    expect(resolveApiBase("http://localhost:8080/", false, "http://localhost:1420")).toBe("http://localhost:8080");
  });
  it("talks to the bundled sidecar inside the desktop app", () => {
    expect(resolveApiBase(undefined, true, "tauri://localhost")).toBe("http://localhost:8080");
  });
  it("talks to its own origin in a browser (the web UI's proxy), never to localhost", () => {
    expect(resolveApiBase(undefined, false, "https://notes.example.com")).toBe("https://notes.example.com");
    expect(resolveApiBase("", false, "http://server:3000")).toBe("http://server:3000");
  });
});
