import { test, expect } from "@playwright/test";
import { uid, register, createVault } from "./helpers";

test.describe("Device management (#44 #45)", () => {
  test("lists devices, revokes a second session, and the revoked device signs out", async ({ browser }) => {
    const email = `dev-${uid()}@nexus.test`;
    const password = "Password1!";

    // Device A: fresh account + vault.
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await register(pageA, email, password);
    await createVault(pageA);

    // Device B: same account, separate context = separate device id.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto("/");
    await pageB.getByPlaceholder("Email").fill(email);
    await pageB.getByPlaceholder("Password").fill(password);
    await pageB.getByRole("button", { name: /sign in/i }).click();
    await expect(pageB.locator(".sidebar")).toBeVisible({ timeout: 10_000 });
    await pageB.waitForTimeout(800); // WS connect registers the device

    // Device A sees both devices; its own row is badged and not revocable.
    await pageA.keyboard.press("Control+,");
    await pageA.getByRole("button", { name: "Account" }).click();
    await expect(pageA.locator(".settings-device")).toHaveCount(2, { timeout: 8_000 });
    await expect(pageA.locator(".settings-device-badge")).toHaveCount(1);
    await expect(
      pageA.locator(".settings-device")
        .filter({ has: pageA.locator(".settings-device-badge") })
        .locator(".settings-device-revoke"),
    ).toBeDisabled();

    // Revoke device B: the row disappears and B is forced out.
    await pageA
      .locator(".settings-device")
      .filter({ hasNot: pageA.locator(".settings-device-badge") })
      .locator(".settings-device-revoke")
      .click();
    await expect(pageA.locator(".settings-device")).toHaveCount(1);
    await expect(pageB.getByPlaceholder("Email")).toBeVisible({ timeout: 10_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
