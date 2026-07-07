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
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("---\ntitle: Front Matter Title\n---\n\nNote body here");
    await waitForAutosave(page);

    // After save the note title in sidebar/toolbar should reflect front-matter title
    // (the server sets the title from front-matter on save)
    await page.reload();
    await page.locator(".sidebar-files .tree-note").first().click();
    await expect(
      page.locator(".sidebar-files .tree-note").first()
    ).toContainText("Front Matter Title");
  });

  test("front-matter tags appear as tag pills", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("---\ntags: [backend, api]\n---\n\nNote content");
    await waitForAutosave(page);

    await expect(page.locator(".status-bar .status-tag").filter({ hasText: "backend" })).toBeVisible();
    await expect(page.locator(".status-bar .status-tag").filter({ hasText: "api" })).toBeVisible();
  });

  test("front-matter tags and inline tags are both shown", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("---\ntags: [fromfm]\n---\n\nThis also has #inlinetag");
    await waitForAutosave(page);

    await expect(page.locator(".status-bar .status-tag").filter({ hasText: "fromfm" })).toBeVisible();
    await expect(page.locator(".status-bar .status-tag").filter({ hasText: "inlinetag" })).toBeVisible();
  });

  test("note without front-matter shows no front-matter tags", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("Just a plain note with no front-matter");
    await waitForAutosave(page);

    await expect(page.locator(".status-bar .status-tag")).toHaveCount(0);
  });
});
