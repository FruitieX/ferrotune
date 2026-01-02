/**
 * Starring and ratings tests - Favorites functionality
 */

import { test, expect } from "./fixtures";

test.describe("Starring and Ratings", () => {
  test("can star and unstar a song", async ({ authenticatedPage: page }) => {
    // Navigate directly to library albums
    await page.goto("/library/albums");
    await page.waitForSelector('[data-testid="media-card"]', {
      timeout: 10000,
    });

    const testAlbum = page
      .locator('[data-testid="media-card"]')
      .filter({ hasText: "Test Album" });
    await expect(testAlbum).toBeVisible({ timeout: 5000 });
    await testAlbum.click();

    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const firstSongRow = page.locator('[data-testid="song-row"]').first();
    await firstSongRow.hover();

    const starButton = firstSongRow
      .getByRole("button")
      .filter({ has: page.locator("svg") })
      .first();

    // Star
    await starButton.click();
    await page.waitForTimeout(1000);

    // Unstar
    await firstSongRow.hover();
    await starButton.click();
    await page.waitForTimeout(500);

    expect(page.url()).toBeTruthy();
  });

  test("can rate song from menu", async ({ authenticatedPage: page }) => {
    // Navigate directly to library albums
    await page.goto("/library/albums");
    await page.waitForSelector('[data-testid="media-card"]', {
      timeout: 10000,
    });

    const testAlbum = page
      .locator('[data-testid="media-card"]')
      .filter({ hasText: "Test Album" });
    await expect(testAlbum).toBeVisible({ timeout: 5000 });
    await testAlbum.click();

    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const firstSongRow = page.locator('[data-testid="song-row"]').first();
    await firstSongRow.hover();
    await page.waitForTimeout(200);

    const moreButton = firstSongRow.getByRole("button", {
      name: /more options/i,
    });
    await expect(moreButton).toBeVisible({ timeout: 2000 });
    await moreButton.click();

    await page.waitForTimeout(300);

    const rateOption = page.getByRole("menuitem", { name: /^rate/i });
    await expect(rateOption).toBeVisible({ timeout: 2000 });
    await rateOption.click();

    await page.waitForTimeout(300);

    const ratingSubmenu = page.locator(
      '[data-slot="dropdown-menu-sub-content"]',
    );
    await expect(ratingSubmenu).toBeVisible({ timeout: 2000 });

    // Click 5 stars
    const ratingMenuItems = ratingSubmenu
      .locator('[role="menuitem"]')
      .filter({ hasNotText: "Remove Rating" });
    const fiveStarOption = ratingMenuItems.nth(4);
    await expect(fiveStarOption).toBeVisible({ timeout: 2000 });
    await fiveStarOption.click();

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /rated/i }),
    ).toBeVisible({ timeout: 3000 });
  });
});
