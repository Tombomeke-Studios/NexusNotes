import { test, expect } from "@playwright/test";
import { uid, register, createVault, waitForAutosave, clearAuth } from "./helpers";

test.describe("Sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("clicking a note in the sidebar opens it in the editor", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("Sidebar click test content");
    await waitForAutosave(page);

    await page.keyboard.press("Control+n");
    await waitForAutosave(page).catch(() => {});

    await page.locator(".sidebar-tree .tree-note").first().click();
    await expect(page.locator(".editor")).toBeVisible();
  });

  test("selected note is highlighted in the sidebar", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const noteItem = page.locator(".sidebar-tree .tree-note").first();
    await noteItem.click();
    await expect(noteItem).toHaveClass(/active/);
  });

  test("sidebar shows empty state when vault has no notes", async ({ page }) => {
    await createVault(page, `Empty-${uid()}`);
    await expect(page.locator(".sidebar-empty").first()).toBeVisible();
  });

  test("vault switcher button is visible in the sidebar head", async ({ page }) => {
    await expect(page.locator(".sidebar-vault-btn")).toBeVisible();
  });

  test("new note button in the sidebar head creates a note", async ({ page }) => {
    await page.getByRole("button", { name: /new note/i }).first().click();
    await expect(page.locator(".sidebar-tree .tree-note")).toHaveCount(1, { timeout: 8_000 });
  });
});
