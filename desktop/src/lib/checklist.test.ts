import { describe, it, expect, beforeEach } from "vitest";
import {
  CHECKLIST_STEPS,
  loadChecklist,
  startChecklist,
  completeStep,
  dismissChecklist,
  checklistVisible,
  addedLinks,
} from "./checklist";

beforeEach(() => localStorage.clear());

describe("first-launch checklist (#447)", () => {
  it("only exists once started for a new account", () => {
    expect(loadChecklist()).toBeNull();
    expect(checklistVisible(loadChecklist())).toBe(false);
    startChecklist();
    expect(loadChecklist()).toEqual({ done: [], dismissed: false });
    expect(checklistVisible(loadChecklist())).toBe(true);
  });

  it("persists completed steps, once each, and ignores them when not started", () => {
    completeStep("open-graph");
    expect(loadChecklist()).toBeNull();
    startChecklist();
    completeStep("open-graph");
    completeStep("open-graph");
    completeStep("create-note");
    expect(loadChecklist()?.done).toEqual(["open-graph", "create-note"]);
  });

  it("hides when dismissed or when every step is done", () => {
    startChecklist();
    dismissChecklist();
    expect(checklistVisible(loadChecklist())).toBe(false);
    localStorage.clear();
    startChecklist();
    for (const s of CHECKLIST_STEPS) completeStep(s.id);
    expect(checklistVisible(loadChecklist())).toBe(false);
  });

  it("survives a corrupt stored value", () => {
    localStorage.setItem("nexus_checklist", "{not json");
    expect(loadChecklist()).toBeNull();
  });
});

describe("addedLinks", () => {
  it("finds links added since the baseline that point at existing notes", () => {
    const titles = new Set(["alpha", "beta"]);
    expect(addedLinks("see [[Alpha]]", "see [[Alpha]] and [[Beta]] and [[Missing]]", titles)).toEqual(["Beta"]);
    expect(addedLinks("[[Alpha]]", "[[Alpha]]", titles)).toEqual([]);
  });
});
