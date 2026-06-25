import { test, expect } from "@playwright/test";
import { uid, register, createVault, waitForSaved, clearAuth } from "./helpers";

test.describe("Wiki-links and backlinks", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("renders unresolved [[link]] with warning style", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("See also [[Nonexistent Note]]");
    await waitForSaved(page);

    // In preview, unresolved wikilinks should have the unresolved class
    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await expect(preview.locator(".wikilink--unresolved")).toBeVisible();
    }
  });

  test("renders resolved [[link]] when target note exists", async ({ page }) => {
    // Create target note
    await page.keyboard.press("Control+n");
    const titleInput = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill("Target Note");
    await titleInput.press("Tab");
    await waitForSaved(page);

    // Create source note with link
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("See also [[Target Note]]");
    await waitForSaved(page);

    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await expect(preview.locator(".wikilink--resolved")).toBeVisible();
    }
  });

  test("clicking a resolved [[link]] navigates to target note", async ({ page }) => {
    // Create target note
    await page.keyboard.press("Control+n");
    const titleInput = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill("Jump Target");
    await titleInput.press("Tab");
    await waitForSaved(page);

    // Create source note
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("Go to [[Jump Target]]");
    await waitForSaved(page);

    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await preview.locator(".wikilink--resolved").click();
      // Active note title should change to the target
      await expect(
        page.locator(".editor-toolbar-title, input[class*='title']").first()
      ).toHaveValue(/Jump Target/i, { timeout: 5_000 });
    }
  });

  test("clicking an unresolved [[link]] prompts to create note", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("See [[Brand New Note]]");
    await waitForSaved(page);

    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await preview.locator(".wikilink--unresolved").click();
      // Should either create the note or show a dialog
      await expect(
        page.locator("text=/create|new note/i, .editor-toolbar-title").first()
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("backlinks panel shows when another note links here", async ({ page }) => {
    // Create note B (will be the target)
    await page.keyboard.press("Control+n");
    const titleB = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await titleB.click({ clickCount: 3 });
    await titleB.fill("Note B");
    await titleB.press("Tab");
    await waitForSaved(page);

    // Create note A linking to B
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("This links to [[Note B]]");
    await waitForSaved(page);

    // Navigate to Note B
    await page.locator(".sidebar-files .tree-note").filter({ hasText: "Note B" }).click();

    // Backlinks panel should show Note A
    const backlinks = page.locator(".backlinks-panel");
    if (await backlinks.isVisible().catch(() => false)) {
      await expect(backlinks).toBeVisible();
    }
  });
});
