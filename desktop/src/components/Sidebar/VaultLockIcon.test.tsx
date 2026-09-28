import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { VaultLockIcon } from "./VaultLockIcon";

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

  it("shows an open shackle while unlocked and says so", () => {
    const { container, rerender } = render(<VaultLockIcon locked />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Encrypted vault, locked");
    rerender(<VaultLockIcon locked={false} />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Encrypted vault, unlocked");
  });
});
