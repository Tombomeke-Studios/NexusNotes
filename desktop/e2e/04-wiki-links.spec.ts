import { test, expect } from "@playwright/test";
import { register, createVault, createNote, waitForAutosave, clearAuth } from "./helpers";

test.describe("Wiki-links and backlinks", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("renders unresolved [[link]] with warning style", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("See also [[Nonexistent Note]]");
    await waitForAutosave(page);
    await expect(page.locator(".editor-preview .wikilink--unresolved")).toBeVisible();
  });

  test("renders resolved [[link]] when target note exists", async ({ page }) => {
    // Create the target note (title persists with a content autosave)
    await createNote(page, "Target Note");
    const targetBody = page.locator(".editor-textarea").first();
    await targetBody.click();
    await targetBody.fill("Target body");
    await waitForAutosave(page);

    // Create the source note linking to it
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("See also [[Target Note]]");
    await waitForAutosave(page);

    await expect(page.locator(".editor-preview .wikilink--resolved")).toBeVisible();
  });

  test("clicking a resolved [[link]] navigates to target note", async ({ page }) => {
    await createNote(page, "Jump Target");
    const targetBody = page.locator(".editor-textarea").first();
    await targetBody.click();
    await targetBody.fill("Jump target body");
    await waitForAutosave(page);

    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("Go to [[Jump Target]]");
    await waitForAutosave(page);

    await page.locator(".editor-preview .wikilink--resolved").click();
    await expect(page.locator(".editor-title-input").first()).toHaveValue(/Jump Target/i, {
      timeout: 5_000,
    });
  });

  test("clicking an unresolved [[link]] creates and opens the note", async ({ page }) => {
    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("See [[Brand New Note]]");
    await waitForAutosave(page);

    await page.locator(".editor-preview .wikilink--unresolved").click();
    await expect(page.locator(".editor-title-input").first()).toHaveValue(/Brand New Note/i, {
      timeout: 5_000,
    });
  });

  test("backlinks appear in the right panel Links tab", async ({ page }) => {
    await createNote(page, "Note B");
    const bodyB = page.locator(".editor-textarea").first();
    await bodyB.click();
    await bodyB.fill("Note B body");
    await waitForAutosave(page);

    await page.keyboard.press("Control+n");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("This links to [[Note B]]");
    await waitForAutosave(page);

    await page.locator(".sidebar-tree .tree-note").filter({ hasText: "Note B" }).click();
    await page.getByRole("button", { name: "Links" }).click();
    await expect(page.locator(".backlink-card").filter({ hasText: /link/i })).toBeVisible({
      timeout: 5_000,
    });
  });
});
