import { describe, it, expect } from "vitest";
import { parseAuthAction } from "./authAction";

describe("parseAuthAction", () => {
  it("recognises a verification link", () => {
    expect(parseAuthAction("/verify-email", "?token=abc")).toEqual({
      kind: "verify-email",
      token: "abc",
    });
  });

  it("recognises a reset-password link", () => {
    expect(parseAuthAction("/reset-password", "?token=xyz")).toEqual({
      kind: "reset-password",
      token: "xyz",
    });
  });

  it("tolerates a base path prefix", () => {
    expect(parseAuthAction("/app/reset-password", "?token=t")).toEqual({
      kind: "reset-password",
      token: "t",
    });
  });

  it("returns null without a token or on an unrelated path", () => {
    expect(parseAuthAction("/verify-email", "")).toBeNull();
    expect(parseAuthAction("/", "?token=abc")).toBeNull();
    expect(parseAuthAction("/reset-password", "?other=1")).toBeNull();
  });
});
