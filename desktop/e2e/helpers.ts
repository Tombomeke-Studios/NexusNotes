import { type Page, expect } from "@playwright/test";

// Unique suffix per test run so tests don't collide on the backend
let _counter = 0;
export function uid(): string {
  return `${Date.now()}-${++_counter}`;
}

export async function register(page: Page, email?: string, password = "Password1!") {
  const e = email ?? `test-${uid()}@nexus.test`;
  await page.goto("/");
  // If already on the main app, skip
  if (await page.locator(".sidebar").isVisible().catch(() => false)) return { email: e, password };

  // Auth form has a toggle button to switch between Sign In / Sign Up
  const toggleBtn = page.locator(".auth-toggle");
  if (await toggleBtn.isVisible().catch(() => false)) {
    const btnText = await toggleBtn.textContent();
    if (btnText && /sign up|sign in/i.test(btnText) && !/already have/i.test(btnText)) {
      await toggleBtn.click();
    }
  }

  await page.getByPlaceholder("Display name").fill("Test User");
  await page.getByPlaceholder("Email").fill(e);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.locator(".sidebar")).toBeVisible({ timeout: 10_000 });
  return { email: e, password };
}

export async function login(page: Page, email: string, password = "Password1!") {
  await page.goto("/");
  // Ensure we're on sign-in form (default state)
  const toggleBtn = page.locator(".auth-toggle");
  if (await toggleBtn.isVisible().catch(() => false)) {
    const btnText = await toggleBtn.textContent();
    // If toggle says "Sign up" we're already on login form; if it says "Sign in" we need to switch
    if (btnText && /already have/i.test(btnText)) {
      await toggleBtn.click();
    }
  }
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.locator(".sidebar")).toBeVisible({ timeout: 10_000 });
}

export async function createVault(page: Page, name?: string) {
  const vaultName = name ?? `Vault-${uid()}`;
  // Click "New vault" or the vault creation button
  const newVaultBtn = page.getByRole("button", { name: /new vault/i });
  if (await newVaultBtn.isVisible().catch(() => false)) {
    await newVaultBtn.click();
  } else {
    // May need to find the vault section first
    await page.locator(".sidebar-header").getByRole("button").first().click();
  }
  const input = page.getByPlaceholder(/vault name/i);
  await input.fill(vaultName);
  await input.press("Enter");
  await expect(page.locator(".sidebar-vault").filter({ hasText: vaultName })).toBeVisible();
  return vaultName;
}

export async function createNote(page: Page, title?: string) {
  const noteTitle = title ?? `Note-${uid()}`;
  // Ctrl+N shortcut
  await page.keyboard.press("Control+n");
  // Wait for new note to appear and be editable
  await expect(page.locator(".editor-toolbar-title, .note-title-input, input[placeholder*='title' i]")).toBeVisible();
  const titleInput = page.locator(".editor-toolbar-title, .note-title-input, input[placeholder*='title' i]").first();
  await titleInput.click({ clickCount: 3 });
  await titleInput.fill(noteTitle);
  await titleInput.press("Tab");
  return noteTitle;
}

export async function typeInEditor(page: Page, text: string) {
  const editor = page.locator(".editor-textarea, textarea.editor, [data-testid='editor-input']").first();
  await editor.click();
  await editor.fill(text);
}

export async function waitForSaved(page: Page) {
  await expect(page.locator(".status-bar").filter({ hasText: /saved/i })).toBeVisible({ timeout: 8_000 });
}

export async function clearAuth(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    try {
      localStorage.removeItem("nexus_token");
      localStorage.removeItem("nexus_device_id");
    } catch {}
  });
  await page.reload();
}

export async function clearLocalStorage(page: Page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("nexus_token");
      localStorage.removeItem("nexus_device_id");
    } catch {}
  });
}
