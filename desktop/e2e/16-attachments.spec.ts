import { test, expect } from "@playwright/test";
import { register, createVault, createNote, clearAuth } from "./helpers";

// A 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.describe("Attachments (#153)", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("dropping an image uploads it and renders it inline", async ({ page }) => {
    await createNote(page, "Photos");
    const textarea = page.locator(".editor-textarea").first();
    await textarea.click();
    await textarea.fill("An image:\n\n");
    await page.waitForTimeout(1200);

    // Simulate a file drop with a real PNG File via a synthetic DataTransfer.
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "dropped.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      document
        .querySelector(".editor-textarea")!
        .dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, PNG_B64);

    // The embed is inserted and the image renders from an authenticated blob URL.
    await expect(textarea).toHaveValue(/!\[\[dropped\.png\]\]/, { timeout: 8000 });
    const img = page.locator(".editor-preview img.attachment-image").first();
    await expect(img).toBeAttached({ timeout: 8000 });
    await expect(img).toHaveAttribute("src", /^blob:/, { timeout: 8000 });
  });
});
