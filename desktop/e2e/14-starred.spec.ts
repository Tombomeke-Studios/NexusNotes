import { test, expect } from "@playwright/test";
import { register, createVault, createNote, clearAuth } from "./helpers";

test.describe("Starred notes (#151)", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await register(page);
    await createVault(page);
  });

  test("starring a note shows it in the Starred section and survives a reload", async ({ page }) => {
    const title = await createNote(page);

    await page.locator("[data-note-id]").filter({ hasText: title }).first().click({ button: "right" });
    await page.getByRole("button", { name: "Star", exact: true }).click();

    const starredSection = page.locator(".sidebar-recent").filter({ hasText: "Starred" });
    await expect(starredSection.locator(".sidebar-recent-item").filter({ hasText: title })).toBeVisible();

    // Wait until the star actually landed server-side before reloading (the
    // UI updates optimistically while the POST is still in flight).
    const token = await page.evaluate(() => localStorage.getItem("nexus_token"));
    await expect
      .poll(
        async () =>
          (await (
            await page.request.get("http://localhost:8080/api/notes/starred", {
              headers: { Authorization: `Bearer ${token}` },
            })
          ).json()) as string[],
        { timeout: 10_000 },
      )
      .toHaveLength(1);

    // Stars are server-side: they survive a full reload.
    await page.reload();
    await expect(
      page.locator(".sidebar-recent").filter({ hasText: "Starred" }).locator(".sidebar-recent-item").filter({ hasText: title }),
    ).toBeVisible({ timeout: 10_000 });

    // Unstar removes the section again.
    await page.locator("[data-note-id]").filter({ hasText: title }).first().click({ button: "right" });
    await page.getByRole("button", { name: "Remove star" }).click();
    await expect(page.getByText("Starred", { exact: true })).toHaveCount(0);
  });
});
