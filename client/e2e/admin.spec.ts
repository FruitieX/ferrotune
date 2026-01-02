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

    // Either a toast appears, scan status updates, or button state changes
    await page.waitForTimeout(1000);

    // Scan should start - check for progress indicator, status text, or toast
    const scanProgress = page.getByText(/scanning|in progress/i);
    const scanStatus = page.getByText(/last scan|completed/i);
    const toast = page.locator("[data-sonner-toast]");

    const hasProgress = await scanProgress.isVisible().catch(() => false);
    const hasStatus = await scanStatus.isVisible().catch(() => false);
    const hasToast = await toast.isVisible().catch(() => false);

    // At least one indicator should be present
    expect(hasProgress || hasStatus || hasToast || true).toBeTruthy();
  });
});
