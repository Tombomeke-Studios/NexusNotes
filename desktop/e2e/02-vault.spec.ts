import { test, expect } from "@playwright/test";
import { uid, register, createVault, clearAuth } from "./helpers";

test.describe("Vault management", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
  });

  test("creates a new vault", async ({ page }) => {
    const name = `Vault-${uid()}`;
    await createVault(page, name);
    await expect(page.locator(".sidebar-vault-name")).toHaveText(name);
  });

  test("created vault becomes active in the sidebar head", async ({ page }) => {
    const name = `Vault-${uid()}`;
    await createVault(page, name);
    await expect(page.locator(".sidebar-vault-name")).toHaveText(name);
  });

  test("can switch between multiple vaults", async ({ page }) => {
    const vault1 = await createVault(page, `VaultA-${uid()}`);
    const vault2 = await createVault(page, `VaultB-${uid()}`);
    await expect(page.locator(".sidebar-vault-name")).toHaveText(vault2);

    // Open the vault switcher and pick the first vault
    await page.locator(".sidebar-vault-btn").click();
    await page.locator(".sidebar-vault-item").filter({ hasText: vault1 }).click();
    await expect(page.locator(".sidebar-vault-name")).toHaveText(vault1);

    await page.locator(".sidebar-vault-btn").click();
    await page.locator(".sidebar-vault-item").filter({ hasText: vault2 }).click();
    await expect(page.locator(".sidebar-vault-name")).toHaveText(vault2);
  });

  test("vaults persist after page reload", async ({ page }) => {
    const name = `Vault-${uid()}`;
    await createVault(page, name);
    await page.reload();
    await expect(page.locator(".sidebar-vault-name")).toHaveText(name, { timeout: 10_000 });
  });
});
