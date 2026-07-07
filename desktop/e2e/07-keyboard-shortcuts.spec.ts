import { test, expect } from "@playwright/test";
import { register, createVault, clearAuth, openCommandPalette } from "./helpers";

test.describe("Keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+N creates a new note", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(page.locator(".editor, .editor-container")).toBeVisible();
  });

  test("Ctrl+P opens the quick switcher", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await expect(page.locator(".quick-switcher")).toBeVisible();
  });

  test("Ctrl+Shift+P opens the command palette", async ({ page }) => {
    const input = await openCommandPalette(page);
    await expect(input).toBeVisible();
  });

  test("Ctrl+Shift+F opens global search", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await expect(page.locator(".global-search")).toBeVisible();
  });

  test("Ctrl+G opens the graph view", async ({ page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".graph-container")).toBeVisible({ timeout: 5_000 });
  });

  test("Escape closes quick switcher", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await page.keyboard.press("Escape");
    await expect(page.locator(".quick-switcher")).not.toBeVisible();
  });

  test("Escape closes command palette", async ({ page }) => {
    await openCommandPalette(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".quick-switcher")).not.toBeVisible();
  });

  test("Escape closes global search", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await page.keyboard.press("Escape");
    await expect(page.locator(".global-search")).not.toBeVisible();
  });

  test("quick switcher arrow keys move selection", async ({ page }) => {
    // Create two notes with distinct titles so selection changes are observable
    await page.keyboard.press("Control+n");
    const title1 = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await title1.click({ clickCount: 3 });
    await title1.fill("First Arrow Note");
    await title1.press("Tab");

    await page.keyboard.press("Control+n");
    const title2 = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await title2.click({ clickCount: 3 });
    await title2.fill("Second Arrow Note");
    await title2.press("Tab");

    await page.keyboard.press("Control+p");
    const switcher = page.locator(".quick-switcher");
    await expect(switcher).toBeVisible();

    // First item should be selected
    await expect(switcher.locator(".quick-switcher-item.selected")).toBeVisible();
    const firstText = await switcher.locator(".quick-switcher-item.selected .quick-switcher-title").textContent();

    // Arrow down should change selection
    await page.keyboard.press("ArrowDown");
    const secondText = await switcher.locator(".quick-switcher-item.selected .quick-switcher-title").textContent();
    expect(firstText).not.toEqual(secondText);

    // Arrow up should go back
    await page.keyboard.press("ArrowUp");
    const backText = await switcher.locator(".quick-switcher-item.selected .quick-switcher-title").textContent();
    expect(backText).toEqual(firstText);
  });
});
