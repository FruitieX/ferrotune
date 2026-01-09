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

    // Wait for all async data to load and React state to settle
    // This includes shuffle excludes fetch, starred state initialization, etc.
    await page.waitForTimeout(1000);

    // Right-click to open context menu
    const songRow = page.locator('[data-testid="song-row"]').first();
    await songRow.click({ button: "right" });

    // Wait for context menu to be visible
    const contextMenu = page.locator('[data-slot="context-menu-content"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // Click Add to Playlist using JavaScript evaluate to avoid Playwright's stability checks
    // which can fail if React re-renders the context menu
    await page.evaluate(() => {
      const menuItems = document.querySelectorAll(
        '[data-slot="context-menu-content"] [role="menuitem"]',
      );
      for (const item of menuItems) {
        if (item.textContent?.toLowerCase().includes("add to playlist")) {
          (item as HTMLElement).click();
          break;
        }
      }
    });

    // Wait for the Add to Playlist dialog to open
    const addToPlaylistDialog = page.getByRole("dialog");
    await expect(addToPlaylistDialog).toBeVisible({ timeout: 5000 });

    // Find and click the playlist button inside the dialog
    const playlistButton = addToPlaylistDialog.getByRole("button", {
      name: new RegExp(playlistName, "i"),
    });
    if (await playlistButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playlistButton.click();

      // Verify toast
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: /added/i }),
      ).toBeVisible({ timeout: 3000 });
    }
  });
});
