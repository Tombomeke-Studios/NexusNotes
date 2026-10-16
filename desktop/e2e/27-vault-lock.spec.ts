import { test, expect, type Page } from "@playwright/test";
import { uid, register, clearAuth, openPalette, waitForSaved } from "./helpers";

const PASSPHRASE = "correct horse battery staple";

/** Creates the account's first vault as an e2ee vault via the first-run card. */
async function createEncryptedFirstVault(page: Page, name: string) {
  const input = page.getByPlaceholder("Vault name (e.g. Personal)");
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(name);
  await page.getByLabel(/end-to-end encrypt/i).check();
  await page.getByPlaceholder("Vault passphrase").fill(PASSPHRASE);
  await page.getByPlaceholder("Confirm passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Create vault" }).click();
  await expect(page.getByTestId("recovery-code")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/saved this recovery code/i).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".sidebar-vault-name")).toHaveText(name, { timeout: 10_000 });
}

/** Types a secret into the open Welcome note and waits until the server has it. */
async function typeSecret(page: Page, secret: string) {
  const editor = page.locator(".editor-textarea");
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.fill(`# Edited\n\n${secret}\n`);
  await waitForSaved(page);
}

test.describe("Locking an encrypted vault (#545)", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
  });

  test("the lock icon locks the vault, drops its plaintext, and the passphrase brings it back", async ({ page }) => {
    const secret = `LOCK-SECRET-${uid()}`;
    await createEncryptedFirstVault(page, `Locked-${uid()}`);
    await typeSecret(page, secret);

    await page.getByRole("button", { name: "Lock vault" }).click();

    await expect(page.getByText("This vault is locked")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".editor-textarea")).toHaveCount(0);
    await expect(page.locator("[data-note-id]")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain(secret);

    // The same icon now asks for the passphrase.
    await page.getByRole("button", { name: "Unlock vault" }).click();
    await page.getByPlaceholder("Vault passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.locator("[data-note-id]").filter({ hasText: "Welcome" }).first().click({ timeout: 20_000 });
    await expect(page.locator(".editor-textarea")).toHaveValue(new RegExp(secret), { timeout: 10_000 });
  });

  test("Lock vault is in the command palette", async ({ page }) => {
    await createEncryptedFirstVault(page, `Palette-${uid()}`);
    const input = await openPalette(page, "commands");
    await input.fill(">lock vault");
    await page.keyboard.press("Enter");
    await expect(page.getByText("This vault is locked")).toBeVisible({ timeout: 10_000 });
  });

  test("a lock whose save fails keeps the vault unlocked and the text on screen", async ({ page }) => {
    const secret = `UNSAVED-${uid()}`;
    await createEncryptedFirstVault(page, `Offline-${uid()}`);
    await expect(page.locator(".editor-textarea")).toBeVisible({ timeout: 10_000 });

    // Every note save fails from here on, as if the server were gone.
    await page.route("**/api/notes/*", (route) =>
      route.request().method() === "PUT" ? route.abort("connectionrefused") : route.continue(),
    );
    await page.locator(".editor-textarea").fill(`# Draft\n\n${secret}\n`);
    await page.getByRole("button", { name: "Lock vault" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Couldn't save your changes", { timeout: 15_000 });
    await expect(dialog).toContainText(/stays unlocked/);
    await expect(dialog.getByRole("button", { name: /without saving/i })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Keep editing" }).click();

    await expect(page.getByText("This vault is locked")).toHaveCount(0);
    await expect(page.locator(".editor-textarea")).toHaveValue(new RegExp(secret));

    // Back online: Lock vault goes through.
    await page.unroute("**/api/notes/*");
    await page.getByRole("button", { name: "Lock vault" }).click();
    await expect(page.getByText("This vault is locked")).toBeVisible({ timeout: 20_000 });
  });
});
