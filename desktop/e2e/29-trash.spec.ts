import { test, expect, type Page } from "@playwright/test";
import { register, createVault, createNote, typeInEditor, waitForSaved, clearAuth } from "./helpers";

/** Deletes a note from its context menu and confirms the move to the Trash. */
async function moveToTrash(page: Page, title: string) {
  await page.locator(".sidebar-tree [data-note-id]").filter({ hasText: title }).first().click({ button: "right" });
  await page.getByRole("button", { name: "Delete note" }).click();
  const dialog = page.getByRole("alertdialog", { name: `Move "${title}" to the Trash?` });
  await expect(dialog).toContainText("You can restore it for 30 days");
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".sidebar-tree [data-note-id]").filter({ hasText: title })).toHaveCount(0);
}

// Deleting moves notes to the vault's Trash, where they can be restored (#569).
test.describe("Trash", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("a deleted note waits in the Trash and comes back on restore", async ({ page }) => {
    const title = await createNote(page);
    await typeInEditor(page, "Do not lose this");
    await waitForSaved(page);

    await moveToTrash(page, title);

    await page.getByRole("button", { name: "Trash, 1 note" }).click();
    const trash = page.getByRole("dialog", { name: "Trash" });
    const row = trash.getByRole("listitem", { name: title });
    await expect(row).toContainText("removed in 30 days");
    await row.getByRole("button", { name: "Restore" }).click();

    await expect(page.getByRole("status").filter({ hasText: `Restored "${title}"` })).toBeVisible();
    await expect(trash.getByText("The Trash is empty")).toBeVisible();
    await page.getByRole("button", { name: "Close Trash" }).click();

    const restored = page.locator(".sidebar-tree [data-note-id]").filter({ hasText: title });
    await expect(restored).toHaveCount(1);
    await restored.first().click();
    await expect(page.locator(".editor-textarea").first()).toHaveValue("Do not lose this");
  });

  test("the owner empties the Trash after confirming", async ({ page }) => {
    const first = await createNote(page);
    await waitForSaved(page);
    const second = await createNote(page);
    await waitForSaved(page);
    await moveToTrash(page, first);
    await moveToTrash(page, second);

    await page.getByRole("button", { name: "Trash, 2 notes" }).click();
    const trash = page.getByRole("dialog", { name: "Trash" });
    await expect(trash.getByRole("listitem")).toHaveCount(2);
    await trash.getByRole("button", { name: "Empty Trash" }).click();
    const confirm = trash.getByRole("alertdialog", { name: "Empty the Trash?" });
    await expect(confirm).toContainText("All 2 notes");
    await confirm.getByRole("button", { name: "Empty Trash" }).click();

    await expect(trash.getByText("The Trash is empty")).toBeVisible();
    await page.getByRole("button", { name: "Close Trash" }).click();
    await expect(page.getByRole("button", { name: "Trash", exact: true })).toBeVisible();
  });
});
