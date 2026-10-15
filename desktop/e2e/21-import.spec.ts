import { test, expect } from "@playwright/test";
import { register, clearAuth, createVault } from "./helpers";

// Importing existing Markdown notes (#451).
test.describe("Import notes", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
  });

  test("imports picked Markdown files and skips what is already there", async ({ page }) => {
    await createVault(page);
    const files = page.locator('input[type="file"][accept*=".md"]');
    await files.setInputFiles([
      { name: "Recipes.md", mimeType: "text/markdown", buffer: Buffer.from("# Recipes\n\nSee [[Shopping]].") },
      { name: "Shopping.md", mimeType: "text/markdown", buffer: Buffer.from("- eggs\r\n- milk") },
      { name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50]) },
    ]);
    // The image no note links to is attached to an "Imported files" note (#551).
    await expect(page.getByRole("status").filter({ hasText: "Imported 3 notes and 1 file." })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('.tree-note:has-text("Recipes")')).toBeVisible();
    await expect(page.locator('.tree-note:has-text("Shopping")')).toBeVisible();
    await expect(page.locator('.tree-note:has-text("Imported files")')).toBeVisible();

    await page.locator('.tree-note:has-text("Shopping")').click();
    await expect(page.locator(".editor-textarea").first()).toHaveValue("- eggs\n- milk");

    // The same files again: nothing new.
    await files.setInputFiles([
      { name: "Recipes.md", mimeType: "text/markdown", buffer: Buffer.from("again") },
      { name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50]) },
    ]);
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 0 notes and 0 files. Skipped 2: 2 already in the vault." }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
