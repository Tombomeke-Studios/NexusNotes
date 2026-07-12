import { test, expect, type Page } from "@playwright/test";
import { uid, register, clearAuth } from "./helpers";

const API = "http://localhost:8080";
const PASSPHRASE = "correct horse battery staple";
// base64(iv):base64(ciphertext+tag) — the only shape the server may ever hold.
const CIPHERTEXT_SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

async function apiHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem("nexus_token"));
  return { Authorization: `Bearer ${token}` };
}

async function getNote(page: Page, vaultName: string, title: string) {
  const headers = await apiHeaders(page);
  const vaults = await (await page.request.get(`${API}/api/vaults`, { headers })).json();
  const vault = (vaults as Array<{ id: string; name: string; encryption: string }>).find(
    (v) => v.name === vaultName,
  );
  if (!vault) return { vault: null, note: null };
  const notes = await (
    await page.request.get(`${API}/api/vaults/${vault.id}/notes`, { headers })
  ).json();
  const listed = (notes as Array<{ id: string; title: string }> | null)?.find(
    (n) => n.title === title,
  );
  if (!listed) return { vault, note: null };
  const note = await (
    await page.request.get(`${API}/api/notes/${listed.id}`, { headers })
  ).json();
  return { vault, note: note as { id: string; content: string; checksum: string } };
}

/** Creates the account's first vault as an e2ee vault via the first-run card. */
async function createEncryptedFirstVault(page: Page, name: string) {
  const input = page.getByPlaceholder("Vault name (e.g. Personal)");
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(name);
  await page.getByLabel(/end-to-end encrypt/i).check();
  await page.getByPlaceholder("Vault passphrase").fill(PASSPHRASE);
  await page.getByPlaceholder("Confirm passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Create vault" }).click();

  // The recovery code is shown exactly once and gated behind a confirmation.
  const code = page.getByTestId("recovery-code");
  await expect(code).toBeVisible({ timeout: 20_000 });
  await expect(code).toHaveText(/^([A-Z2-7]{4}-)+[A-Z2-7]{4}$/);
  const cont = page.getByRole("button", { name: "Continue" });
  await expect(cont).toBeDisabled();
  await page.getByLabel(/saved this recovery code/i).check();
  await cont.click();
  await expect(page.locator(".sidebar-vault-name")).toHaveText(name, { timeout: 10_000 });
}

test.describe("E2EE vaults", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
  });

  test("encrypted note survives the full round-trip: encrypt, upload, lock, unlock, decrypt", async ({ page }) => {
    const vaultName = `Secret-${uid()}`;
    const secret = `TOP-SECRET-${uid()}`;
    await createEncryptedFirstVault(page, vaultName);

    // The vault is e2ee server-side and the seeded welcome note is ciphertext.
    await expect
      .poll(async () => (await getNote(page, vaultName, "Welcome")).note?.content ?? "", {
        timeout: 15_000,
      })
      .toMatch(CIPHERTEXT_SHAPE);
    const { vault } = await getNote(page, vaultName, "Welcome");
    expect(vault?.encryption).toBe("e2ee");

    // ...while the editor shows readable plaintext.
    const editor = page.locator(".editor-textarea");
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await expect(editor).toHaveValue(/Welcome to NexusNotes/);

    // Type a secret; the autosaved server copy must not contain it. Wait for
    // the debounced save by polling until the stored ciphertext changes.
    const { note: seeded } = await getNote(page, vaultName, "Welcome");
    await editor.fill(`# Edited\n\n${secret}\n`);
    await expect
      .poll(async () => (await getNote(page, vaultName, "Welcome")).note?.content ?? "", {
        timeout: 15_000,
      })
      .not.toBe(seeded!.content);
    const { note: saved } = await getNote(page, vaultName, "Welcome");
    expect(saved!.content).toMatch(CIPHERTEXT_SHAPE);
    expect(saved!.content).not.toContain(secret);
    expect(saved!.checksum).toMatch(/^[0-9a-f]{64}$/); // client plaintext checksum, stored verbatim
    expect(saved!.checksum).not.toBe(seeded!.checksum);

    // Plaintext never touches disk: no local draft for e2ee vaults.
    const drafts = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.toLowerCase().includes("draft"))
        .map((k) => localStorage.getItem(k))
        .join(""),
    );
    expect(drafts).not.toContain(secret);

    // Reload drops the in-memory key: the vault is locked and prompts.
    await page.reload();
    const passInput = page.getByPlaceholder("Vault passphrase");
    await expect(passInput).toBeVisible({ timeout: 15_000 });

    // A wrong passphrase is rejected without unlocking anything.
    await passInput.fill("definitely the wrong one");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.getByText(/wrong passphrase/i)).toBeVisible({ timeout: 20_000 });

    // The right passphrase decrypts the vault and the edited note round-trips.
    await passInput.fill(PASSPHRASE);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.locator(".sidebar-vault-lock").first()).toBeVisible({ timeout: 20_000 });
    await page.locator("[data-note-id]").filter({ hasText: "Welcome" }).first().click();
    await expect(page.locator(".editor-textarea")).toHaveValue(new RegExp(secret), {
      timeout: 10_000,
    });
  });
});
