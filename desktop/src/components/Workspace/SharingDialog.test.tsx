import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "../../lib/types";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  invite: vi.fn(),
  updateRole: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../lib/api", () => ({ members: api }));

import { SharingDialog } from "./SharingDialog";

function vault(encryption: Vault["encryption"]): Vault {
  return {
    id: "v1",
    user_id: "u1",
    name: "Work",
    encryption,
    role: "owner",
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
  };
}

function renderDialog(encryption: Vault["encryption"]) {
  render(<SharingDialog vault={vault(encryption)} currentUserId="u1" isOwner onClose={vi.fn()} onLeft={vi.fn()} />);
}

async function typeInvite(email = "sam@example.com") {
  await waitFor(() => expect(api.list).toHaveBeenCalled());
  fireEvent.change(screen.getByPlaceholderText("Invite by email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Invite" }));
}

describe("SharingDialog", () => {
  beforeEach(() => {
    api.list.mockResolvedValue([]);
    api.invite.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("invites at once in a standard vault", async () => {
    renderDialog("none");
    await typeInvite();
    await waitFor(() => expect(api.invite).toHaveBeenCalledWith("v1", "sam@example.com", "viewer"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("explains the passphrase, naming the vault, before inviting to an encrypted vault", async () => {
    renderDialog("e2ee");
    await typeInvite();
    const warning = screen.getByRole("group", { name: /before you invite/i });
    expect(warning).toHaveTextContent(/“Work” is end-to-end encrypted/);
    expect(warning).toHaveTextContent(/sam@example.com/);
    expect(warning).toHaveTextContent(/passphrase/i);
    expect(api.invite).not.toHaveBeenCalled();
  });

  it("focuses Cancel, and Cancel invites no one", async () => {
    renderDialog("e2ee");
    await typeInvite();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(screen.queryByRole("group", { name: /before you invite/i })).toBeNull();
    expect(api.invite).not.toHaveBeenCalled();
    // The typed address stays, so the owner can still go ahead later.
    expect(screen.getByPlaceholderText("Invite by email")).toHaveValue("sam@example.com");
  });

  it("invites only after the owner confirms", async () => {
    renderDialog("e2ee");
    await typeInvite();
    fireEvent.click(screen.getByRole("button", { name: "Invite anyway" }));
    await waitFor(() => expect(api.invite).toHaveBeenCalledWith("v1", "sam@example.com", "viewer"));
    await waitFor(() => expect(screen.queryByRole("group", { name: /before you invite/i })).toBeNull());
  });
});
