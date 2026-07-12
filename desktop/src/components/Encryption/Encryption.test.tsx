import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { EncryptionSetup } from "./EncryptionSetup";
import { RecoveryCodeDialog } from "./RecoveryCodeDialog";
import { CreateVaultDialog } from "./CreateVaultDialog";
import { UnlockVaultDialog } from "./UnlockVaultDialog";
import { ChangePassphraseForm } from "./ChangePassphraseForm";

/** Stateful wrapper so the controlled EncryptionSetup behaves like in the app. */
function SetupHarness({ initialEnabled = false }: { initialEnabled?: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <EncryptionSetup
      enabled={enabled}
      passphrase={passphrase}
      confirm={confirm}
      onToggle={setEnabled}
      onPassphraseChange={setPassphrase}
      onConfirmChange={setConfirm}
    />
  );
}

describe("EncryptionSetup", () => {
  it("hides the passphrase fields until the toggle is enabled", () => {
    render(<SetupHarness />);
    expect(screen.queryByPlaceholderText("Vault passphrase")).toBeNull();

    fireEvent.click(screen.getByLabelText(/end-to-end encrypt/i));
    expect(screen.getByPlaceholderText("Vault passphrase")).toBeTruthy();
    expect(screen.getByPlaceholderText("Confirm passphrase")).toBeTruthy();
  });

  it("shows a mismatch error while the confirm differs", () => {
    render(<SetupHarness initialEnabled />);
    fireEvent.change(screen.getByPlaceholderText("Vault passphrase"), {
      target: { value: "a strong passphrase" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm passphrase"), {
      target: { value: "something else" },
    });
    expect(screen.getByText("Passphrases do not match")).toBeTruthy();
  });
});

describe("RecoveryCodeDialog", () => {
  it("shows the code and gates Continue behind the saved confirmation", () => {
    const onDone = vi.fn();
    render(<RecoveryCodeDialog code="ABCD-EFGH-1234" onDone={onDone} />);

    expect(screen.getByTestId("recovery-code").textContent).toBe("ABCD-EFGH-1234");

    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toHaveProperty("disabled", true);
    fireEvent.click(cont);
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/saved this recovery code/i));
    fireEvent.click(cont);
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe("CreateVaultDialog", () => {
  it("creates a standard vault with just a name (Enter submits)", () => {
    const onCreate = vi.fn();
    render(<CreateVaultDialog onCreate={onCreate} onClose={() => {}} />);

    const name = screen.getByPlaceholderText("Vault name...");
    fireEvent.change(name, { target: { value: "Work" } });
    fireEvent.keyDown(name, { key: "Enter" });

    expect(onCreate).toHaveBeenCalledWith("Work", undefined);
  });

  it("requires a valid passphrase pair when encryption is enabled", () => {
    const onCreate = vi.fn();
    render(<CreateVaultDialog onCreate={onCreate} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("Vault name..."), { target: { value: "Secret" } });
    fireEvent.click(screen.getByLabelText(/end-to-end encrypt/i));

    const create = screen.getByRole("button", { name: "Create vault" });
    expect(create).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByPlaceholderText("Vault passphrase"), {
      target: { value: "a strong passphrase" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm passphrase"), {
      target: { value: "a strong passphrase" },
    });
    fireEvent.click(create);

    expect(onCreate).toHaveBeenCalledWith("Secret", "a strong passphrase");
  });
});

describe("UnlockVaultDialog", () => {
  it("passes the passphrase to onUnlock on Enter", async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    render(<UnlockVaultDialog vaultName="Secret" onUnlock={onUnlock} onCancel={() => {}} />);

    const input = screen.getByPlaceholderText("Vault passphrase");
    fireEvent.change(input, { target: { value: "open sesame please" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith("open sesame please"));
  });

  it("shows an error and re-enables the form when the unlock rejects", async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error("bad key"));
    render(<UnlockVaultDialog vaultName="Secret" onUnlock={onUnlock} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("Vault passphrase"), {
      target: { value: "wrong one entirely" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(screen.getByText(/wrong passphrase/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Unlock" })).toHaveProperty("disabled", false);
  });

  it("disables Unlock while empty", () => {
    render(<UnlockVaultDialog vaultName="Secret" onUnlock={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Unlock" })).toHaveProperty("disabled", true);
  });
});

describe("ChangePassphraseForm", () => {
  const openForm = () => {
    fireEvent.click(screen.getByRole("button", { name: /change passphrase/i }));
  };

  it("submits current + new passphrase and collapses on success", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<ChangePassphraseForm onChange={onChange} />);
    openForm();

    fireEvent.change(screen.getByPlaceholderText("Current passphrase"), {
      target: { value: "old passphrase here" },
    });
    fireEvent.change(screen.getByPlaceholderText("New passphrase"), {
      target: { value: "shiny new passphrase" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm new passphrase"), {
      target: { value: "shiny new passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change passphrase" }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("old passphrase here", "shiny new passphrase"),
    );
    // Collapsed back to the entry button.
    expect(screen.getByRole("button", { name: /change passphrase…/i })).toBeTruthy();
  });

  it("shows a wrong-passphrase error when the change rejects", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("bad unwrap"));
    render(<ChangePassphraseForm onChange={onChange} />);
    openForm();

    fireEvent.change(screen.getByPlaceholderText("Current passphrase"), {
      target: { value: "wrong old one" },
    });
    fireEvent.change(screen.getByPlaceholderText("New passphrase"), {
      target: { value: "shiny new passphrase" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm new passphrase"), {
      target: { value: "shiny new passphrase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change passphrase" }));

    await waitFor(() => expect(screen.getByText(/current passphrase is wrong/i)).toBeTruthy());
  });

  it("disables submit while the new passphrases do not match", () => {
    render(<ChangePassphraseForm onChange={vi.fn()} />);
    openForm();

    fireEvent.change(screen.getByPlaceholderText("Current passphrase"), {
      target: { value: "old passphrase here" },
    });
    fireEvent.change(screen.getByPlaceholderText("New passphrase"), {
      target: { value: "shiny new passphrase" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm new passphrase"), {
      target: { value: "different" },
    });
    expect(screen.getByRole("button", { name: "Change passphrase" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
