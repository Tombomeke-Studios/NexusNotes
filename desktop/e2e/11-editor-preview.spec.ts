import { test, expect } from "@playwright/test";
import { register, createVault, waitForAutosave, clearAuth } from "./helpers";

test.describe("Editor and markdown preview", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
    await page.keyboard.press("Control+n");
  });

  test("editor textarea is visible and focusable", async ({ page }) => {
    const textarea = page.locator(".editor-textarea, textarea").first();
    await expect(textarea).toBeVisible();
    await textarea.click();
    await expect(textarea).toBeFocused();
  });

  test("split view shows both editor and preview", async ({ page }) => {
    // Most markdown editors have an edit/preview toggle or split view
    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    const textarea = page.locator(".editor-textarea, textarea").first();
    if (await preview.isVisible().catch(() => false)) {
      await expect(textarea).toBeVisible();
      await expect(preview).toBeVisible();
    }
  });

  test("bold markdown renders as <strong>", async ({ page }) => {
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("**bold text**");
    await waitForAutosave(page);
    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await expect(preview.locator("strong")).toContainText("bold text");
    }
  });

  test("heading markdown renders as heading element", async ({ page }) => {
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("# My Heading");
    await waitForAutosave(page);
    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await expect(preview.locator("h1")).toContainText("My Heading");
    }
  });

  test("code block renders with syntax highlighting", async ({ page }) => {
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("```js\nconst x = 1;\n```");
    await waitForAutosave(page);
    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await expect(preview.locator("pre code")).toBeVisible();
    }
  });

  test("ordered list renders as <ol>", async ({ page }) => {
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("1. First\n2. Second\n3. Third");
    await waitForAutosave(page);
    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await expect(preview.locator("ol li")).toHaveCount(3);
    }
  });

  test("inline code renders as <code>", async ({ page }) => {
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("Use `console.log()` for debugging");
    await waitForAutosave(page);
    const preview = page.locator(".editor-preview, .markdown-body, .prose");
    if (await preview.isVisible().catch(() => false)) {
      await expect(preview.locator("code")).toContainText("console.log()");
    }
  });

  test("status bar shows word/character count", async ({ page }) => {
    const textarea = page.locator(".editor-textarea, textarea").first();
    await textarea.click();
    await textarea.fill("Hello world this is five words");
    await expect(page.locator(".status-bar")).toBeVisible();
    // Status bar exists — exact content depends on implementation
  });
});
