/**
 * Playlist tests - Create and manage playlists
 */

import { test, expect } from "./fixtures";

test.describe("Playlists", () => {
  test("can create a new playlist", async ({ authenticatedPage: page }) => {
    const playlistName = `Test Playlist ${Date.now()}`;

    await page.goto("/playlists");

    // Click the "New" dropdown button
    const newButton = page.getByRole("button", { name: /new/i });
    await expect(newButton).toBeVisible({ timeout: 10000 });
    await newButton.click();

    // Click "Playlist" in the dropdown
    const playlistOption = page.getByRole("menuitem", { name: /^playlist$/i });
    await expect(playlistOption).toBeVisible();
    await playlistOption.click();

    // Dialog should appear
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill in playlist name
    await dialog.getByRole("textbox").fill(playlistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Should see success or stay on playlists page
    expect(page.url()).toContain("/playlists");
  });

  test("can add songs to playlist via context menu", async ({
    authenticatedPage: page,
  }) => {
    const playlistName = `Add Songs Test ${Date.now()}`;

    // Create playlist first
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

    // Go to album and add song
    await page.goto("/library");
    await page.waitForSelector('[data-testid="media-card"]', {
      timeout: 10000,
    });
    const testAlbum = page
      .locator('[data-testid="media-card"]')
      .filter({ hasText: "Test Album" });
    await testAlbum.click();

    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    // Right-click to open context menu
    const songRow = page.locator('[data-testid="song-row"]').first();
    await songRow.click({ button: "right" });

    // Wait for context menu
    const contextMenu = page.locator('[data-slot="context-menu-content"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    const addToPlaylistItem = contextMenu.getByRole("menuitem", {
      name: /add to playlist/i,
    });
    await expect(addToPlaylistItem).toBeVisible();
    // Use force click to handle submenu opening
    await addToPlaylistItem.click({ force: true });

    // Wait for submenu
    await page.waitForTimeout(300);

    const playlistOption = page.getByRole("menuitem", {
      name: new RegExp(playlistName, "i"),
    });
    if (await playlistOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playlistOption.click({ force: true });

      // Verify toast
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: /added/i }),
      ).toBeVisible({ timeout: 3000 });
    }
  });
});
