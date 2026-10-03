import { test, expect } from "@playwright/test";
import { register, createVault, createNote, typeInEditor, waitForSaved } from "./helpers";

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

    // The quick-start guide is starred, and a template and today's daily note
    // are there to try Ctrl+T and Ctrl+D on (#445, #449).
    await expect(page.locator(".sidebar-recent").filter({ hasText: "Starred" })).toContainText("Getting Started", {
      timeout: 8_000,
    });
    await expect(page.locator('.tree-folder-label:has-text("Templates")')).toBeVisible();
    await expect(page.locator('.tree-folder-label:has-text("Daily")')).toBeVisible();
    await expect(page.locator('.tree-note:has-text("My First Note")')).toBeVisible();
  });

  test("the first-launch checklist ticks itself and goes away when done (#447)", async ({ page }) => {
    await register(page);
    await createVault(page, undefined, { keepSeed: true });
    const card = page.getByRole("region", { name: "Get started" });
    await expect(card).toContainText("0 of 4");
    await page.keyboard.press("Control+g");
    await expect(card).toContainText("1 of 4");
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.press("Escape");
    await expect(card).toContainText("2 of 4");
    await createNote(page, "Mine");
    await expect(card).toContainText("3 of 4");
    await typeInEditor(page, "Linking to [[Welcome]]");
    await waitForSaved(page);
    await expect(card).toHaveCount(0, { timeout: 5_000 });
  });
});
