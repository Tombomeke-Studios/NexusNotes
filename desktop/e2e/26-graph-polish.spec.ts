import { test, expect } from "@playwright/test";
import { register, clearAuth, createVault } from "./helpers";
// Graph polish (#267): legend, keyboard access and the list view.
test("the graph has a legend, keyboard access and a list view", async ({ page }) => {
  await clearAuth(page);
  await register(page);
  await createVault(page, undefined, { keepSeed: true });
  await expect(page.locator(".editor-title-input")).toHaveValue("Welcome", { timeout: 8000 });
  await page.keyboard.press("Control+g");
  await expect(page.locator(".graph-node").first()).toBeVisible();
  await expect(page.locator(".graph-legend")).toContainText("Examples");
  // Keyboard: focus a node and open it.
  const node = page.locator(".graph-node[aria-label^='Open Keyboard Shortcuts']");
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-title-input")).toHaveValue("Keyboard Shortcuts", { timeout: 4000 });
  await page.keyboard.press("Control+g");
  await page.locator(".graph-view-switch").getByRole("button", { name: "List" }).click();
  const table = page.getByRole("table", { name: "Notes and their links" });
  await expect(table).toContainText("Getting Started");
  await table.getByRole("button", { name: /^My First Note/ }).click();
  await expect(page.locator(".editor-title-input")).toHaveValue("My First Note");
});
