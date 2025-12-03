import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

/**
 * Helper to wait for context menu to appear and get it
 */
async function openContextMenu(page: import("@playwright/test").Page, element: import("@playwright/test").Locator) {
  await element.click({ button: "right" });
  const contextMenu = page.locator('[data-slot="context-menu-content"]');
  await expect(contextMenu).toBeVisible({ timeout: 5000 });
  return contextMenu;
}

/**
 * Helper to wait for dropdown menu to appear
 */
async function openDropdownMenu(page: import("@playwright/test").Page, trigger: import("@playwright/test").Locator) {
  await trigger.click();
  const dropdownMenu = page.locator('[data-slot="dropdown-menu-content"]');
  await expect(dropdownMenu).toBeVisible({ timeout: 5000 });
  return dropdownMenu;
}

test.describe("Context Menus", () => {
  test.describe("Song Context Menu", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      // Navigate to songs view in list mode
      await page.goto("/library/songs");
      await page.waitForLoadState("networkidle");
      
      // Switch to list view to get song rows
      const listViewButton = page.getByRole("button", { name: /list view/i });
      await listViewButton.click();
      
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("right-click on song opens context menu", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      const contextMenu = await openContextMenu(page, songRow);
      
      // Check that Play menu item exists
      await expect(contextMenu.locator('text="Play"').first()).toBeVisible();
    });

    test("context menu has expected items", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      const contextMenu = await openContextMenu(page, songRow);
      
      // Check for expected menu items using text locators for reliability
      await expect(contextMenu.locator('text="Play"').first()).toBeVisible();
      await expect(contextMenu.locator('text="Play Next"')).toBeVisible();
      await expect(contextMenu.locator('text="Add to Queue"')).toBeVisible();
      await expect(contextMenu.locator('text="Add to Playlist"')).toBeVisible();
      // One of Add to Favorites or Remove from Favorites should be visible
      const hasFavorites = await contextMenu.locator('text=/Add to Favorites|Remove from Favorites/').isVisible();
      expect(hasFavorites).toBeTruthy();
    });

    test("can play song from context menu", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      const contextMenu = await openContextMenu(page, songRow);
      
      await contextMenu.locator('text="Play"').first().click();
      
      await waitForPlayerReady(page);
      // Player bar should show a song is playing
      await expect(page.locator('[data-testid="player-bar"]')).toBeVisible();
    });

    test("can add song to queue via Play Next", async ({ authenticatedPage: page }) => {
      // First start playback
      await playFirstSong(page);
      await waitForPlayerReady(page);
      
      // Go back to songs list view
      await page.goto("/library/songs");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /list view/i }).click();
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Right-click and add to queue
      const songRow = page.locator('[data-testid="song-row"]').nth(1); // Second song
      const contextMenu = await openContextMenu(page, songRow);
      
      await contextMenu.locator('text="Play Next"').click();
      
      // Verify toast
      await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 3000 });
    });

    test("can add song to queue via Add to Queue", async ({ authenticatedPage: page }) => {
      // First start playback
      await playFirstSong(page);
      await waitForPlayerReady(page);
      
      // Go back to songs list view
      await page.goto("/library/songs");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /list view/i }).click();
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Right-click and add to queue
      const songRow = page.locator('[data-testid="song-row"]').nth(1); // Second song
      const contextMenu = await openContextMenu(page, songRow);
      
      await contextMenu.locator('text="Add to Queue"').click();
      
      // Verify toast
      await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 3000 });
    });

    test("can toggle favorites from context menu", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      const contextMenu = await openContextMenu(page, songRow);
      
      // Click whichever favorites option is visible
      const addFavorite = contextMenu.locator('text="Add to Favorites"');
      const removeFavorite = contextMenu.locator('text="Remove from Favorites"');
      
      if (await addFavorite.isVisible()) {
        await addFavorite.click();
      } else {
        await removeFavorite.click();
      }
      
      // Verify toast
      await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 3000 });
    });

    test("can navigate to artist from context menu", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      const contextMenu = await openContextMenu(page, songRow);
      
      await contextMenu.locator('text="Go to Artist"').click();
      
      await expect(page).toHaveURL(/\/library\/artists\/details/);
    });

    test("can navigate to album from context menu", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      const contextMenu = await openContextMenu(page, songRow);
      
      await contextMenu.locator('text="Go to Album"').click();
      
      await expect(page).toHaveURL(/\/library\/albums\/details/);
    });

    test("can open rating submenu", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      const contextMenu = await openContextMenu(page, songRow);
      
      // Click on Rate to open submenu
      await contextMenu.locator('text=/^Rate/').click();
      
      // Rating submenu should appear with star options
      const ratingSubmenu = page.locator('[data-slot="context-menu-sub-content"]');
      await expect(ratingSubmenu).toBeVisible({ timeout: 2000 });
    });

    test("context menu closes on Escape", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      const contextMenu = await openContextMenu(page, songRow);
      
      await page.keyboard.press("Escape");
      
      await expect(contextMenu).not.toBeVisible();
    });
  });

  test.describe("Dropdown Menu (More Options)", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.goto("/library/songs");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /list view/i }).click();
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("can open dropdown menu via more options button", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      await songRow.hover();
      
      const moreButton = songRow.getByRole("button", { name: /more options/i });
      await expect(moreButton).toBeVisible({ timeout: 2000 });
      
      const dropdownMenu = await openDropdownMenu(page, moreButton);
      
      // Check that Play menu item exists
      await expect(dropdownMenu.locator('text="Play"').first()).toBeVisible();
    });

    test("dropdown menu has same items as context menu", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      await songRow.hover();
      
      const moreButton = songRow.getByRole("button", { name: /more options/i });
      const dropdownMenu = await openDropdownMenu(page, moreButton);
      
      // Check for expected menu items
      await expect(dropdownMenu.locator('text="Play"').first()).toBeVisible();
      await expect(dropdownMenu.locator('text="Play Next"')).toBeVisible();
      await expect(dropdownMenu.locator('text="Add to Queue"')).toBeVisible();
    });
  });

  test.describe("Album Card Context Menu", () => {
    test("right-click on album card opens context menu", async ({ authenticatedPage: page }) => {
      await page.goto("/library/albums");
      await page.waitForSelector('[data-testid="media-card"]', { timeout: 10000 });
      
      const albumCard = page.locator('[data-testid="media-card"]').first();
      const contextMenu = await openContextMenu(page, albumCard);
      
      // Check for play menu item
      await expect(contextMenu.locator('text=/^Play$/')).toBeVisible();
    });

    test("album context menu has play and shuffle options", async ({ authenticatedPage: page }) => {
      await page.goto("/library/albums");
      await page.waitForSelector('[data-testid="media-card"]', { timeout: 10000 });
      
      const albumCard = page.locator('[data-testid="media-card"]').first();
      const contextMenu = await openContextMenu(page, albumCard);
      
      await expect(contextMenu.locator('text=/^Play$/')).toBeVisible();
      await expect(contextMenu.locator('text=/Shuffle/i')).toBeVisible();
    });
  });

  test.describe("Artist Card Context Menu", () => {
    test("right-click on artist card opens context menu", async ({ authenticatedPage: page }) => {
      await page.goto("/library/artists");
      await page.waitForSelector('[data-testid="media-card"]', { timeout: 10000 });
      
      const artistCard = page.locator('[data-testid="media-card"]').first();
      const contextMenu = await openContextMenu(page, artistCard);
      
      // Artist context menu has Play and Shuffle
      await expect(contextMenu.locator('text=/^Play$/')).toBeVisible();
    });

    test("artist context menu has play and shuffle options", async ({ authenticatedPage: page }) => {
      await page.goto("/library/artists");
      await page.waitForSelector('[data-testid="media-card"]', { timeout: 10000 });
      
      const artistCard = page.locator('[data-testid="media-card"]').first();
      const contextMenu = await openContextMenu(page, artistCard);
      
      await expect(contextMenu.locator('text=/^Play$/')).toBeVisible();
      await expect(contextMenu.locator('text=/^Shuffle$/')).toBeVisible();
    });
  });
});
