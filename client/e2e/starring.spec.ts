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

async function openSongContextMenu(page: Page, songTitle = "First Song") {
  const songRow = page
    .locator('[data-testid="song-row"]')
    .filter({ hasText: songTitle })
    .first();
  await expect(songRow).toBeVisible({ timeout: 10000 });

  await songRow.click({ button: "right", position: { x: 180, y: 20 } });

  const contextMenu = page.locator(
    '[data-slot="context-menu-content"][data-state="open"]',
  );
  await expect(contextMenu).toBeVisible({ timeout: 5000 });

  return contextMenu;
}

async function activateMenuItem(
  contextMenu: ReturnType<Page["locator"]>,
  name: RegExp,
) {
  const menuItem = contextMenu.getByRole("menuitem", { name });
  await expect(menuItem).toBeVisible({ timeout: 5000 });
  await menuItem.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Context menu item was not an HTMLElement");
    }
    element.click();
  });
}

test.describe("Starring and Ratings", () => {
  test("can star and unstar a song", async ({ authenticatedPage: page }) => {
    await openTestAlbumDetails(page);

    // Star via context menu
    let contextMenu = await openSongContextMenu(page);
    await activateMenuItem(contextMenu, /add to favorites/i);
    await expect(contextMenu).not.toBeVisible({ timeout: 5000 });
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /added to favorites/i }),
    ).toBeVisible({ timeout: 5000 });

    // Unstar via context menu
    contextMenu = await openSongContextMenu(page);
    await activateMenuItem(contextMenu, /remove from favorites/i);
    await expect(contextMenu).not.toBeVisible({ timeout: 5000 });
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /removed from favorites/i }),
    ).toBeVisible({ timeout: 5000 });
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

    const contextMenu = await openSongContextMenu(page);

    const rateTrigger = contextMenu
      .locator('[data-slot="context-menu-sub-trigger"]')
      .filter({ hasText: /rate/i });
    await expect(rateTrigger).toBeVisible({ timeout: 5000 });
    await rateTrigger.hover();

    const ratingSubmenu = page.locator(
      '[data-slot="context-menu-sub-content"][data-state="open"]',
    );
    await expect(ratingSubmenu).toBeVisible({ timeout: 5000 });

    const ratingItem = ratingSubmenu.getByRole("menuitem").first();
    await expect(ratingItem).toBeVisible({ timeout: 5000 });
    await ratingItem.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error("Rating menu item was not an HTMLElement");
      }
      element.click();
    });

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /rated/i }),
    ).toBeVisible({ timeout: 5000 });
  });
});
