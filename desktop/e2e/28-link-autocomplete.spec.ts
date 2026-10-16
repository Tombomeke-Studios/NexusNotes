import { test, expect } from "@playwright/test";
import { register, createVault, createNote, typeInEditor, waitForAutosave, clearAuth } from "./helpers";

// [[link]] autocomplete (#548).
test.describe("Link autocomplete", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
    for (const title of ["Project plan", "Groceries"]) {
      await createNote(page, title);
      await typeInEditor(page, `Body of ${title}.`);
      await waitForAutosave(page);
    }
    await createNote(page, "Journal");
  });

  test("typing [[ suggests notes and Enter inserts the link, undoable with Ctrl+Z", async ({ page }) => {
    const editor = page.locator(".editor-textarea").first();
    await editor.click();
    await page.keyboard.type("See [[");
    const list = page.getByRole("listbox", { name: "Link suggestions" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option", { name: "Groceries" })).toBeVisible();

    await page.keyboard.type("proj");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option", { name: "Project plan" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(editor).toHaveValue("See [[Project plan]]");

    // The caret sits after the closing brackets.
    expect(await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe("See [[Project plan]]".length);

    await page.keyboard.press("Control+z");
    await expect(editor).toHaveValue("See [[proj");
    await expect(list).toHaveCount(0);
  });

  test("Esc closes the list, and an unknown name offers a new link", async ({ page }) => {
    const editor = page.locator(".editor-textarea").first();
    await editor.click();
    await page.keyboard.type("[[gro");
    const list = page.getByRole("listbox", { name: "Link suggestions" });
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    await page.keyboard.type("\n[[Brand new idea");
    await expect(list.getByRole("option", { name: "Create link to 'Brand new idea'" })).toBeVisible();
    await list.getByRole("option").click();
    await expect(editor).toHaveValue("[[gro\n[[Brand new idea]]");
    await expect(editor).toBeFocused();
  });
});
