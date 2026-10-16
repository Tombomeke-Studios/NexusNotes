import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VaultLockButton, VaultLockIcon } from "./VaultLockIcon";

describe("VaultLockIcon", () => {
  it("does not wobble on first render", () => {
    const { container } = render(<VaultLockIcon locked />);
    expect(container.querySelector("svg")?.getAttribute("class")).not.toContain("--wobble");
  });

  it("wobbles when the vault is unlocked or locked again", () => {
    const { container, rerender } = render(<VaultLockIcon locked />);
    rerender(<VaultLockIcon locked={false} />);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("sidebar-vault-lock--wobble");
    rerender(<VaultLockIcon locked />);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("sidebar-vault-lock--wobble");
  });

  it("swings the shackle shut when the vault locks (#545)", () => {
    const { container, rerender } = render(<VaultLockIcon locked={false} />);
    const shackle = () => container.querySelector(".sidebar-vault-shackle")!;
    expect(shackle().getAttribute("class")).toContain("sidebar-vault-shackle--open");
    rerender(<VaultLockIcon locked />);
    expect(shackle().getAttribute("class")).not.toContain("--open");
    expect(shackle().getAttribute("class")).toContain("sidebar-vault-shackle--closing");
  });

  it("does not animate the shackle on first paint", () => {
    const { container } = render(<VaultLockIcon locked />);
    expect(container.querySelector(".sidebar-vault-shackle")!.getAttribute("class")).not.toContain("--closing");
  });

  it("is a button that locks while unlocked and unlocks while locked", () => {
    const onLock = vi.fn();
    const onUnlock = vi.fn();
    const { rerender } = render(<VaultLockButton locked={false} onLock={onLock} onUnlock={onUnlock} />);
    fireEvent.click(screen.getByRole("button", { name: "Lock vault" }));
    expect(onLock).toHaveBeenCalledTimes(1);
    rerender(<VaultLockButton locked onLock={onLock} onUnlock={onUnlock} />);
    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("shows an open shackle while unlocked and says so", () => {
    const { container, rerender } = render(<VaultLockIcon locked />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Encrypted vault, locked");
    rerender(<VaultLockIcon locked={false} />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Encrypted vault, unlocked");
  });
});
