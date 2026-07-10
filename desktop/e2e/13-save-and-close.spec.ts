import { test, expect, type Page } from "@playwright/test";
import { register, createVault, waitForAutosave } from "./helpers";

/**
 * Covers the unsaved-changes / close behaviour that regressed repeatedly.
 *
 * NOTE: these run in a browser, where the custom title-bar close button and the
 * Tauri onCloseRequested/destroy path do not exist. They therefore exercise the
 * *tab* close, which shares the exact same confirmation dialog and Save / Discard
 * / Cancel handlers as the window close (only the final step differs: closeTab
 * vs window.destroy()). The native window destroy itself must be checked in the
 * native app.
 */
test.describe("Save and close confirmation", () => {
  test.beforeEach(async ({ page }) => {
    await register(page);
    await createVault(page); // empty vault (welcome notes cleared by the helper)
  });

  /** Ctrl+N, name it, and type body; returns after the note is dirty. */
  async function newDirtyNote(page: Page, title: string, body: string) {
    await page.keyboard.press("Control+n");
    const titleInput = page.locator(".editor-title-input").first();
    await expect(titleInput).toBeVisible();
    await titleInput.fill(title);
    await titleInput.press("Enter");
    await page.locator(".editor-textarea").click();
    await page.locator(".editor-textarea").fill(body);
  }

  async function closeActiveTab(page: Page) {
    await page.locator(".tab--active").hover();
    await page.locator(".tab--active .tab-close").click();
  }

  test("closing a clean note tab does not prompt", async ({ page }) => {
    await newDirtyNote(page, "Clean", "already saved");
    await waitForAutosave(page); // now clean
    await closeActiveTab(page);
    await expect(page.locator(".confirm-dialog")).toHaveCount(0);
  });

  test("closing a dirty note tab shows the confirmation dialog", async ({ page }) => {
    await newDirtyNote(page, "Dirty", "unsaved edits");
    await closeActiveTab(page);
    await expect(page.locator(".confirm-dialog")).toBeVisible();
    await expect(page.locator(".confirm-actions .confirm-btn")).toHaveText([
      "Cancel",
      "Close without saving",
      "Save & close",
    ]);
  });

  test("Save & close saves the note and closes the tab", async ({ page }) => {
    await newDirtyNote(page, "SaveMe", "important content");
    const tabsBefore = await page.locator(".tab").count();

    const putPromise = page.waitForResponse(
      (r) => r.url().includes("/api/notes/") && r.request().method() === "PUT" && r.ok(),
    );
    await closeActiveTab(page);
    await page.locator(".confirm-btn--primary").click(); // Save & close
    await putPromise; // the note was actually saved

    await expect(page.locator(".confirm-dialog")).toHaveCount(0);
    await expect(page.locator(".tab")).toHaveCount(tabsBefore - 1);
  });

  test("Close without saving discards the unsaved changes", async ({ page }) => {
    await newDirtyNote(page, "Discard", "saved base");
    await waitForAutosave(page); // server now has "saved base"
    await page.locator(".editor-textarea").press("End");
    await page.locator(".editor-textarea").pressSequentially(" TAIL");

    await closeActiveTab(page);
    await page.locator(".confirm-btn--danger").click(); // Close without saving

    await page.locator('.tree-note:has-text("Discard")').click(); // reopen
    await expect(page.locator(".editor-textarea")).toHaveValue("saved base");
  });

  test("Cancel keeps the tab open and the changes intact", async ({ page }) => {
    await newDirtyNote(page, "Keep", "work in progress");
    await closeActiveTab(page);
    await page.locator(".confirm-btn", { hasText: "Cancel" }).click();

    await expect(page.locator(".confirm-dialog")).toHaveCount(0);
    await expect(page.locator(".editor-title-input")).toHaveValue("Keep");
    await expect(page.locator(".editor-textarea")).toHaveValue("work in progress");
  });

  test("autosave is paused while the confirmation dialog is open", async ({ page }) => {
    await newDirtyNote(page, "Pause", "saved base");
    await waitForAutosave(page);
    await page.locator(".editor-textarea").press("End");
    await page.locator(".editor-textarea").pressSequentially(" UNSAVED");

    let putsWhileOpen = 0;
    const onReq = (r: import("@playwright/test").Request) => {
      if (r.method() === "PUT" && r.url().includes("/api/notes/")) putsWhileOpen++;
    };

    await closeActiveTab(page);
    await expect(page.locator(".confirm-dialog")).toBeVisible();
    page.on("request", onReq);
    // Wait well past the 1s autosave debounce — no save may fire while paused.
    await page.waitForTimeout(1600);
    page.off("request", onReq);
    expect(putsWhileOpen).toBe(0);

    // And discarding then reopening confirms nothing was persisted.
    await page.locator(".confirm-btn--danger").click();
    await page.locator('.tree-note:has-text("Pause")').click();
    await expect(page.locator(".editor-textarea")).toHaveValue("saved base");
  });
});
