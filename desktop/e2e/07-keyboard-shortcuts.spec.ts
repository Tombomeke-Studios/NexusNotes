import { test, expect } from "@playwright/test";
import { register, createVault, waitForSaved, clearAuth } from "./helpers";

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
    await page.keyboard.press("Control+Shift+P");
    await expect(page.locator(".command-palette, [class*='command-palette']")).toBeVisible();
  });

  test("Ctrl+Shift+F opens global search", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await expect(page.locator(".global-search")).toBeVisible();
  });

  test("Ctrl+G opens the graph view", async ({ page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".graph-view, [class*='graph']")).toBeVisible({ timeout: 5_000 });
  });

  test("Escape closes quick switcher", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await page.keyboard.press("Escape");
    await expect(page.locator(".quick-switcher")).not.toBeVisible();
  });

  test("Escape closes command palette", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.press("Escape");
    await expect(page.locator(".command-palette")).not.toBeVisible();
  });

  test("Escape closes global search", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await page.keyboard.press("Escape");
    await expect(page.locator(".global-search")).not.toBeVisible();
  });

  test("quick switcher arrow keys move selection", async ({ page }) => {
    // Create two notes first
    await page.keyboard.press("Control+n");
    await waitForSaved(page);
    await page.keyboard.press("Control+n");
    await waitForSaved(page);

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
