import { test, expect, type Page } from "@playwright/test";
import { register, clearAuth, createVault, createNote, typeInEditor, waitForSaved } from "./helpers";

const API = "http://localhost:8080";

async function headers(page: Page) {
  return { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("nexus_token"))}` };
}

// Version history (#413-#417): snapshots, diff and restore.
test.describe("Version history", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
  });

  test("compares a version with the current text and restores it", async ({ page }) => {
    await createVault(page);
    await createNote(page, "Plan");
    const put = page.waitForResponse((r) => r.url().includes("/api/notes/") && r.request().method() === "PUT" && r.ok());
    await typeInEditor(page, "line one\nmy first draft\nline three");
    const noteId = new URL((await put).url()).pathname.split("/").pop()!;
    await waitForSaved(page);

    // Another device saves on top: a new snapshot.
    const h = await headers(page);
    const note = await (await page.request.get(`${API}/api/notes/${noteId}`, { headers: h })).json();
    const other = await page.request.put(`${API}/api/notes/${noteId}`, {
      headers: h,
      data: { title: note.title, path: note.path, content: "line one\nfrom the other device\nline three", prev_checksum: note.checksum, device_id: "e2e-other-device" },
    });
    expect(other.ok()).toBe(true);
    const editor = page.locator(".editor-textarea").first();
    await expect(editor).toHaveValue(/from the other device/, { timeout: 10_000 });

    await page.keyboard.press("Control+Shift+H");
    const list = page.getByRole("listbox", { name: "Versions" });
    await expect(list.getByRole("option")).toHaveCount(2);
    await expect(list.getByRole("option").first()).toContainText("Current");
    // Opens on the newest version that differs: this device's draft.
    await expect(list.getByRole("option", { selected: true })).toContainText("This device");
    const table = page.getByRole("table", { name: "Differences" });
    await expect(table.getByText("my first draft")).toHaveAttribute("data-changed", "mine");
    await expect(table.getByText("from the other device")).toHaveAttribute("data-changed", "theirs");

    await page.getByRole("button", { name: "Inline" }).click();
    await expect(page.getByRole("list", { name: "Differences" })).toContainText("my first draft");

    await page.getByRole("button", { name: "Restore this version" }).click();
    await expect(page.getByRole("dialog", { name: "Version history" })).toHaveCount(0);
    await expect(editor).toHaveValue("line one\nmy first draft\nline three");

    // The restore is a new version; the replaced text stays in the history.
    const versions = await (await page.request.get(`${API}/api/notes/${noteId}/versions`, { headers: h })).json();
    expect(versions).toHaveLength(3);
    const restored = await (await page.request.get(`${API}/api/notes/${noteId}`, { headers: h })).json();
    expect(restored.content).toBe("line one\nmy first draft\nline three");

    // Further edits save on top of the restored version without a conflict.
    await typeInEditor(page, "line one\nmy first draft, edited\nline three");
    await waitForSaved(page);
    await expect(page.locator(".status-indicator--conflict")).toHaveCount(0);
  });
});
