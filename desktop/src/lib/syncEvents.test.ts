import { describe, expect, it } from "vitest";
import { isForVault } from "./syncEvents";

describe("isForVault", () => {
  it("accepts a note of the open vault", () => {
    expect(isForVault({ vault_id: "v1" }, "v1")).toBe(true);
  });

  it("rejects a note of another vault", () => {
    expect(isForVault({ vault_id: "v2" }, "v1")).toBe(false);
  });

  it("rejects everything while no vault is open", () => {
    expect(isForVault({ vault_id: "v1" }, null)).toBe(false);
  });

  it("rejects a payload without a vault id", () => {
    expect(isForVault({} as { vault_id: string }, "v1")).toBe(false);
    expect(isForVault(null as unknown as { vault_id: string }, "v1")).toBe(false);
  });
});
