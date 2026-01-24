/**
 * Library browsing tests - Navigation and content display
 */

import { test, expect } from "./fixtures";

test.describe("Library Browsing", () => {
  test("library page displays tabs and can switch between them", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/albums");

    // Verify all tabs are visible
    const libraryNav = page.getByLabel("Library sections");
    await expect(
      libraryNav.getByRole("link", { name: "Albums" }),
    ).toBeVisible();
    await expect(
      libraryNav.getByRole("link", { name: "Artists" }),
    ).toBeVisible();
    await expect(libraryNav.getByRole("link", { name: "Songs" })).toBeVisible();
    await expect(
      libraryNav.getByRole("link", { name: "Genres" }),
    ).toBeVisible();

    // Switch between tabs
    await libraryNav.getByRole("link", { name: "Artists" }).click();
    await expect(page).toHaveURL("/library/artists");

    await libraryNav.getByRole("link", { name: "Songs" }).click();
    await expect(page).toHaveURL("/library/songs");

    await libraryNav.getByRole("link", { name: "Genres" }).click();
    await expect(page).toHaveURL("/library/genres");
  });

  test("can navigate to album and artist detail pages", async ({
    authenticatedPage: page,
  }) => {
    // Navigate to album detail using grid view
    await page.goto("/library/albums");

    // Switch to grid view
    const gridViewButton = page.getByRole("button", { name: /grid view/i });
    await expect(gridViewButton).toBeVisible({ timeout: 10000 });
    await gridViewButton.click();

    // Wait for media cards to load
    const albumCard = page.locator('[data-testid="media-card"]').first();
    await expect(albumCard).toBeVisible({ timeout: 10000 });
    await albumCard.click();

    await expect(page).toHaveURL(/\/library\/albums\/details/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Navigate to artist detail using grid view
    await page.goto("/library/artists");

    // Switch to grid view
    const artistGridViewButton = page.getByRole("button", {
      name: /grid view/i,
    });
    await expect(artistGridViewButton).toBeVisible({ timeout: 10000 });
    await artistGridViewButton.click();

    // Wait for media cards to load
    const artistCard = page.locator('[data-testid="media-card"]').first();
    await expect(artistCard).toBeVisible({ timeout: 10000 });
    await artistCard.click();

    await expect(page).toHaveURL(/\/library\/artists\/details/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("sidebar navigation works", async ({ authenticatedPage: page }) => {
    await page.goto("/");

    // Navigate to library via sidebar
    const libraryLink = page.getByRole("link", { name: /library/i }).first();
    await expect(libraryLink).toBeVisible();
    await libraryLink.click();
    await expect(page).toHaveURL(/\/library/);

    // Navigate to favorites
    await page.goto("/");
    const favoritesLink = page
      .getByRole("link", { name: /favorites|liked/i })
      .first();
    await expect(favoritesLink).toBeVisible();
    await favoritesLink.click();
    await expect(page).toHaveURL("/favorites");
  });
});
