import { test, expect } from "@playwright/test";
import { register, createVault } from "./helpers";

test.describe("Onboarding", () => {
  test("a fresh account's first vault is seeded with welcome notes", async ({ page }) => {
    await register(page);
    await createVault(page, undefined, { keepSeed: true });

    // The Welcome note opens automatically.
    await expect(page.locator(".editor-title-input")).toHaveValue("Welcome", { timeout: 8_000 });

    // The example notes and folder appear in the tree.
    await expect(page.locator('.tree-note:has-text("Welcome")')).toBeVisible();
    await expect(page.locator('.tree-note:has-text("Getting Started")')).toBeVisible();
    await expect(page.locator('.tree-folder-label:has-text("Examples")')).toBeVisible();
  });
});
