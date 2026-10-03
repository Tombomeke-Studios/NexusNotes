import { test, expect } from "@playwright/test";
import { register, clearAuth, createVault, openPalette } from "./helpers";

// Weekly and monthly notes (#240).
test.describe("Periodic notes", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  for (const [command, folder, title] of [
    ["Open this week's note", "Weekly", /^\d{4}-W\d{2}$/],
    ["Open this month's note", "Monthly", /^\d{4}-\d{2}$/],
  ] as const) {
    test(`${command} creates it once from its template`, async ({ page }) => {
      const input = await openPalette(page, "commands");
      await input.fill(`>${command}`);
      await page.keyboard.press("Enter");
      const titleInput = page.locator(".editor-title-input");
      await expect(titleInput).toHaveValue(title, { timeout: 8_000 });
      const name = await titleInput.inputValue();
      await expect(page.locator(".editor-textarea").first()).toHaveValue(new RegExp(`^# ${name}`));
      await expect(page.locator(`.tree-folder-label:has-text("${folder}")`)).toBeVisible();

      // A second time opens the same note.
      const again = await openPalette(page, "commands");
      await again.fill(`>${command}`);
      await page.keyboard.press("Enter");
      await expect(titleInput).toHaveValue(name);
      await expect(page.locator(".tree-note", { hasText: name })).toHaveCount(1);
    });
  }
});
