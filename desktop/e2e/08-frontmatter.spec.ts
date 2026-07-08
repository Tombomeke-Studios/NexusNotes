import { test, expect } from "@playwright/test";
import { register, createVault, waitForAutosave, clearAuth } from "./helpers";

test.describe("YAML front-matter", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("front-matter title overrides the note title", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("---\ntitle: Front Matter Title\n---\n\nNote body here");
    await waitForAutosave(page);

    await page.reload();
    await page.locator(".sidebar-tree .tree-note").first().click();
    await expect(
      page.locator(".sidebar-tree .tree-note").first(),
    ).toContainText("Front Matter Title");
  });

  test("front-matter tags appear as sidebar chips", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("---\ntags: [backend, api]\n---\n\nNote content");
    await waitForAutosave(page);

    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: "backend" })).toBeVisible();
    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: "api" })).toBeVisible();
  });

  test("front-matter tags and inline tags are both shown", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("---\ntags: [fromfm]\n---\n\nThis also has #inlinetag");
    await waitForAutosave(page);

    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: "fromfm" })).toBeVisible();
    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: "inlinetag" })).toBeVisible();
  });

  test("note without front-matter shows no tag chips", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("Just a plain note with no front-matter");
    await waitForAutosave(page);

    await expect(page.locator(".sidebar-tags")).toHaveCount(0);
  });
});
