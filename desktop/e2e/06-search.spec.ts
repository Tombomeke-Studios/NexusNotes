import { test, expect } from "@playwright/test";
import { register, createVault, createNote, waitForAutosave, clearAuth, openPalette } from "./helpers";

// The redesign unifies quick-open and commands into one palette: Ctrl+P opens
// it in note mode, Ctrl+Shift+P in command mode. Ctrl+Shift+F is the separate
// full-text global search.
test.describe("Command palette quick-open (Ctrl+P)", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+P opens the palette", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await expect(page.locator(".palette")).toBeVisible();
  });

  test("Escape closes the palette", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await expect(page.locator(".palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).not.toBeVisible();
  });

  test("typing filters the note list", async ({ page }) => {
    await createNote(page, "AlphaNote");
    await createNote(page, "BetaNote");

    await page.keyboard.press("Control+p");
    await page.locator(".palette-head input").fill("Alpha");

    await expect(page.locator(".palette-item").filter({ hasText: "AlphaNote" })).toBeVisible();
    await expect(page.locator(".palette-item").filter({ hasText: "BetaNote" })).not.toBeVisible();
  });

  test("pressing Enter on a result navigates to that note", async ({ page }) => {
    await createNote(page, "NavigateMe");
    const body = page.locator(".editor-textarea").first();
    await body.click();
    await body.fill("navigate me body");
    await waitForAutosave(page);

    await page.keyboard.press("Control+p");
    await page.locator(".palette-head input").fill("NavigateMe");
    await page.keyboard.press("Enter");

    await expect(page.locator(".editor-title-input").first()).toHaveValue(/NavigateMe/i);
    await expect(page.locator(".palette")).not.toBeVisible();
  });

  test("shows 'No matches' for a query matching nothing", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await page.locator(".palette-head input").fill("xyzxyzxyz_nomatch");
    await expect(page.locator("text=/no matches/i")).toBeVisible();
  });
});

test.describe("Global search (Ctrl+Shift+F)", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+Shift+F opens the global search panel", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await expect(page.locator(".global-search")).toBeVisible();
  });

  test("Escape closes global search", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await page.keyboard.press("Escape");
    await expect(page.locator(".global-search")).not.toBeVisible();
  });

  test("returns full-text results for a query", async ({ page }) => {
    await createNote(page, "Searchable");
    const body = page.locator(".editor-textarea").first();
    await body.click();
    await body.fill("the transformer architecture is powerful");
    await waitForAutosave(page);

    await page.keyboard.press("Control+Shift+F");
    await page.locator(".global-search-input").fill("transformer");
    await expect(page.locator(".global-search-item").filter({ hasText: "Searchable" })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("global search command appears in the command palette", async ({ page }) => {
    const input = await openPalette(page, "commands");
    await input.fill("Global search");
    await expect(page.locator(".palette-item").filter({ hasText: /global search/i })).toBeVisible();
  });
});
