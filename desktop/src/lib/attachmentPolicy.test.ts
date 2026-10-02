import { describe, it, expect } from "vitest";
import { attachmentBlockReason } from "./attachmentPolicy";

describe("attachmentBlockReason", () => {
  it("allows attachments in a regular vault", () => {
    expect(attachmentBlockReason({ encryption: "none" })).toBeNull();
  });

  it("allows attachments in an end-to-end encrypted vault (encrypted on the device, #238)", () => {
    expect(attachmentBlockReason({ encryption: "e2ee" })).toBeNull();
  });

  it("fails closed while the vault is unknown", () => {
    expect(attachmentBlockReason(undefined)).not.toBeNull();
    expect(attachmentBlockReason(null)).not.toBeNull();
  });
});
