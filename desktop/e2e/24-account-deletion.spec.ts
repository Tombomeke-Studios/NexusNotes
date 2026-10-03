import { test, expect } from "@playwright/test";
import { register, clearAuth, createVault } from "./helpers";

// Account deletion with a 7-day grace period (#289).
test.describe("Account deletion", () => {
  test("deleting schedules it; signing in again shows the date and can keep the account", async ({ page }) => {
    await clearAuth(page);
    const { email, password } = await register(page);
    await createVault(page);

    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: /^account$/i }).click();
    await page.getByRole("button", { name: "Delete account…" }).click();
    await page.getByPlaceholder("Current password").fill(password);
    await page.locator(".settings-danger-actions").getByRole("button", { name: /delete/i }).click();

    // Signed out, with the date and how to keep it.
    await expect(page.getByPlaceholder("Email")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("status").filter({ hasText: "will be deleted on" })).toBeVisible();

    // Signing in during the grace period works and says what is coming.
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const banner = page.locator(".deletion-banner");
    await expect(banner).toContainText("will be deleted on", { timeout: 10_000 });

    await banner.getByRole("button", { name: "Keep my account" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".sidebar")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".deletion-banner")).toHaveCount(0);
  });

  test("someone who can't sign in can request deletion without revealing accounts", async ({ page }) => {
    await clearAuth(page);
    await page.getByRole("button", { name: /request account deletion/i }).click();
    await page.getByPlaceholder("Email").fill("nobody-here@nexus.test");
    await page.getByRole("button", { name: "Send confirmation link" }).click();
    await expect(page.getByText(/If an account exists for that address, we've sent a link/)).toBeVisible();
  });
});
