import { test, expect } from "@playwright/test";
import { register, createVault, createNote, typeInEditor, waitForAutosave, clearAuth } from "./helpers";

// Find and replace in the open note (#547).
test.describe("Find and replace", () => {
  const TEXT = "The cat sat.\nA cat ran.\nNo dog, one cat.";

  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
    await createNote(page, "Find me");
    await typeInEditor(page, TEXT);
    await waitForAutosave(page);
  });

  test("Ctrl+F finds, counts and steps through matches", async ({ page }) => {
    await page.keyboard.press("Control+f");
    const find = page.getByRole("textbox", { name: "Find" });
    await expect(find).toBeFocused();
    await find.fill("cat");
    const count = page.locator(".find-bar-count");
    await expect(count).toHaveText("1 of 3");
    await expect(page.locator(".editor-highlight .find-match")).toHaveCount(3);
    await find.press("Enter");
    await expect(count).toHaveText("2 of 3");
    await find.press("Shift+Enter");
    await expect(count).toHaveText("1 of 3");
    await find.press("Escape");
    await expect(page.locator(".find-bar")).toHaveCount(0);
    await expect(page.locator(".editor-textarea").first()).toBeFocused();
  });

  test("Replace all saves, and Ctrl+Z undoes it", async ({ page }) => {
    const editor = page.locator(".editor-textarea").first();
    await page.keyboard.press("Control+f");
    await page.getByRole("textbox", { name: "Find" }).fill("cat");
    await page.getByRole("textbox", { name: "Replace with" }).fill("dog");
    const saved = waitForAutosave(page);
    await page.getByRole("button", { name: "Replace all" }).click();
    await expect(editor).toHaveValue("The dog sat.\nA dog ran.\nNo dog, one dog.");
    await expect(page.locator(".find-bar-count")).toHaveText("Replaced 3");
    await saved;
    await page.getByRole("textbox", { name: "Find" }).press("Escape");
    await page.keyboard.press("Control+z");
    await expect(editor).toHaveValue(TEXT);
  });
});
