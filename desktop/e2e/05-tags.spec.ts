import { test, expect } from "@playwright/test";
import { uid, register, createVault, createNote, waitForAutosave, clearAuth } from "./helpers";

// In the redesign, tag pills live in the sidebar Tags section and the preview
// (as clickable #tag chips) — not in the status bar.
test.describe("Tags", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("tag chips appear in the sidebar when a note contains #tags", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("This note has #work and #project tags");
    await waitForAutosave(page);

    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: "work" })).toBeVisible();
    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: "project" })).toBeVisible();
  });

  test("no tag chips shown for notes without #tags", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("Plain note with no tags");
    await waitForAutosave(page);

    await expect(page.locator(".sidebar-tags")).toHaveCount(0);
  });

  test("#tag inside a code block is not shown as a chip", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("```\n#include <stdio.h>\n```");
    await waitForAutosave(page);

    await expect(page.locator(".sidebar-tags")).toHaveCount(0);
  });

  test("clicking a tag pill in the preview filters the sidebar", async ({ page }) => {
    const tag = `e2etag${uid().replace(/-/g, "")}`;

    await createNote(page, "Tagged Note");
    const textarea1 = page.locator(".editor-textarea").first();
    await textarea1.click();
    await textarea1.fill(`Tagged note #${tag}`);
    await waitForAutosave(page);

    await page.keyboard.press("Control+n");
    const textarea2 = page.locator(".editor-textarea").first();
    await textarea2.click();
    await textarea2.fill("Untagged note");
    await waitForAutosave(page);

    // Reopen the tagged note and click its preview tag pill
    await page.locator(".sidebar-tree .tree-note").filter({ hasText: "Tagged Note" }).click();
    await page.locator(".editor-preview .preview-tag").filter({ hasText: tag }).click();

    await expect(page.locator(".sidebar-filter-banner")).toBeVisible();
    await expect(page.locator(".sidebar-tree .tree-note")).toHaveCount(1);
  });

  test("sidebar Tags section lists vault tags", async ({ page }) => {
    const tag = `sidebartag${uid().replace(/-/g, "")}`;
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill(`Note with #${tag}`);
    await waitForAutosave(page);

    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: tag })).toBeVisible();
  });

  test("clearing the tag filter shows all notes again", async ({ page }) => {
    const tag = `clrtag${uid().replace(/-/g, "")}`;
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill(`Note #${tag}`);
    await waitForAutosave(page);

    await page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: tag }).click();
    await expect(page.locator(".sidebar-filter-banner")).toBeVisible();

    await page.locator(".sidebar-filter-banner button").click();
    await expect(page.locator(".sidebar-filter-banner")).not.toBeVisible();
  });

  test("YAML front-matter tags appear as sidebar chips", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("---\ntags: [frontend, design]\n---\n\nNote body");
    await waitForAutosave(page);

    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: "frontend" })).toBeVisible();
    await expect(page.locator(".sidebar-tags .sidebar-chip").filter({ hasText: "design" })).toBeVisible();
  });
});
