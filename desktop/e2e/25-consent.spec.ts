import { test, expect } from "@playwright/test";

// The storage notice and its preferences (#289).
test("the storage notice shows once and its preferences can be reopened", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("nexus_consent"));
  await page.reload();
  const banner = page.getByRole("region", { name: "Cookies and storage" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Cookie Policy" })).toHaveAttribute("href", "/legal/cookies.html");
  await banner.getByRole("button", { name: "OK" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(banner).toHaveCount(0);

  await page.getByRole("button", { name: "Cookie preferences" }).click();
  await expect(banner.getByRole("checkbox", { name: /Necessary/ })).toBeDisabled();
  await expect(banner.getByRole("checkbox", { name: /Analytics/ })).not.toBeChecked();
});
