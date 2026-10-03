import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { GettingStarted } from "./GettingStarted";
import { startChecklist, completeStep, CHECKLIST_STEPS, loadChecklist } from "../../lib/checklist";

beforeEach(() => localStorage.clear());

describe("GettingStarted (#447)", () => {
  it("is hidden unless the checklist was started", () => {
    render(<GettingStarted />);
    expect(screen.queryByRole("region", { name: "Get started" })).toBeNull();
  });

  it("ticks steps as they happen and shows progress", () => {
    startChecklist();
    render(<GettingStarted />);
    expect(screen.getByText("0 of 4")).toBeTruthy();
    act(() => completeStep("open-graph"));
    expect(screen.getByText("1 of 4")).toBeTruthy();
    expect(screen.getByRole("listitem", { name: /Open the graph, done/ })).toBeTruthy();
  });

  it("can be dismissed for good", () => {
    startChecklist();
    render(<GettingStarted />);
    fireEvent.click(screen.getByRole("button", { name: "Hide the checklist" }));
    expect(screen.queryByRole("region", { name: "Get started" })).toBeNull();
    expect(loadChecklist()?.dismissed).toBe(true);
  });

  it("goes away once every step is done", () => {
    startChecklist();
    render(<GettingStarted />);
    act(() => {
      for (const s of CHECKLIST_STEPS) completeStep(s.id);
    });
    expect(screen.queryByRole("region", { name: "Get started" })).toBeNull();
  });
});
