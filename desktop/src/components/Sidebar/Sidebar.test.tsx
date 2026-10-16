import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

// Locking an encrypted vault (#545): the header's lock icon and the vault menu.
describe("Sidebar vault lock", () => {
  const e2ee = [
    { id: "v1", user_id: "u1", name: "Private", encryption: "e2ee", created_at: "", updated_at: "" },
  ] as Props["vaults"];
  const vaultMenu = () => {
    fireEvent.click(document.querySelector(".sidebar-vault-btn")!);
    return within(document.querySelector<HTMLElement>(".sidebar-vault-list")!);
  };

  it("locks the open vault from the lock icon while it is unlocked", () => {
    const onLockVault = vi.fn();
    render(<Sidebar {...props({ vaults: e2ee, onLockVault })} />);
    fireEvent.click(screen.getByRole("button", { name: "Lock vault" }));
    expect(onLockVault).toHaveBeenCalledWith("v1");
  });

  it("asks for the passphrase from the lock icon while it is locked", () => {
    const onLockVault = vi.fn();
    const onUnlockVault = vi.fn();
    render(<Sidebar {...props({ vaults: e2ee, activeVaultLocked: true, onLockVault, onUnlockVault })} />);
    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));
    expect(onUnlockVault).toHaveBeenCalled();
    expect(onLockVault).not.toHaveBeenCalled();
  });

  it("offers Lock vault in the vault menu for an unlocked encrypted vault", () => {
    const onLockVault = vi.fn();
    render(<Sidebar {...props({ vaults: e2ee, onLockVault })} />);
    fireEvent.click(vaultMenu().getByRole("button", { name: "Lock vault" }));
    expect(onLockVault).toHaveBeenCalledWith("v1");
  });

  it("has no lock for a standard vault, nor in the menu of a locked one", () => {
    const { unmount } = render(<Sidebar {...props({ onLockVault: vi.fn() })} />);
    expect(screen.queryByRole("button", { name: /lock vault/i })).toBeNull();
    expect(vaultMenu().queryByRole("button", { name: "Lock vault" })).toBeNull();
    unmount();

    render(<Sidebar {...props({ vaults: e2ee, activeVaultLocked: true, onLockVault: vi.fn() })} />);
    expect(vaultMenu().queryByRole("button", { name: "Lock vault" })).toBeNull();
  });
});

// The Trash entry at the bottom of the sidebar (#569).
describe("Sidebar Trash entry", () => {
  it("opens the Trash and shows how many notes are in it", () => {
    const onOpenTrash = vi.fn();
    render(<Sidebar {...props({ trashCount: 3, onOpenTrash })} />);
    const entry = screen.getByRole("button", { name: "Trash, 3 notes" });
    expect(entry).toHaveTextContent("3");
    fireEvent.click(entry);
    expect(onOpenTrash).toHaveBeenCalledOnce();
  });

  it("shows no count when the Trash is empty", () => {
    render(<Sidebar {...props({ trashCount: 0, onOpenTrash: vi.fn() })} />);
    expect(screen.getByRole("button", { name: "Trash" })).not.toHaveTextContent(/\d/);
  });

  it("is not offered while the vault is locked", () => {
    render(<Sidebar {...props({ trashCount: 2, onOpenTrash: vi.fn(), activeVaultLocked: true })} />);
    expect(screen.queryByRole("button", { name: /^Trash/ })).toBeNull();
  });
});
