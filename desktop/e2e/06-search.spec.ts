import { test, expect } from "@playwright/test";
import { register, createVault, waitForAutosave, clearAuth } from "./helpers";

test.describe("Quick Switcher (Ctrl+P)", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+P opens the quick switcher panel", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await expect(page.locator(".quick-switcher")).toBeVisible();
  });

  test("Escape closes the quick switcher", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await expect(page.locator(".quick-switcher")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".quick-switcher")).not.toBeVisible();
  });

  test("typing filters the note list", async ({ page }) => {
    // Create two distinctly named notes
    await page.keyboard.press("Control+n");
    const title1 = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await title1.click({ clickCount: 3 });
    await title1.fill("AlphaNote");
    await title1.press("Tab");

    await page.keyboard.press("Control+n");
    const title2 = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await title2.click({ clickCount: 3 });
    await title2.fill("BetaNote");
    await title2.press("Tab");

    await page.keyboard.press("Control+p");
    await page.locator(".quick-switcher-input").fill("Alpha");

    await expect(page.locator(".quick-switcher-item").filter({ hasText: "AlphaNote" })).toBeVisible();
    await expect(page.locator(".quick-switcher-item").filter({ hasText: "BetaNote" })).not.toBeVisible();
  });

  test("pressing Enter on a result navigates to that note", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const titleInput = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill("NavigateMe");
    await titleInput.press("Tab");
    // Persist the rename via a content autosave so the server knows the title
    const body = page.locator(".editor-textarea, textarea").first();
    await body.click();
    await body.fill("navigate me body");
    await waitForAutosave(page);

    await page.keyboard.press("Control+p");
    await page.locator(".quick-switcher-input").fill("NavigateMe");
    await page.keyboard.press("Enter");

    await expect(
      page.locator(".editor-toolbar-title, input[class*='title']").first()
    ).toHaveValue(/NavigateMe/i);
    await expect(page.locator(".quick-switcher")).not.toBeVisible();
  });

  test("shows 'No results' for a query matching nothing", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await page.locator(".quick-switcher-input").fill("xyzxyzxyz_nomatch");
    await expect(page.locator("text=/no results/i")).toBeVisible();
  });
});

test.describe("Global Search (Ctrl+Shift+F)", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("Ctrl+Shift+F opens global search panel", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await expect(page.locator(".global-search")).toBeVisible();
  });

  test("Escape closes global search", async ({ page }) => {
    await page.keyboard.press("Control+Shift+F");
    await page.keyboard.press("Escape");
    await expect(page.locator(".global-search")).not.toBeVisible();
  });

  test("displays search unavailable gracefully when backend is down", async ({ page }) => {
    // This test checks the 503 fallback without a real Meilisearch
    await page.keyboard.press("Control+Shift+F");
    const searchInput = page.locator(".global-search-input");
    await searchInput.fill("test query");
    // Either shows results or shows "search unavailable" — never crashes
    await expect(
      page.locator("text=/search unavailable|no results|searching/i")
    ).toBeVisible({ timeout: 5_000 });
  });

  test("global search appears in command palette", async ({ page }) => {
    await page.keyboard.press("Control+Shift+P");
    await page.getByPlaceholder("Type a command...").fill("Global Search");
    await expect(
      page.locator(".quick-switcher-item").filter({ hasText: /global search/i })
    ).toBeVisible();
  });
});
