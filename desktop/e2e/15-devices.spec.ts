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
    // Device B registers itself when its WebSocket connects: wait for that.
    const token = await pageA.evaluate(() => localStorage.getItem("nexus_token"));
    await expect
      .poll(async () => {
        const res = await pageA.request.get("http://localhost:8080/api/devices", {
          headers: { Authorization: `Bearer ${token}` },
        });
        return ((await res.json()) as unknown[]).length;
      })
      .toBe(2);

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
