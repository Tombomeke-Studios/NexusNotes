import { describe, it, expect } from "vitest";
import { describeServerStatus, unreachableMessage } from "./connection";

describe("connection messages", () => {
  it("names the server address when unreachable", () => {
    expect(unreachableMessage("http://localhost:8080")).toContain("http://localhost:8080");
  });

  it("says nothing while the server is fine", () => {
    expect(describeServerStatus({ state: "ok", serverVersion: "0.5.0" }, "http://x")).toBeNull();
  });

  it("explains an unreachable server and how to start it", () => {
    const d = describeServerStatus({ state: "unreachable" }, "http://localhost:8080");
    expect(d?.tone).toBe("error");
    expect(d?.message).toContain("http://localhost:8080");
    expect(d?.hint).toContain("Docker Desktop");
  });

  it("explains a version mismatch with both versions", () => {
    const d = describeServerStatus(
      { state: "mismatch", serverVersion: "0.6.0", appVersion: "0.5.0" },
      "http://localhost:8080",
    );
    expect(d?.tone).toBe("warning");
    expect(d?.message).toContain("0.6.0");
    expect(d?.message).toContain("0.5.0");
  });
});
