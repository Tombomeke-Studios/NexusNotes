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
    const textarea = page.locator(".editor-textarea").first();
    await expect(textarea).toBeVisible();
    await textarea.click();
    await expect(textarea).toBeFocused();
  });

  test("split view shows both editor and preview", async ({ page }) => {
    await expect(page.locator(".editor-textarea")).toBeVisible();
    await expect(page.locator(".editor-preview")).toBeVisible();
  });

  test("bold markdown renders as <strong>", async ({ page }) => {
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("**bold text**");
    await waitForAutosave(page);
    await expect(page.locator(".editor-preview strong")).toContainText("bold text");
  });

  test("heading markdown renders as a heading element", async ({ page }) => {
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("# My Heading");
    await waitForAutosave(page);
    await expect(page.locator(".editor-preview h1")).toContainText("My Heading");
  });

  test("code block renders with a language badge", async ({ page }) => {
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("```js\nconst x = 1;\n```");
    await waitForAutosave(page);
    await expect(page.locator(".editor-preview pre code")).toBeVisible();
    await expect(page.locator(".editor-preview .code-lang")).toContainText("js");
  });

  test("ordered list renders as <ol>", async ({ page }) => {
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("1. First\n2. Second\n3. Third");
    await waitForAutosave(page);
    await expect(page.locator(".editor-preview ol li")).toHaveCount(3);
  });

  test("inline code renders as <code>", async ({ page }) => {
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("Use `console.log()` for debugging");
    await waitForAutosave(page);
    await expect(page.locator(".editor-preview code")).toContainText("console.log()");
  });

  test("mode toggle switches to reading view", async ({ page }) => {
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("# Reading mode");
    await waitForAutosave(page);
    await page.getByRole("button", { name: "Read", exact: true }).click();
    await expect(page.locator(".editor-textarea")).not.toBeVisible();
    await expect(page.locator(".editor-preview h1")).toContainText("Reading mode");
  });
});
