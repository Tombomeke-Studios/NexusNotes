import { test, expect } from "@playwright/test";
import { uid, register, clearAuth, createNote, noteIdByTitle } from "./helpers";

const API = "http://localhost:8080";
const PASSPHRASE = "correct horse battery staple";
// A 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Files in an end-to-end encrypted vault are encrypted on the device (#238).
test.describe("Attachments in an e2ee vault", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    // The first vault is end-to-end encrypted by default (#360).
    const input = page.getByPlaceholder("Vault name (e.g. Personal)");
    await input.fill(`Secret-${uid()}`);
    await page.getByPlaceholder("Vault passphrase").fill(PASSPHRASE);
    await page.getByPlaceholder("Confirm passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Create vault" }).click();
    await expect(page.getByTestId("recovery-code")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel(/saved this recovery code/i).check();
    await page.getByRole("button", { name: "Continue" }).click();
  });

  test("a dropped image is encrypted before upload and still renders", async ({ page }) => {
    const title = await createNote(page, "Photos");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("An image:\n\n");

    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      document
        .querySelector(".editor-textarea")!
        .dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, PNG_B64);

    await expect(textarea).toHaveValue(/!\[\[dropped\.png\]\]/, { timeout: 8000 });
    const img = page.locator(".editor-preview img.attachment-image").first();
    await expect(img).toHaveAttribute("src", /^blob:/, { timeout: 8000 });
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);

    // The server only has an opaque name and opaque bytes.
    const token = await page.evaluate(() => localStorage.getItem("nexus_token"));
    const headers = { Authorization: `Bearer ${token}` };
    const noteId = await noteIdByTitle(page, title);
    const atts = (await (await page.request.get(`${API}/api/notes/${noteId}/attachments`, { headers })).json()) as Array<{
      id: string;
      filename: string;
      mime_type: string;
    }>;
    expect(atts).toHaveLength(1);
    expect(atts[0].filename).toMatch(/^e2ee\.[A-Za-z0-9_-]+\.bin$/);
    expect(atts[0].mime_type).toBe("application/octet-stream");
    const raw = await (await page.request.get(`${API}/api/attachments/${atts[0].id}`, { headers })).body();
    expect(raw.subarray(1, 4).toString()).not.toBe("PNG");
  });
});
