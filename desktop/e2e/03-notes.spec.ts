import { test, expect } from "@playwright/test";
import { uid, register, createVault, waitForAutosave, clearAuth } from "./helpers";

test.describe("Note CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("creates a new note via Ctrl+N", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(page.locator(".editor")).toBeVisible();
  });

  test("new note appears in the sidebar file tree", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(page.locator(".sidebar-tree .tree-note")).toBeVisible({ timeout: 8_000 });
  });

  test("types content and it appears in the editor", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("Hello **world** from E2E");
    await expect(textarea).toHaveValue("Hello **world** from E2E");
  });

  test("content auto-saves (status shows Saved)", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill(`Auto-save test ${uid()}`);
    await waitForAutosave(page);
  });

  test("note persists after page reload", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    const content = `Persist test ${uid()}`;
    await textarea.fill(content);
    await waitForAutosave(page);

    await page.reload();
    await page.locator(".sidebar-tree .tree-note").first().click();
    await expect(page.locator(".editor-textarea").first()).toHaveValue(content);
  });

  test("note title is editable in the toolbar", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const titleInput = page.locator(".editor-title-input").first();
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill("My Custom Title");
    await titleInput.press("Tab");

    await expect(
      page.locator(".sidebar-tree .tree-note").filter({ hasText: "My Custom Title" }),
    ).toBeVisible();
  });

  test("markdown preview renders bold text", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("This is **bold** text");
    await waitForAutosave(page);
    await expect(page.locator(".editor-preview strong")).toBeVisible();
  });

  test("multiple notes appear in the sidebar tree", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(page.locator(".sidebar-tree .tree-note")).toHaveCount(1, { timeout: 8_000 });
    await page.keyboard.press("Control+n");
    await expect(page.locator(".sidebar-tree .tree-note")).toHaveCount(2, { timeout: 8_000 });
  });
});
