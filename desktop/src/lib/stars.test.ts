import { describe, it, expect, beforeEach } from "vitest";
import { drainLegacyPins } from "./stars";

describe("drainLegacyPins", () => {
  beforeEach(() => localStorage.clear());

  it("returns the stored pins and removes the key (one-shot)", () => {
    localStorage.setItem("nexus_pins_v1", JSON.stringify(["a", "b"]));
    expect(drainLegacyPins("v1")).toEqual(["a", "b"]);
    expect(localStorage.getItem("nexus_pins_v1")).toBeNull();
    expect(drainLegacyPins("v1")).toEqual([]);
  });

  it("tolerates missing or corrupt data", () => {
    expect(drainLegacyPins("v1")).toEqual([]);
    localStorage.setItem("nexus_pins_v1", "not json{");
    expect(drainLegacyPins("v1")).toEqual([]);
    localStorage.setItem("nexus_pins_v2", JSON.stringify({ nope: 1 }));
    expect(drainLegacyPins("v2")).toEqual([]);
  });
});

