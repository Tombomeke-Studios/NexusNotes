import { describe, it, expect } from "vitest";
import { attachmentBlockReason } from "./attachmentPolicy";

describe("attachmentBlockReason", () => {
  it("allows attachments in a regular vault", () => {
    expect(attachmentBlockReason({ encryption: "none" })).toBeNull();
  });

  it("blocks attachments in an end-to-end encrypted vault (files are not encrypted yet)", () => {
    expect(attachmentBlockReason({ encryption: "e2ee" })).toMatch(/end-to-end encrypted/);
  });

  it("fails closed while the vault is unknown", () => {
    expect(attachmentBlockReason(undefined)).not.toBeNull();
    expect(attachmentBlockReason(null)).not.toBeNull();
  });
});
