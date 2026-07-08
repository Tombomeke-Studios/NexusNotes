import { test, expect } from "@playwright/test";
import { register, createVault, clearAuth, openPalette } from "./helpers";

test.describe("Command palette", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+Shift+P opens the palette in command mode", async ({ page }) => {
    const input = await openPalette(page, "commands");
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(">");
  });

  test("typing filters commands", async ({ page }) => {
    const input = await openPalette(page, "commands");
    await input.fill("new note");
    await expect(page.locator(".palette-item").filter({ hasText: /new note/i })).toBeVisible();
  });

  test("selecting 'New note' creates a note", async ({ page }) => {
    const input = await openPalette(page, "commands");
    await input.fill("New note");
    await page.keyboard.press("Enter");
    await expect(page.locator(".editor")).toBeVisible();
  });

  test("palette lists the Open graph command", async ({ page }) => {
    const input = await openPalette(page, "commands");
    await input.fill("graph");
    await expect(page.locator(".palette-item").filter({ hasText: /open graph/i })).toBeVisible();
  });

  test("palette lists the Global search command", async ({ page }) => {
    const input = await openPalette(page, "commands");
    await input.fill("Global search");
    await expect(page.locator(".palette-item").filter({ hasText: /global search/i })).toBeVisible();
  });

  test("palette lists the Sign out command", async ({ page }) => {
    const input = await openPalette(page, "commands");
    await input.fill("Sign out");
    await expect(page.locator(".palette-item").filter({ hasText: /sign out/i })).toBeVisible();
  });

  test("clicking Sign out logs out", async ({ page }) => {
    const input = await openPalette(page, "commands");
    await input.fill("Sign out");
    await page.locator(".palette-item").filter({ hasText: /sign out/i }).click();
    await expect(page.locator(".auth-container").first()).toBeVisible({ timeout: 5_000 });
  });
});
