import { describe, it, expect } from "vitest";
import { passphraseError, MIN_PASSPHRASE_LENGTH } from "./passphrase";

describe("passphraseError", () => {
  it("rejects a passphrase shorter than the minimum", () => {
    const short = "a".repeat(MIN_PASSPHRASE_LENGTH - 1);
    expect(passphraseError(short, short)).toMatch(/at least/);
  });

  it("rejects a confirm that does not match", () => {
    expect(passphraseError("long enough phrase", "different phrase")).toBe(
      "Passphrases do not match",
    );
  });

  it("accepts a matching passphrase at the minimum length", () => {
    const ok = "a".repeat(MIN_PASSPHRASE_LENGTH);
    expect(passphraseError(ok, ok)).toBeNull();
  });

  it("length is checked before the match so errors appear in typing order", () => {
    expect(passphraseError("short", "")).toMatch(/at least/);
  });
});
