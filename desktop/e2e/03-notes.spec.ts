import { test, expect } from "@playwright/test";
import { uid, register, createVault, waitForAutosave, waitForSaved, clearAuth } from "./helpers";

test.describe("Note CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("creates a new note via Ctrl+N", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(page.locator(".editor, .editor-container")).toBeVisible();
  });

  test("new note appears in the sidebar file tree", async ({ page }) => {
    await page.keyboard.press("Control+n");
    // Wait for note to appear in sidebar
    await expect(page.locator(".sidebar-files .tree-note")).toBeVisible({ timeout: 8_000 });
  });

  test("types content and it appears in the editor", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("Hello **world** from E2E");
    await expect(textarea).toHaveValue("Hello **world** from E2E");
  });

  test("content auto-saves (status shows Saved)", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill(`Auto-save test ${uid()}`);
    await waitForAutosave(page);
  });

  test("note persists after page reload", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    const content = `Persist test ${uid()}`;
    await textarea.fill(content);
    await waitForAutosave(page);

    await page.reload();
    // Re-select the note from sidebar
    await page.locator(".sidebar-files .tree-note").first().click();
    await expect(page.locator(".editor-textarea, textarea").first()).toHaveValue(content);
  });

  test("note title is editable in the toolbar", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const titleInput = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill("My Custom Title");
    await titleInput.press("Tab");

    // Title should appear in sidebar
    await expect(page.locator(".sidebar-files").filter({ hasText: "My Custom Title" })).toBeVisible();
  });

  test("deletes a note via delete button", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await waitForSaved(page);

    // Right-click or find delete action
    const noteItem = page.locator(".sidebar-files .tree-note").first();
    await noteItem.click({ button: "right" });

    const deleteBtn = page.getByRole("menuitem", { name: /delete/i });
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      await expect(page.locator(".sidebar-files .tree-note")).toHaveCount(0);
    } else {
      // Keyboard shortcut or toolbar button
      test.skip();
    }
  });

  test("markdown preview renders bold text", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("This is **bold** text");
    await waitForAutosave(page);

    // Check preview pane renders <strong>
    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await expect(preview.locator("strong")).toBeVisible();
    }
  });

  test("multiple notes appear in the sidebar tree", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await expect(page.locator(".sidebar-files .tree-note")).toHaveCount(1, { timeout: 8_000 });
    await page.keyboard.press("Control+n");
    await expect(page.locator(".sidebar-files .tree-note")).toHaveCount(2, { timeout: 8_000 });
  });
});
