import { test, expect } from "@playwright/test";
import { register, clearAuth, createVault, createNote } from "./helpers";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
// The Files tab in the right panel (#238).
test("uploads, lists and deletes a note's files in the Files tab", async ({ page }) => {
  await clearAuth(page);
  await register(page);
  await createVault(page);
  await createNote(page, "With files");
  await page.locator(".right-panel-tab", { hasText: "Files" }).click();
  await expect(page.getByText(/No files attached/)).toBeVisible();
  await page.locator(".attachments-tab input[type=file]").setInputFiles([{ name: "dot.png", mimeType: "image/png", buffer: PNG }]);
  await expect(page.locator(".attachments-filename")).toHaveText("dot.png", { timeout: 8000 });
  await expect(page.getByRole("status").filter({ hasText: "Uploaded 1 file" })).toBeVisible();
  await page.getByRole("button", { name: "Delete dot.png" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(/No files attached/)).toBeVisible();
});
