import { test, expect } from "@playwright/test";
import { register, createVault, createNote, clearAuth } from "./helpers";

test.describe("Keyboard shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+N creates a new note", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(page.locator(".editor")).toBeVisible();
  });

  test("Ctrl+P opens the palette (note mode)", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await expect(page.locator(".palette")).toBeVisible();
  });

  test("Ctrl+Shift+P opens the palette (command mode)", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await expect(page.locator(".palette")).toBeVisible();
    // Command mode prefixes the query with ">"
    await expect(page.locator(".palette-head input")).toHaveValue(">");
  });

  test("Ctrl+Shift+F opens global search", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await expect(page.locator(".global-search")).toBeVisible();
  });

  test("Ctrl+G opens the graph tab", async ({ page }) => {
    await page.keyboard.press("Control+g");
    await expect(page.locator(".graph-view")).toBeVisible({ timeout: 5_000 });
  });

  test("Escape closes the palette", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).not.toBeVisible();
  });

  test("Escape closes global search", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await page.keyboard.press("Escape");
    await expect(page.locator(".global-search")).not.toBeVisible();
  });

  test("Ctrl+B toggles the left sidebar", async ({ page }) => {
    const panel = page.locator(".panel-left");
    await expect(panel).not.toHaveClass(/panel-left--closed/);
    await page.keyboard.press("Control+b");
    await expect(panel).toHaveClass(/panel-left--closed/);
    await page.keyboard.press("Control+b");
    await expect(panel).not.toHaveClass(/panel-left--closed/);
  });

  test("palette arrow keys move the selection", async ({ page }) => {
    await createNote(page, "First Arrow Note");
    await createNote(page, "Second Arrow Note");

    await page.keyboard.press("Control+p");
    const palette = page.locator(".palette");
    await expect(palette).toBeVisible();

    await expect(palette.locator(".palette-item--selected")).toBeVisible();
    const firstText = await palette.locator(".palette-item--selected .palette-item-title").textContent();

    await page.keyboard.press("ArrowDown");
    const secondText = await palette.locator(".palette-item--selected .palette-item-title").textContent();
    expect(firstText).not.toEqual(secondText);

    await page.keyboard.press("ArrowUp");
    const backText = await palette.locator(".palette-item--selected .palette-item-title").textContent();
    expect(backText).toEqual(firstText);
  });
});
