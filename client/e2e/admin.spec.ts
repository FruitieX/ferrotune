/**
 * Admin tests - Admin panel functionality
 */

import { test, expect } from "./fixtures";

test.describe("Admin", () => {
  test("admin page is accessible with scan button", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/admin");

    // Should show admin heading
    await expect(
      page.getByRole("heading", { name: /admin|administration/i }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Should show scan button
    const scanButton = page.getByRole("button", { name: /scan|rescan/i });
    await expect(scanButton).toBeVisible();
  });

  test("can trigger library scan", async ({ authenticatedPage: page }) => {
    await page.goto("/admin");

    await expect(
      page.getByRole("heading", { name: /admin|administration/i }),
    ).toBeVisible({
      timeout: 10000,
    });

    // Click scan button
    const scanButton = page.getByRole("button", { name: /scan|rescan/i });
    await expect(scanButton).toBeVisible();
    await scanButton.click();

    const scanDialog = page.getByRole("dialog");
    await expect(scanDialog).toBeVisible();
    const startResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/scan" &&
        response.request().method() === "POST",
    );
    await scanDialog.getByRole("button", { name: /start scan/i }).click();
    expect((await startResponse).ok()).toBe(true);
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      /scan started/i,
    );
  });
});
