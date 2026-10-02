import { test, expect } from "@playwright/test";
import { uid, register, clearAuth, createVault, createNote, typeInEditor, waitForSaved } from "./helpers";

const API = "http://localhost:8080";
const PASSPHRASE = "correct horse battery staple";
// base64(iv):base64(ciphertext+tag): what the server holds for an e2ee note.
const CIPHERTEXT_SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

// Turning an existing standard vault end-to-end encrypted (#361).
test.describe("Encrypt an existing vault", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
  });

  test("encrypts every note on the device and keeps them readable after unlock", async ({ page }) => {
    const vaultName = await createVault(page, `Plain-${uid()}`);
    const title = await createNote(page);
    const secret = `ZEBRA-${uid()} private`;
    await typeInEditor(page, secret);
    await waitForSaved(page);

    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: /^sync$/i }).click();
    await page.getByRole("button", { name: /encrypt this vault/i }).click();
    await page.getByPlaceholder("New vault passphrase").fill(PASSPHRASE);
    await page.getByPlaceholder("Confirm passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Encrypt vault" }).click();

    await expect(page.getByTestId("recovery-code")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/saved this recovery code/i).check();
    await page.getByRole("button", { name: "Continue" }).click();

    const token = await page.evaluate(() => localStorage.getItem("nexus_token"));
    const headers = { Authorization: `Bearer ${token}` };
    const vaults = (await (await page.request.get(`${API}/api/vaults`, { headers })).json()) as Array<{
      id: string;
      name: string;
      encryption: string;
    }>;
    const vault = vaults.find((v) => v.name === vaultName)!;
    expect(vault.encryption).toBe("e2ee");
    const notes = (await (await page.request.get(`${API}/api/vaults/${vault.id}/notes`, { headers })).json()) as Array<{
      id: string;
      title: string;
      content: string;
    }>;
    const stored = notes.find((n) => n.title === title)!;
    expect(stored.content).toMatch(CIPHERTEXT_SHAPE);
    expect(stored.content).not.toContain("ZEBRA");
    const versions = await (await page.request.get(`${API}/api/notes/${stored.id}/versions`, { headers })).json();
    expect(versions ?? []).toHaveLength(0);

    // A fresh session must unlock before it can read the note.
    await page.reload();
    await page.getByPlaceholder("Vault passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.locator(".sidebar").getByText(title, { exact: true }).first().click();
    await expect(page.locator(".editor-textarea").first()).toHaveValue(new RegExp(secret));
  });
});
