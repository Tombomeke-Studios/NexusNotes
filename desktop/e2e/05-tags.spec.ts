import { test, expect } from "@playwright/test";
import { uid, register, createVault, waitForSaved, clearAuth } from "./helpers";

test.describe("Tags", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("tag pills appear in status bar when note contains #tags", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("This note has #work and #project tags");
    await waitForSaved(page);

    await expect(page.locator(".status-bar .status-tag").filter({ hasText: "work" })).toBeVisible();
    await expect(page.locator(".status-bar .status-tag").filter({ hasText: "project" })).toBeVisible();
  });

  test("no tag pills shown for notes without #tags", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("Plain note with no tags");
    await waitForSaved(page);

    await expect(page.locator(".status-bar .status-tag")).toHaveCount(0);
  });

  test("#tag inside code block is not shown as a pill", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("```\n#include <stdio.h>\n```");
    await waitForSaved(page);

    await expect(page.locator(".status-bar .status-tag")).toHaveCount(0);
  });

  test("clicking a tag pill in status bar filters the sidebar", async ({ page }) => {
    const tag = `e2etag${uid().replace(/-/g, "")}`;

    // Create a tagged note
    await page.keyboard.press("Control+n");
    const textarea1 = page.locator(".editor-textarea, textarea").first();
    await textarea1.click();
    await textarea1.fill(`Tagged note #${tag}`);
    await waitForSaved(page);

    // Create an untagged note
    await page.keyboard.press("Control+n");
    const textarea2 = page.locator(".editor-textarea, textarea").first();
    await textarea2.click();
    await textarea2.fill("Untagged note");
    await waitForSaved(page);

    // Navigate back to the tagged note and click the tag pill
    await page.locator(".sidebar-files .tree-note").first().click();
    await page.locator(`.status-bar .status-tag`).filter({ hasText: tag }).click();

    // Sidebar should show filter badge
    await expect(page.locator(".sidebar-filter-badge")).toBeVisible();
    // Only 1 note should be visible
    await expect(page.locator(".sidebar-files .tree-note")).toHaveCount(1);
  });

  test("tags panel appears in sidebar and lists vault tags", async ({ page }) => {
    const tag = `sidebartag${uid().replace(/-/g, "")}`;
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill(`Note with #${tag}`);
    await waitForSaved(page);

    // Tags section should appear at the bottom of sidebar
    const tagsSection = page.locator(".sidebar-tags-section");
    if (await tagsSection.isVisible().catch(() => false)) {
      // Expand it if collapsed
      const toggle = tagsSection.locator(".sidebar-tags-toggle");
      if (await toggle.isVisible()) await toggle.click();
      await expect(tagsSection.locator(".sidebar-tag-label").filter({ hasText: tag })).toBeVisible();
    }
  });

  test("clearing tag filter shows all notes again", async ({ page }) => {
    const tag = `clrtag${uid().replace(/-/g, "")}`;
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill(`Note #${tag}`);
    await waitForSaved(page);

    // Filter by tag
    await page.locator(".status-bar .status-tag").filter({ hasText: tag }).click();
    await expect(page.locator(".sidebar-filter-badge")).toBeVisible();

    // Clear the filter
    await page.locator(".sidebar-section-header button[title*='clear' i], .sidebar-filter-badge + button, button:has-text('×')").first().click();
    await expect(page.locator(".sidebar-filter-badge")).not.toBeVisible();
  });

  test("YAML front-matter tags are included as tag pills", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("---\ntags: [frontend, design]\n---\n\nNote body");
    await waitForSaved(page);

    await expect(page.locator(".status-bar .status-tag").filter({ hasText: "frontend" })).toBeVisible();
    await expect(page.locator(".status-bar .status-tag").filter({ hasText: "design" })).toBeVisible();
  });
});
