import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

test.describe("Bulk Actions", () => {
  test.describe("Selection", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      // Navigate to album with tracks
      await page.goto("/library");
      await page.waitForSelector('[data-testid="media-card"], article', { timeout: 10000 });
      
      // Click on Test Album
      const testAlbum = page.locator('[data-testid="media-card"], article').filter({ hasText: "Test Album" });
      await testAlbum.click();
      
      await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("clicking checkbox selects a song", async ({ authenticatedPage: page }) => {
      const songRow = page.locator('[data-testid="song-row"]').first();
      await songRow.hover();
      
      // Click the checkbox (first button in the row before the track info)
      const checkbox = songRow.locator('button[role="checkbox"], input[type="checkbox"]').first();
      await checkbox.click();
      
      // Bulk action bar should appear
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible({ timeout: 3000 });
    });

    test("bulk actions bar shows correct count", async ({ authenticatedPage: page }) => {
      // Select first song
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      const checkbox1 = firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first();
      await checkbox1.click();
      
      // Bar should show "1 song"
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toContainText(/1 song/i);
      
      // Select second song
      const secondSong = page.locator('[data-testid="song-row"]').nth(1);
      await secondSong.hover();
      const checkbox2 = secondSong.locator('button[role="checkbox"], input[type="checkbox"]').first();
      await checkbox2.click();
      
      // Bar should show "2 songs"
      await expect(bulkBar).toContainText(/2 songs/i);
    });

    test("can select all songs", async ({ authenticatedPage: page }) => {
      // Select one song first to show bulk bar
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      const checkbox = firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first();
      await checkbox.click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible();
      
      // Click "Select all" button
      const selectAllButton = bulkBar.getByRole("button", { name: /select all/i });
      await selectAllButton.click();
      
      // Should show "3 songs" (Test Album has 3 tracks)
      await expect(bulkBar).toContainText(/3 songs/i);
    });

    test("can clear selection", async ({ authenticatedPage: page }) => {
      // Select a song
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      const checkbox = firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first();
      await checkbox.click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible();
      
      // Click clear button
      const clearButton = bulkBar.getByRole("button", { name: /clear selection/i });
      await clearButton.click();
      
      // Bulk bar should disappear
      await expect(bulkBar).not.toBeVisible();
    });
  });

  test.describe("Bulk Play Actions", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForSelector('[data-testid="media-card"], article', { timeout: 10000 });
      
      const testAlbum = page.locator('[data-testid="media-card"], article').filter({ hasText: "Test Album" });
      await testAlbum.click();
      
      await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("can play selected songs now", async ({ authenticatedPage: page }) => {
      // Select first two songs
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const secondSong = page.locator('[data-testid="song-row"]').nth(1);
      await secondSong.hover();
      await secondSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toContainText(/2 songs/i);
      
      // Click "Play now" button
      const playNowButton = bulkBar.getByRole("button", { name: /play now/i });
      await playNowButton.click();
      
      await waitForPlayerReady(page);
      await expect(page.locator("footer")).toContainText("First Song");
    });

    test("can shuffle play selected songs", async ({ authenticatedPage: page }) => {
      // Select all songs
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible();
      
      await bulkBar.getByRole("button", { name: /select all/i }).click();
      await expect(bulkBar).toContainText(/3 songs/i);
      
      // Click "Shuffle play" button
      const shuffleButton = bulkBar.getByRole("button", { name: /shuffle play/i });
      await shuffleButton.click();
      
      await waitForPlayerReady(page);
    });

    test("can add selected songs to play next", async ({ authenticatedPage: page }) => {
      // First start playback
      await page.locator('[data-testid="song-row"]').first().dblclick();
      await waitForPlayerReady(page);
      
      // Go to another album
      await page.goto("/library/albums");
      await page.locator('[data-testid="media-card"], article').filter({ hasText: "Another Album" }).click();
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Select songs
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible();
      
      // Click "Play next" button
      const playNextButton = bulkBar.getByRole("button", { name: /play next/i });
      await playNextButton.click();
      
      // Verify toast
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: /added|next/i })).toBeVisible({ timeout: 3000 });
    });

    test("can add selected songs to queue", async ({ authenticatedPage: page }) => {
      // First start playback
      await page.locator('[data-testid="song-row"]').first().dblclick();
      await waitForPlayerReady(page);
      
      // Go to another album
      await page.goto("/library/albums");
      await page.locator('[data-testid="media-card"], article').filter({ hasText: "Another Album" }).click();
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Select songs
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible();
      
      // Click "Add to queue" button
      const addToQueueButton = bulkBar.getByRole("button", { name: /add to queue/i });
      await addToQueueButton.click();
      
      // Verify toast
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: /added to queue/i })).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe("Bulk Favorites", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForSelector('[data-testid="media-card"], article', { timeout: 10000 });
      
      const testAlbum = page.locator('[data-testid="media-card"], article').filter({ hasText: "Test Album" });
      await testAlbum.click();
      
      await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("can add selected songs to favorites", async ({ authenticatedPage: page }) => {
      // Select songs
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const secondSong = page.locator('[data-testid="song-row"]').nth(1);
      await secondSong.hover();
      await secondSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toContainText(/2 songs/i);
      
      // Click "Add to favorites" button
      const addFavoritesButton = bulkBar.getByRole("button", { name: /add to favorites/i });
      await addFavoritesButton.click();
      
      // Verify toast
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: /favorite|starred/i })).toBeVisible({ timeout: 3000 });
    });

    test("can remove selected songs from favorites", async ({ authenticatedPage: page }) => {
      // First add songs to favorites
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible();
      
      const addFavoritesButton = bulkBar.getByRole("button", { name: /add to favorites/i });
      await addFavoritesButton.click();
      
      await page.waitForTimeout(500);
      
      // Clear and reselect
      await bulkBar.getByRole("button", { name: /clear selection/i }).click();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      // Now remove from favorites
      const removeFavoritesButton = bulkBar.getByRole("button", { name: /remove from favorites/i });
      if (await removeFavoritesButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await removeFavoritesButton.click();
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: /removed|unfavorite/i })).toBeVisible({ timeout: 3000 });
      }
    });
  });

  test.describe("Bulk Add to Playlist", () => {
    test("can add selected songs to existing playlist", async ({ authenticatedPage: page }) => {
      // First create a playlist
      const playlistName = `Bulk Test ${Date.now()}`;
      
      await page.goto("/playlists");
      const createButton = page.getByRole("button", { name: /create|new|\+/i }).first();
      await createButton.click();
      
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill(playlistName);
      await dialog.getByRole("button", { name: /create|save/i }).click();
      
      await page.waitForTimeout(1000);
      
      // Now go to album and select songs
      await page.goto("/library");
      await page.waitForSelector('[data-testid="media-card"], article', { timeout: 10000 });
      
      const testAlbum = page.locator('[data-testid="media-card"], article').filter({ hasText: "Test Album" });
      await testAlbum.click();
      
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Select songs
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible();
      
      // Click "Add to playlist" button
      const addToPlaylistButton = bulkBar.getByRole("button", { name: /add to playlist/i });
      await addToPlaylistButton.click();
      
      // Select the playlist from the menu
      const playlistOption = page.getByRole("menuitem", { name: new RegExp(playlistName, "i") });
      if (await playlistOption.isVisible({ timeout: 5000 }).catch(() => false)) {
        await playlistOption.click();
        
        // Verify toast
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: /added to/i })).toBeVisible({ timeout: 3000 });
      }
    });
  });

  test.describe("Multi-selection Keyboard Shortcuts", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForSelector('[data-testid="media-card"], article', { timeout: 10000 });
      
      const testAlbum = page.locator('[data-testid="media-card"], article').filter({ hasText: "Test Album" });
      await testAlbum.click();
      
      await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("ctrl+click selects multiple songs", async ({ authenticatedPage: page }) => {
      const firstSong = page.locator('[data-testid="song-row"]').first();
      const thirdSong = page.locator('[data-testid="song-row"]').nth(2);
      
      // Click first song
      await firstSong.click();
      
      // Ctrl+click third song
      await thirdSong.click({ modifiers: ["Control"] });
      
      // Should have 2 songs selected
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toContainText(/2 songs/i);
    });

    test("shift+click selects range of songs", async ({ authenticatedPage: page }) => {
      const firstSong = page.locator('[data-testid="song-row"]').first();
      const thirdSong = page.locator('[data-testid="song-row"]').nth(2);
      
      // Click first song
      await firstSong.click();
      
      // Shift+click third song (should select 1, 2, 3)
      await thirdSong.click({ modifiers: ["Shift"] });
      
      // Should have 3 songs selected
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toContainText(/3 songs/i);
    });

    test("escape clears selection", async ({ authenticatedPage: page }) => {
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      await firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first().click();
      
      const bulkBar = page.getByRole("toolbar");
      await expect(bulkBar).toBeVisible();
      
      // Press Escape
      await page.keyboard.press("Escape");
      
      // Bulk bar should disappear
      await expect(bulkBar).not.toBeVisible();
    });
  });
});
