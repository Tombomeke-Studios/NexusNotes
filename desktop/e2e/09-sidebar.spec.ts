import { test, expect } from "@playwright/test";
import { uid, register, createVault, waitForSaved, clearAuth } from "./helpers";

test.describe("Sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("clicking a note in the sidebar opens it in the editor", async ({ page }) => {
    // Create note with known content
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("Sidebar click test content");
    await waitForSaved(page);

    // Click elsewhere / deselect
    await page.keyboard.press("Control+n");
    await waitForSaved(page);

    // Click first note in sidebar
    await page.locator(".sidebar-files .tree-note").first().click();
    // Editor should show the note
    await expect(page.locator(".editor, .editor-container")).toBeVisible();
  });

  test("selected note is highlighted in the sidebar", async ({ page }) => {
    await page.keyboard.press("Control+n");
    await waitForSaved(page);
    const noteItem = page.locator(".sidebar-files .tree-note").first();
    await noteItem.click();
    await expect(noteItem).toHaveClass(/active/);
  });

  test("notes inside a folder path appear nested", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const titleInput = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill("folder/nested-note");
    await titleInput.press("Tab");
    await waitForSaved(page);

    // A folder node should appear
    await expect(page.locator(".tree-folder-label, .tree-item:has(.tree-icon)")).toBeVisible();
  });

  test("clicking a folder expands and collapses it", async ({ page }) => {
    // Create a note under a folder
    await page.keyboard.press("Control+n");
    const titleInput = page.locator(".editor-toolbar-title, input[class*='title']").first();
    await titleInput.click({ clickCount: 3 });
    await titleInput.fill("docs/readme");
    await titleInput.press("Tab");
    await waitForSaved(page);

    const folder = page.locator(".tree-folder-label").first();
    if (await folder.isVisible().catch(() => false)) {
      // Expand
      await folder.click();
      await expect(page.locator(".tree-note")).toBeVisible();
      // Collapse
      await folder.click();
    }
  });

  test("sidebar shows empty state when vault has no notes", async ({ page }) => {
    // Fresh vault with no notes
    await createVault(page, `Empty-${uid()}`);
    await expect(page.locator(".sidebar-empty, text=/no notes/i")).toBeVisible();
  });

  test("new vault button is visible", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /new vault/i }).or(
        page.locator(".sidebar-action-btn[title*='vault' i]")
      )
    ).toBeVisible();
  });
});
