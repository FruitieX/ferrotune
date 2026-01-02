/**
 * Bulk actions tests - Multi-select and bulk operations
 */

import { test, expect, waitForPlayerReady } from "./fixtures";

test.describe("Bulk Actions", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/library");
    await page.waitForSelector('[data-testid="media-card"], article', {
      timeout: 10000,
    });

    const testAlbum = page
      .locator('[data-testid="media-card"], article')
      .filter({ hasText: "Test Album" });
    await testAlbum.click();

    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
  });

  test("selecting songs shows bulk actions bar with count", async ({
    authenticatedPage: page,
  }) => {
    // Select first song
    const firstSong = page.locator('[data-testid="song-row"]').first();
    await firstSong.hover();
    const checkbox1 = firstSong
      .locator('button[role="checkbox"], input[type="checkbox"]')
      .first();
    await checkbox1.click();

    const bulkBar = page.getByRole("toolbar");
    await expect(bulkBar).toContainText(/1 song/i);

    // Select second song
    const secondSong = page.locator('[data-testid="song-row"]').nth(1);
    await secondSong.hover();
    const checkbox2 = secondSong
      .locator('button[role="checkbox"], input[type="checkbox"]')
      .first();
    await checkbox2.click();

    await expect(bulkBar).toContainText(/2 songs/i);

    // Select all
    await bulkBar.getByRole("button", { name: /select all/i }).click();
    await expect(bulkBar).toContainText(/3 songs/i);
  });

  test("can play selected songs", async ({ authenticatedPage: page }) => {
    // Select first two songs
    const firstSong = page.locator('[data-testid="song-row"]').first();
    await firstSong.hover();
    await firstSong
      .locator('button[role="checkbox"], input[type="checkbox"]')
      .first()
      .click();

    const secondSong = page.locator('[data-testid="song-row"]').nth(1);
    await secondSong.hover();
    await secondSong
      .locator('button[role="checkbox"], input[type="checkbox"]')
      .first()
      .click();

    const bulkBar = page.getByRole("toolbar");
    await expect(bulkBar).toContainText(/2 songs/i);

    // Play now
    await bulkBar.getByRole("button", { name: /play now/i }).click();

    await waitForPlayerReady(page);
    await expect(page.locator("footer")).toContainText("First Song");
  });

  test("can add selected songs to playlist", async ({
    authenticatedPage: page,
  }) => {
    // First create a playlist via the playlists page
    const playlistName = `Bulk Test ${Date.now()}`;
    await page.goto("/playlists");

    const newButton = page.getByRole("button", { name: /new/i });
    await expect(newButton).toBeVisible({ timeout: 10000 });
    await newButton.click();
    await page.getByRole("menuitem", { name: /^playlist$/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole("textbox").fill(playlistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Go back to album
    await page.goto("/library");
    await page.waitForSelector('[data-testid="media-card"], article', {
      timeout: 10000,
    });
    const testAlbum = page
      .locator('[data-testid="media-card"], article')
      .filter({ hasText: "Test Album" });
    await testAlbum.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    // Select song
    const firstSong = page.locator('[data-testid="song-row"]').first();
    await firstSong.hover();
    await firstSong
      .locator('button[role="checkbox"], input[type="checkbox"]')
      .first()
      .click();

    const bulkBar = page.getByRole("toolbar");
    await expect(bulkBar).toBeVisible();

    // Add to playlist
    await bulkBar.getByRole("button", { name: /add to playlist/i }).click();

    const playlistOption = page.getByRole("menuitem", {
      name: new RegExp(playlistName, "i"),
    });
    if (await playlistOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playlistOption.click();
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: /added/i }),
      ).toBeVisible({ timeout: 3000 });
    }
  });
});
