import { describe, it, expect, beforeEach, vi } from "vitest";
import { migrateLegacyPins } from "./stars";
import { ApiError } from "./api";

// Pins leave localStorage only once the server has them (#377).
describe("migrateLegacyPins", () => {
  beforeEach(() => localStorage.clear());

  it("returns the starred ids and forgets them locally", async () => {
    localStorage.setItem("nexus_pins_v1", JSON.stringify(["a", "b"]));
    const star = vi.fn().mockResolvedValue(undefined);
    expect(await migrateLegacyPins("v1", star)).toEqual(["a", "b"]);
    expect(star).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("nexus_pins_v1")).toBeNull();
  });

  it("keeps pins the server could not take right now, for the next start", async () => {
    localStorage.setItem("nexus_pins_v1", JSON.stringify(["ok", "offline", "busy"]));
    const star = vi.fn(async (id: string) => {
      if (id === "offline") throw new TypeError("Failed to fetch");
      if (id === "busy") throw new ApiError(503, "unavailable");
    });
    expect(await migrateLegacyPins("v1", star)).toEqual(["ok"]);
    expect(JSON.parse(localStorage.getItem("nexus_pins_v1")!)).toEqual(["offline", "busy"]);
  });

  it("drops pins the server rejects for good (a deleted note)", async () => {
    localStorage.setItem("nexus_pins_v1", JSON.stringify(["gone", "ok"]));
    const star = vi.fn(async (id: string) => {
      if (id === "gone") throw new ApiError(404, "note not found");
    });
    expect(await migrateLegacyPins("v1", star)).toEqual(["ok"]);
    expect(localStorage.getItem("nexus_pins_v1")).toBeNull();
  });

  it("tolerates corrupt stored pins", async () => {
    localStorage.setItem("nexus_pins_v1", "not json{");
    expect(await migrateLegacyPins("v1", vi.fn())).toEqual([]);
    localStorage.setItem("nexus_pins_v2", JSON.stringify({ nope: 1 }));
    expect(await migrateLegacyPins("v2", vi.fn())).toEqual([]);
  });

  it("does nothing without legacy pins", async () => {
    const star = vi.fn();
    expect(await migrateLegacyPins("v1", star)).toEqual([]);
    expect(star).not.toHaveBeenCalled();
  });
});
