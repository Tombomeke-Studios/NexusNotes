import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Sidebar } from "./Sidebar";

type Props = ComponentProps<typeof Sidebar>;

function props(overrides: Partial<Props> = {}): Props {
  const noop = vi.fn();
  return {
    view: "files",
    vaults: [{ id: "v1", user_id: "u1", name: "Vault", encryption: "none", created_at: "", updated_at: "" }],
    activeVaultId: "v1",
    tree: [],
    activeNoteId: null,
    tagCounts: [],
    folders: [],
    filterTags: [],
    filterFolder: null,
    sortBy: "updated",
    searchQuery: "",
    searchHits: [],
    onSelectVault: noop,
    onSelectNote: noop,
    onNoteClick: noop,
    selectedIds: new Set(),
    onSetSelectedIds: noop,
    onCreateNote: noop,
    onCreateNoteInFolder: noop,
    onCreateFolder: noop,
    onMoveNote: noop,
    onDeleteFolder: noop,
    onRequestNewVault: noop,
    onShareVault: noop,
    onOpenLinks: noop,
    onToggleTag: noop,
    onRenameTag: noop,
    onSetFolder: noop,
    onSetSort: noop,
    onClearFilters: noop,
    onSearchChange: noop,
    onSignOut: noop,
    starredIds: new Set(),
    starredNotes: [],
    recentNotes: [],
    ...overrides,
  } as Props;
}

// Loading placeholders in the file tree (#434).
describe("Sidebar while the vault loads", () => {
  it("shows placeholder rows instead of the empty state", () => {
    render(<Sidebar {...props({ loading: true })} />);
    expect(screen.getByRole("status", { name: "Loading notes" })).toBeTruthy();
    expect(screen.queryByText(/No notes yet/)).toBeNull();
  });

  it("shows the empty state once loaded", () => {
    render(<Sidebar {...props()} />);
    expect(screen.queryByRole("status", { name: "Loading notes" })).toBeNull();
    expect(screen.getByText(/No notes yet/)).toBeTruthy();
  });
});
