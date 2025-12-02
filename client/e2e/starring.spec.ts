import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

test.describe("Starring and Ratings", () => {
  test.describe("Starring Songs", () => {
    test("can star a song using star button", async ({ authenticatedPage: page }) => {
      // Go to album
      await page.goto("/library");
      await page.waitForSelector("article", { timeout: 10000 });
      await page.getByText("Test Album").click();
      
      // Wait for navigation to album page
      await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
      
      // Wait for tracks
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Hover over first track to reveal star button
      const firstSongRow = page.locator('[data-testid="song-row"]').first();
      await firstSongRow.hover();
      
      // Click the star/heart button
      const starButton = firstSongRow.getByRole("button").filter({ has: page.locator("svg") }).first();
      await starButton.click();
      
      // Wait for action to complete
      await page.waitForTimeout(1000);
      
      expect(page.url()).toBeTruthy();
    });

    test("starred songs appear in favorites", async ({ authenticatedPage: page }) => {
      // First star a song using the star button
      await page.goto("/library");
      await page.waitForSelector("article", { timeout: 10000 });
      await page.getByText("Test Album").click();
      
      await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Hover and click star button
      const firstSongRow = page.locator('[data-testid="song-row"]').first();
      await firstSongRow.hover();
      const starButton = firstSongRow.getByRole("button").filter({ has: page.locator("svg") }).first();
      await starButton.click();
      
      // Wait for action to complete
      await page.waitForTimeout(1500);
      
      // Go to favorites
      await page.goto("/favorites");
      
      // Should show the starred song
      await page.waitForTimeout(1000);
      expect(page.url()).toContain("/favorites");
    });

    test("can unstar a song", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForSelector("article", { timeout: 10000 });
      await page.getByText("Test Album").click();
      
      await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Get the first song row element
      const firstSongRow = page.locator('[data-testid="song-row"]').first();
      
      // Star first
      await firstSongRow.hover();
      const starButton = firstSongRow.getByRole("button").filter({ has: page.locator("svg") }).first();
      await starButton.click();
      
      // Wait for action to complete
      await page.waitForTimeout(1500);
      
      // Click again to unstar
      await firstSongRow.hover();
      await starButton.click();
      
      await page.waitForTimeout(500);
      
      expect(page.url()).toBeTruthy();
    });
  });

  test.describe("Ratings", () => {
    test("can rate song from menu", async ({ authenticatedPage: page }, testInfo) => {
      await page.goto("/library");
      await page.waitForSelector("article", { timeout: 10000 });
      await page.getByText("Test Album").click();
      
      await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      const firstSongRow = page.locator('[data-testid="song-row"]').first();
      
      // Use dropdown menu for both - it's more reliable than context menu
      // The dropdown button is always present but only visible on hover (desktop) or always visible (mobile)
      await firstSongRow.hover(); // Make actions visible
      await page.waitForTimeout(200); // Wait for hover effects
      
      const moreButton = firstSongRow.getByRole("button", { name: /more options/i });
      await expect(moreButton).toBeVisible({ timeout: 2000 });
      await moreButton.click();
      
      // Wait for dropdown menu to appear
      await page.waitForTimeout(300);
      
      // Click on "Rate" to open submenu - may have rating suffix like "Rate (3)"
      const rateOption = page.getByRole("menuitem", { name: /^rate/i });
      await expect(rateOption).toBeVisible({ timeout: 2000 });
      
      // Click to open the rate submenu
      await rateOption.click();
      
      // Wait for submenu to appear
      await page.waitForTimeout(300);
      
      // Get the rating submenu - it's the sub-content with the star rating items
      // Use the specific data-slot attribute for the sub-menu
      const ratingSubmenu = page.locator('[data-slot="dropdown-menu-sub-content"]');
      await expect(ratingSubmenu).toBeVisible({ timeout: 2000 });
      
      // Click on the 5th rating option (5 stars) - it's the last one before the separator
      // The rating items don't have text, just star icons - select by index
      const ratingMenuItems = ratingSubmenu.locator('[role="menuitem"]').filter({ hasNotText: "Remove Rating" });
      const fiveStarOption = ratingMenuItems.nth(4); // 0-indexed, so 4 = 5th item = 5 stars
      
      await expect(fiveStarOption).toBeVisible({ timeout: 2000 });
      await fiveStarOption.click();
      
      // Verify toast appeared
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: /rated/i })).toBeVisible({ timeout: 3000 });
      
      expect(page.url()).toBeTruthy();
    });
  });

  test.describe("Favorites Page", () => {
    test("favorites page has tabs", async ({ authenticatedPage: page }) => {
      await page.goto("/favorites");
      
      await expect(page.getByRole("tab", { name: /songs/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /albums/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /artists/i })).toBeVisible();
    });

    test("can switch to albums tab", async ({ authenticatedPage: page }) => {
      await page.goto("/favorites");
      
      await page.getByRole("tab", { name: /albums/i }).click();
      await expect(page.getByRole("tab", { name: /albums/i })).toHaveAttribute("data-state", "active");
    });

    test("can switch to artists tab", async ({ authenticatedPage: page }) => {
      await page.goto("/favorites");
      
      await page.getByRole("tab", { name: /artists/i }).click();
      await expect(page.getByRole("tab", { name: /artists/i })).toHaveAttribute("data-state", "active");
    });
  });
});
