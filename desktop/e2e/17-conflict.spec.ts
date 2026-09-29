import { test, expect, type Page } from "@playwright/test";
import { register, createVault, createNote, typeInEditor, waitForSaved } from "./helpers";

interface ServerNote {
  id: string;
  title: string;
  path: string;
  content: string;
  checksum: string;
}

/** The note as the server has it, read with this page's session. */
function fetchNote(page: Page, apiBase: string, noteId: string): Promise<ServerNote> {
  return page.evaluate(
    async ({ apiBase, noteId }) => {
      const res = await fetch(`${apiBase}/api/notes/${noteId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("nexus_token")}` },
      });
      return res.json();
    },
    { apiBase, noteId },
  );
}

/**
 * Conflict resolution (#225) and another device's edits (#324). "Another
 * device" is a PUT straight to the API with this account's token.
 */
test.describe("Conflict resolution", () => {
  const BASE_TEXT = "line one\nshared\nline three";
  const MINE = "line one\nmine\nline three";
  const THEIRS = "line one\nfrom the other device\nline three";

  /** A new note holding BASE_TEXT, saved; returns the server's copy of it. */
  async function savedNote(page: Page) {
    await register(page);
    await createVault(page);
    await createNote(page, "Shared");
    const put = page.waitForResponse(
      (r) => r.url().includes("/api/notes/") && r.request().method() === "PUT" && r.ok(),
    );
    await typeInEditor(page, BASE_TEXT);
    const url = new URL((await put).url());
    await waitForSaved(page);
    const apiBase = url.origin;
    // The server's current copy: its checksum is what the other device builds on.
    const note = await fetchNote(page, apiBase, url.pathname.split("/").pop()!);
    expect(note.content).toBe(BASE_TEXT);
    return { note, apiBase };
  }

  /** Another device saves `content` on top of `note`. */
  async function otherDeviceSaves(page: Page, apiBase: string, note: ServerNote, content: string) {
    const status = await page.evaluate(
      async ({ apiBase, note, content }) => {
        const res = await fetch(`${apiBase}/api/notes/${note.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("nexus_token")}`,
          },
          body: JSON.stringify({
            title: note.title,
            path: note.path,
            content,
            prev_checksum: note.checksum,
            device_id: "e2e-other-device",
          }),
        });
        return res.status;
      },
      { apiBase, note, content },
    );
    expect(status).toBe(200);
  }

  /** A local edit and another device's edit at the same time; opens the conflict dialog. */
  async function makeConflict(page: Page) {
    const { note, apiBase } = await savedNote(page);
    await typeInEditor(page, MINE);
    await otherDeviceSaves(page, apiBase, note, THEIRS);

    const notice = page.locator(".conflict-notice");
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await notice.getByRole("button", { name: "Compare and resolve" }).click();
    await expect(page.getByRole("dialog", { name: "Resolve conflict" })).toBeVisible();
    // Located by class: its accessible name changes to "Merge by hand" when merging.
    return { dialog: page.locator(".conflict-dialog"), note, apiBase };
  }

  async function serverContent(page: Page, apiBase: string, noteId: string) {
    return (await fetchNote(page, apiBase, noteId)).content;
  }

  test("shows another device's change in the open, saved note (#324)", async ({ page }) => {
    const { note, apiBase } = await savedNote(page);
    await otherDeviceSaves(page, apiBase, note, THEIRS);
    await expect(page.locator(".editor-textarea").first()).toHaveValue(THEIRS, { timeout: 10_000 });
    await expect(page.locator(".conflict-notice")).toHaveCount(0);

    // The next edit builds on their text instead of saving over it.
    const edited = `${THEIRS}\nand one more line`;
    await typeInEditor(page, edited);
    await waitForSaved(page);
    await expect.poll(() => serverContent(page, apiBase, note.id)).toBe(edited);
  });

  test("shows both versions and keeps mine", async ({ page }) => {
    const { dialog, note, apiBase } = await makeConflict(page);
    await expect(dialog.locator('[data-changed="mine"]')).toHaveText("mine");
    await expect(dialog.locator('[data-changed="theirs"]')).toHaveText("from the other device");

    await dialog.getByRole("button", { name: "Keep mine" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".status-indicator--saved")).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(".conflict-notice")).toHaveCount(0);
    expect(await serverContent(page, apiBase, note.id)).toBe(MINE);
  });

  test("uses the other device's version", async ({ page }) => {
    const { dialog, note, apiBase } = await makeConflict(page);
    await dialog.getByRole("button", { name: "Use theirs" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".editor-textarea").first()).toHaveValue(THEIRS);
    await expect(page.locator(".status-indicator--saved")).toBeVisible();
    expect(await serverContent(page, apiBase, note.id)).toBe(THEIRS);
  });

  test("merges by hand", async ({ page }) => {
    const { dialog, note, apiBase } = await makeConflict(page);
    await dialog.getByRole("button", { name: /Merge by hand/ }).click();
    const merged = "line one\nmine, and from the other device\nline three";
    await dialog.getByRole("textbox", { name: "Merged text" }).fill(merged);
    await dialog.getByRole("button", { name: "Save merged" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".status-indicator--saved")).toBeVisible({ timeout: 8_000 });
    expect(await serverContent(page, apiBase, note.id)).toBe(merged);
  });
});
