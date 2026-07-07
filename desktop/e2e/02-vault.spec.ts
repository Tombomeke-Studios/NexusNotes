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
    await expect(page.locator(".sidebar-vault").filter({ hasText: name })).toBeVisible();
  });

  test("created vault becomes active (highlighted)", async ({ page }) => {
    const name = `Vault-${uid()}`;
    await createVault(page, name);
    await expect(
      page.locator(".sidebar-vault.active").filter({ hasText: name })
    ).toBeVisible();
  });

  test("can switch between multiple vaults", async ({ page }) => {
    const vault1 = await createVault(page, `VaultA-${uid()}`);
    const vault2 = await createVault(page, `VaultB-${uid()}`);

    await page.locator(".sidebar-vault").filter({ hasText: vault1 }).click();
    await expect(page.locator(".sidebar-vault.active")).toContainText(vault1);

    await page.locator(".sidebar-vault").filter({ hasText: vault2 }).click();
    await expect(page.locator(".sidebar-vault.active")).toContainText(vault2);
  });

  test("vaults persist after page reload", async ({ page }) => {
    const name = `Vault-${uid()}`;
    await createVault(page, name);
    await page.reload();
    await expect(page.locator(".sidebar-vault").filter({ hasText: name })).toBeVisible();
  });
});
