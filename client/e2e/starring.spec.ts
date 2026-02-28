/**
 * Starring and ratings tests - Favorites functionality
 */

import { test, expect } from "./fixtures";

test.describe("Starring and Ratings", () => {
  test("can star and unstar a song", async ({ authenticatedPage: page }) => {
    // Navigate directly to library albums
    await page.goto("/library/albums");

    // Switch to grid view
    const gridViewButton = page.getByRole("button", { name: /grid view/i });
    await expect(gridViewButton).toBeVisible({ timeout: 10000 });
    await gridViewButton.click();

    // Wait for media cards and click Test Album
    const testAlbum = page
      .locator('[data-testid="media-card"]')
      .filter({ hasText: "Test Album" });
    await expect(testAlbum).toBeVisible({ timeout: 10000 });
    await testAlbum.click();

    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const firstSongRow = page.locator('[data-testid="song-row"]').first();

    // Star via context menu
    await firstSongRow.click({ button: "right" });
    const contextMenu = page.locator('[data-slot="context-menu-content"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    const addToFavorites = contextMenu.getByRole("menuitem", {
      name: /add to favorites/i,
    });
    await expect(addToFavorites).toBeVisible();
    // Use force to bypass animation stability check
    await addToFavorites.click({ force: true });
    await expect(contextMenu).not.toBeVisible({ timeout: 5000 });

    // Unstar via context menu
    await firstSongRow.click({ button: "right" });
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    const removeFromFavorites = contextMenu.getByRole("menuitem", {
      name: /remove from favorites/i,
    });
    await expect(removeFromFavorites).toBeVisible();
    await removeFromFavorites.click({ force: true });
    await expect(contextMenu).not.toBeVisible({ timeout: 5000 });
  });

  test("can rate song from menu", async ({ authenticatedPage: page }) => {
    // Navigate directly to library albums
    await page.goto("/library/albums");

    // Switch to grid view
    const gridViewButton = page.getByRole("button", { name: /grid view/i });
    await expect(gridViewButton).toBeVisible({ timeout: 10000 });
    await gridViewButton.click();

    // Wait for media cards and click Test Album
    const testAlbum = page
      .locator('[data-testid="media-card"]')
      .filter({ hasText: "Test Album" });
    await expect(testAlbum).toBeVisible({ timeout: 10000 });
    await testAlbum.click();

    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const firstSongRow = page.locator('[data-testid="song-row"]').first();
    await firstSongRow.click({ button: "right" });

    const contextMenu = page.locator('[data-slot="context-menu-content"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // Open Rate submenu - click the trigger to open it
    const rateTrigger = contextMenu
      .locator('[data-slot="context-menu-sub-trigger"]')
      .filter({ hasText: /rate/i });
    await expect(rateTrigger).toBeVisible({ timeout: 2000 });
    // Click to focus and open the submenu
    await rateTrigger.click({ force: true });

    // Wait for the rating submenu to appear
    const ratingSubmenu = page.locator(
      '[data-slot="context-menu-sub-content"]',
    );
    await expect(ratingSubmenu).toBeVisible({ timeout: 3000 });

    // Click the first rating item (5 stars - highest rating option)
    const ratingItem = ratingSubmenu
      .locator('[data-slot="context-menu-item"]')
      .first();
    await expect(ratingItem).toBeVisible({ timeout: 2000 });
    await ratingItem.click({ force: true });

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /rated/i }),
    ).toBeVisible({ timeout: 3000 });
  });
});
