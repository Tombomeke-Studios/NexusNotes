import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import type { SaveError, SaveStatus } from "../lib/useNoteSave";

function renderBar(saveStatus: SaveStatus, saveError: SaveError | null = null) {
  return render(
    <StatusBar
      content="hello world"
      saveStatus={saveStatus}
      saveError={saveError}
      hasNote
      lastSyncLabel={null}
      line={1}
      col={1}
      viewMode="edit"
      onCycleView={() => {}}
    />,
  );
}

describe("StatusBar save indicator", () => {
  it("shows the plain status when nothing went wrong", () => {
    renderBar("saved");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows a conflict with a hint and the full explanation as tooltip", () => {
    const message = "This note was changed elsewhere.";
    renderBar("conflict", { noteId: "n1", kind: "conflict", message });

    const indicator = screen.getByText("Conflict").closest(".status-indicator");
    expect(indicator).toHaveClass("status-indicator--conflict");
    expect(indicator).toHaveAttribute("title", message);
    expect(screen.getByText(/not saved/i)).toBeInTheDocument();
  });

  it("tells the user a failed save is being retried while offline", () => {
    renderBar("unsaved", { noteId: "n1", kind: "network", message: "Can't reach the server." });
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByText(/offline, retrying/i)).toBeInTheDocument();
  });

  it("flags other save failures", () => {
    renderBar("unsaved", { noteId: "n1", kind: "failed", message: "Couldn't save this note: boom" });
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
  });

  it("hides the error hint while a retry is in flight", () => {
    renderBar("saving", { noteId: "n1", kind: "network", message: "Can't reach the server." });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.queryByText(/retrying/i)).toBeNull();
  });
});
