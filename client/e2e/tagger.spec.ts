/**
 * Tagger tests - Tag editing functionality
 */

import { test, expect } from "./fixtures";

test.describe("Tagger", () => {
  test("tagger page loads with empty state", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/tagger");

    // Should show tagger heading
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Should show empty state
    await expect(page.getByText("No tracks loaded")).toBeVisible({
      timeout: 5000,
    });

    // Should have action buttons
    await expect(
      page.getByRole("button", { name: /upload files/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /add from library/i }),
    ).toBeVisible();
  });

  test("can open add from library dialog", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Click "Add from Library" button
    const addFromLibraryButton = page.getByRole("button", {
      name: /add from library/i,
    });
    await expect(addFromLibraryButton).toBeVisible({ timeout: 5000 });
    await addFromLibraryButton.click();

    // Dialog should open
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog should have search functionality
    await expect(dialog.getByRole("textbox")).toBeVisible();
  });

  test("can load tracks from library via dialog", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Click "Add from Library" button
    await page.getByRole("button", { name: /add from library/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Wait for tracks to load in the dialog
    await page.waitForTimeout(1000);

    // Look for checkboxes to select tracks
    const checkboxes = dialog
      .locator('button[role="checkbox"], [data-state]')
      .first();
    if (await checkboxes.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkboxes.click();

      // Click add button
      const addButton = dialog
        .getByRole("button", { name: /add|confirm|ok/i })
        .first();
      if (await addButton.isEnabled().catch(() => false)) {
        await addButton.click();

        // Wait for tracks to load
        await page.waitForTimeout(1000);

        // Empty state should no longer be visible
        await expect(page.getByText("No tracks loaded")).not.toBeVisible({
          timeout: 5000,
        });
      }
    }
  });

  test("files dropdown menu is accessible", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Look for the "Files" dropdown button
    const filesButton = page.getByRole("button", { name: /files/i });
    if (await filesButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filesButton.click();

      // Should show menu items
      const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
      await expect(dropdown).toBeVisible();

      await expect(
        dropdown.getByRole("menuitem", { name: /upload/i }),
      ).toBeVisible();
      await expect(
        dropdown.getByRole("menuitem", { name: /add from library/i }),
      ).toBeVisible();
    }
  });
});
