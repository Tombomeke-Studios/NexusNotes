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
    if (btnText && /sign up|no account/i.test(btnText) && !/have an account/i.test(btnText)) {
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
    // If toggle says "Have an account? Sign in" we're on the register form
    if (btnText && /have an account/i.test(btnText)) {
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
  const firstRun = page.locator(".firstrun-input");
  if (await firstRun.isVisible().catch(() => false)) {
    // No vaults yet: the first-run onboarding card is shown
    await firstRun.fill(vaultName);
    await firstRun.press("Enter");
  } else {
    // Otherwise the vault switcher lives behind the sidebar head button
    await page.locator(".sidebar-vault-btn").click();
    await page.getByRole("button", { name: /new vault/i }).click();
    const input = page.getByPlaceholder(/vault name/i);
    await input.fill(vaultName);
    await input.press("Enter");
  }
  // The new vault becomes active; its name shows in the sidebar head button
  await expect(page.locator(".sidebar-vault-name")).toHaveText(vaultName, { timeout: 8_000 });
  return vaultName;
}

/** Creates a note via Ctrl+N and sets its title, returning the title. */
export async function createNote(page: Page, title?: string) {
  const noteTitle = title ?? `Note-${uid()}`;
  await page.keyboard.press("Control+n");
  const titleInput = page.locator(".editor-title-input").first();
  await expect(titleInput).toBeVisible();
  await titleInput.click({ clickCount: 3 });
  await titleInput.fill(noteTitle);
  await titleInput.press("Tab");
  return noteTitle;
}

export async function typeInEditor(page: Page, text: string) {
  const editor = page.locator(".editor-textarea").first();
  await editor.click();
  await editor.fill(text);
}

/**
 * Waits for the debounced autosave PUT to actually persist the note.
 * Call immediately after editing content — a status-text check alone races
 * the 1s debounce and can pass before anything is persisted.
 */
export async function waitForAutosave(page: Page) {
  await page.waitForResponse(
    (r) => r.url().includes("/api/notes/") && r.request().method() === "PUT" && r.ok(),
    { timeout: 10_000 },
  );
  await expect(page.locator(".status-indicator--saved")).toBeVisible({ timeout: 8_000 });
}

export async function waitForSaved(page: Page) {
  await expect(page.locator(".status-indicator--saved")).toBeVisible({ timeout: 8_000 });
}

/**
 * Opens the unified palette. Ctrl+P = note quick-open, Ctrl+Shift+P = command
 * mode (query prefilled with ">"). Returns the palette input locator.
 */
export async function openPalette(page: Page, mode: "notes" | "commands" = "commands") {
  await page.keyboard.press(mode === "commands" ? "Control+Shift+P" : "Control+p");
  const input = page.locator(".palette-head input");
  await expect(input).toBeVisible();
  return input;
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
