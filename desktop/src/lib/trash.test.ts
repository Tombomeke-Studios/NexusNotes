import { describe, expect, it } from "vitest";
import { trashActions, trashAgeLabel, trashFolderLabel } from "./trash";

const now = new Date("2026-10-16T12:00:00Z");
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

describe("trashAgeLabel (#569)", () => {
  it("says when it was deleted and when it is removed", () => {
    expect(trashAgeLabel(daysFromNow(-2), daysFromNow(28), now)).toBe("deleted 2 days ago · removed in 28 days");
  });

  it("counts recent deletes in minutes and hours", () => {
    expect(trashAgeLabel(new Date(now.getTime() - 20_000).toISOString(), daysFromNow(30), now)).toBe(
      "deleted just now · removed in 30 days",
    );
    expect(trashAgeLabel(new Date(now.getTime() - 5 * 60_000).toISOString(), daysFromNow(30), now)).toBe(
      "deleted 5 min ago · removed in 30 days",
    );
    expect(trashAgeLabel(new Date(now.getTime() - 3 * 3_600_000).toISOString(), daysFromNow(30), now)).toBe(
      "deleted 3 h ago · removed in 30 days",
    );
  });

  it("says yesterday and the last day in words", () => {
    expect(trashAgeLabel(daysFromNow(-1), daysFromNow(1), now)).toBe("deleted yesterday · removed in 1 day");
  });

  it("rounds a part day up, and says 'soon' once the time is up", () => {
    expect(trashAgeLabel(daysFromNow(-29.5), daysFromNow(0.5), now)).toBe("deleted 29 days ago · removed in 1 day");
    expect(trashAgeLabel(daysFromNow(-30), daysFromNow(-0.01), now)).toBe("deleted 30 days ago · removed soon");
  });
});

describe("trashFolderLabel", () => {
  it("names the original folder, or the vault root", () => {
    expect(trashFolderLabel("Projects/2026")).toBe("Projects/2026");
    expect(trashFolderLabel("")).toBe("Vault root");
  });

  it("says nothing about a folder that could not be decrypted", () => {
    expect(trashFolderLabel(null)).toBeNull();
  });
});

describe("trashActions", () => {
  it("lets the owner restore and delete for good", () => {
    expect(trashActions("owner")).toEqual({ canRestore: true, canPurge: true });
    expect(trashActions(undefined)).toEqual({ canRestore: true, canPurge: true });
  });

  it("lets an editor restore only", () => {
    expect(trashActions("editor")).toEqual({ canRestore: true, canPurge: false });
  });

  it("lets a viewer only look", () => {
    expect(trashActions("viewer")).toEqual({ canRestore: false, canPurge: false });
  });
});
