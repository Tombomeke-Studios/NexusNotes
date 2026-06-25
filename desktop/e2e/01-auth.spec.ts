import { test, expect } from "@playwright/test";
import { uid, register, login, clearAuth, clearLocalStorage } from "./helpers";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
  });

  test("shows auth screen when not logged in", async ({ page }) => {
    await expect(page.locator(".auth-container").first()).toBeVisible();
    await expect(page.locator(".sidebar")).not.toBeVisible();
  });

  test("shows Sign In form by default", async ({ page }) => {
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("toggle switches to Create Account form", async ({ page }) => {
    await page.locator(".auth-toggle").click();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
    await expect(page.getByPlaceholder("Display name")).toBeVisible();
  });

  test("registers a new account and lands on the app", async ({ page }) => {
    const email = `reg-${uid()}@nexus.test`;
    await page.locator(".auth-toggle").click();
    await page.getByPlaceholder("Display name").fill("Test User");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("Password1!");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.locator(".sidebar")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".auth-container")).not.toBeVisible();
  });

  test("shows error for duplicate email registration", async ({ page }) => {
    const email = `dup-${uid()}@nexus.test`;
    await register(page, email);
    await clearAuth(page);

    // Second registration with same email
    await page.locator(".auth-toggle").click();
    await page.getByPlaceholder("Display name").fill("Test User 2");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("Password1!");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.locator(".auth-error")).toBeVisible({ timeout: 5_000 });
  });

  test("logs in with valid credentials", async ({ page }) => {
    const { email, password } = await register(page);
    await clearAuth(page);

    await login(page, email, password);
    await expect(page.locator(".sidebar")).toBeVisible();
  });

  test("shows error for wrong password", async ({ page }) => {
    const { email } = await register(page);
    await clearAuth(page);

    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill("WrongPassword123!");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator(".auth-error")).toBeVisible({ timeout: 5_000 });
  });

  test("logs out and returns to auth screen", async ({ page }) => {
    await register(page);
    // Open command palette and sign out
    await page.keyboard.press("Control+Shift+P");
    await page.locator(".command-input, .command-palette input").fill("Sign Out");
    await page.locator("[class*='command-item'], [class*='palette-item']").filter({ hasText: /sign out/i }).click();

    await expect(page.locator(".auth-container").first()).toBeVisible({ timeout: 5_000 });
  });

  test("redirects to auth when token is cleared", async ({ page }) => {
    await register(page);
    await expect(page.locator(".sidebar")).toBeVisible();

    await page.evaluate(() => localStorage.removeItem("nexus_token"));
    await page.reload();

    await expect(page.locator(".auth-container").first()).toBeVisible();
  });
});
