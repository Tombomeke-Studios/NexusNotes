import { test, expect } from "@playwright/test";
import { register, createVault, clearAuth } from "./helpers";

test.describe("Command palette", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+Shift+P opens the command palette", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await expect(page.locator(".command-palette, [class*='command-palette']")).toBeVisible();
  });

  test("command palette has a search input", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await expect(
      page.locator(".command-palette input, .command-input, [placeholder*='command' i]")
    ).toBeVisible();
  });

  test("typing filters commands", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    const input = page.locator(".command-palette input, .command-input").first();
    await input.fill("new note");
    await expect(
      page.locator("[class*='command-item'], [class*='palette-item']").filter({ hasText: /new note/i })
    ).toBeVisible();
  });

  test("selecting 'New Note' creates a note", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    const input = page.locator(".command-palette input, .command-input").first();
    await input.fill("New Note");
    await page.keyboard.press("Enter");
    await expect(page.locator(".editor, .editor-container")).toBeVisible();
  });

  test("command palette lists Quick Switcher command", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await page.locator(".command-palette input, .command-input").first().fill("Quick Switcher");
    await expect(
      page.locator("[class*='command-item'], [class*='palette-item']").filter({ hasText: /quick switcher/i })
    ).toBeVisible();
  });

  test("command palette lists Global Search command", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await page.locator(".command-palette input, .command-input").first().fill("Global Search");
    await expect(
      page.locator("[class*='command-item'], [class*='palette-item']").filter({ hasText: /global search/i })
    ).toBeVisible();
  });

  test("command palette lists Sign Out command", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await page.locator(".command-palette input, .command-input").first().fill("Sign Out");
    await expect(
      page.locator("[class*='command-item'], [class*='palette-item']").filter({ hasText: /sign out/i })
    ).toBeVisible();
  });

  test("clicking Sign Out logs out", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await page.locator(".command-palette input, .command-input").first().fill("Sign Out");
    await page.locator("[class*='command-item'], [class*='palette-item']").filter({ hasText: /sign out/i }).click();
    await expect(page.locator(".auth-container, .auth-form, form")).toBeVisible({ timeout: 5_000 });
  });
});
