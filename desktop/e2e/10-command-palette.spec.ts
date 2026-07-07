import { test, expect } from "@playwright/test";
import { register, createVault, clearAuth, openCommandPalette } from "./helpers";

test.describe("Command palette", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+Shift+P opens the command palette", async ({ page }) => {
    const input = await openCommandPalette(page);
    await expect(input).toBeVisible();
  });

  test("command palette has a search input", async ({ page }) => {
    const input = await openCommandPalette(page);
    await expect(input).toBeVisible();
  });

  test("typing filters commands", async ({ page }) => {
    const input = await openCommandPalette(page);
    await input.fill("new note");
    await expect(
      page.locator(".quick-switcher-item").filter({ hasText: /new note/i })
    ).toBeVisible();
  });

  test("selecting 'New Note' creates a note", async ({ page }) => {
    const input = await openCommandPalette(page);
    await input.fill("New Note");
    await page.keyboard.press("Enter");
    await expect(page.locator(".editor, .editor-container")).toBeVisible();
  });

  test("command palette lists Quick Switcher command", async ({ page }) => {
    const input = await openCommandPalette(page);
    await input.fill("Quick Switcher");
    await expect(
      page.locator(".quick-switcher-item").filter({ hasText: /quick switcher/i })
    ).toBeVisible();
  });

  // The Global Search command ships with the Meilisearch branch (PR #90).
  test.fixme("command palette lists Global Search command", async ({ page }) => {
    const input = await openCommandPalette(page);
    await input.fill("Global Search");
    await expect(
      page.locator(".quick-switcher-item").filter({ hasText: /global search/i })
    ).toBeVisible();
  });

  test("command palette lists Sign Out command", async ({ page }) => {
    const input = await openCommandPalette(page);
    await input.fill("Sign Out");
    await expect(
      page.locator(".quick-switcher-item").filter({ hasText: /sign out/i })
    ).toBeVisible();
  });

  test("clicking Sign Out logs out", async ({ page }) => {
    const input = await openCommandPalette(page);
    await input.fill("Sign Out");
    await page.locator(".quick-switcher-item").filter({ hasText: /sign out/i }).click();
    await expect(page.locator(".auth-container").first()).toBeVisible({ timeout: 5_000 });
  });
});
