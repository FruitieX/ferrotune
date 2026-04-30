/**
 * Starring and ratings tests - Favorites functionality
 */

import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function openTestAlbumDetails(page: Page) {
  await page.goto("/library/albums");

  const gridViewButton = page.getByRole("button", { name: /grid view/i });
  await expect(gridViewButton).toBeVisible();
  await gridViewButton.click();

  const testAlbum = page
    .locator('[data-testid="media-card"]')
    .filter({ hasText: "Test Album" });
  await expect(testAlbum).toBeVisible();
  await testAlbum.click();

  await expect(page).toHaveURL(/\/library\/albums\/details/);
  await expect(page.locator('[data-testid="song-row"]').first()).toBeVisible();
}

async function showFavoritedColumn(page: Page) {
  const listViewButton = page.getByRole("button", { name: /list view/i });
  if ((await listViewButton.getAttribute("aria-pressed")) !== "true") {
    await listViewButton.click();
  }

  await page.getByRole("button", { name: /toggle columns/i }).click();

  const columnMenu = page.locator('[data-slot="dropdown-menu-content"]');
  await expect(columnMenu).toBeVisible();

  const favoritedColumn = columnMenu.getByRole("menuitemcheckbox", {
    name: "Favorited",
  });
  await expect(favoritedColumn).toBeVisible();

  if ((await favoritedColumn.getAttribute("aria-checked")) !== "true") {
    await favoritedColumn.click();
  }

  await page.keyboard.press("Escape");
  await expect(columnMenu).not.toBeVisible();
}

test.describe("Starring and Ratings", () => {
  test("can star and unstar a song", async ({ authenticatedPage: page }) => {
    await openTestAlbumDetails(page);

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

  test("favorited column heart button toggles a song", async ({
    authenticatedPage: page,
  }) => {
    await openTestAlbumDetails(page);
    await showFavoritedColumn(page);

    const firstSongRow = page.locator('[data-testid="song-row"]').first();
    const addFavoriteButton = firstSongRow.getByRole("button", {
      name: /add .* to favorites/i,
    });
    await expect(addFavoriteButton).toBeVisible();
    await expect(addFavoriteButton).toHaveAttribute("title", "Not favorited");

    await addFavoriteButton.click();

    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /added to favorites/i }),
    ).toBeVisible();

    const removeFavoriteButton = firstSongRow.getByRole("button", {
      name: /remove .* from favorites/i,
    });
    await expect(removeFavoriteButton).toBeVisible();
    await expect(removeFavoriteButton).toHaveAttribute("title", /Favorited/);

    await removeFavoriteButton.click();

    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /removed from favorites/i }),
    ).toBeVisible();
    await expect(addFavoriteButton).toHaveAttribute("title", "Not favorited");
  });

  test("can rate song from menu", async ({ authenticatedPage: page }) => {
    await openTestAlbumDetails(page);

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
