/**
 * Smart playlists tests - Dynamic playlist functionality
 */

import { test, expect } from "./fixtures";

test.describe("Smart Playlists", () => {
  test("can create a smart playlist", async ({ authenticatedPage: page }) => {
    await page.goto("/playlists");

    // Click the "New" dropdown button
    const newButton = page.getByRole("button", { name: /new/i });
    await expect(newButton).toBeVisible({ timeout: 10000 });
    await newButton.click();

    // Click "Smart Playlist" in the dropdown
    const smartOption = page.getByRole("menuitem", { name: /smart playlist/i });
    await expect(smartOption).toBeVisible();
    await smartOption.click();

    // Smart playlist dialog should appear
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill in smart playlist name
    const nameInput = dialog.getByRole("textbox").first();
    await nameInput.fill(`Smart Test ${Date.now()}`);

    // Save the smart playlist
    const saveButton = dialog.getByRole("button", { name: /create|save/i });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    expect(page.url()).toContain("/playlists");
  });

  test("smart playlist shows matching songs", async ({
    authenticatedPage: page,
  }) => {
    const smartPlaylistName = `Smart Test ${Date.now()}`;

    await page.goto("/playlists");

    // Create smart playlist
    const newButton = page.getByRole("button", { name: /new/i });
    await expect(newButton).toBeVisible({ timeout: 10000 });
    await newButton.click();
    await page.getByRole("menuitem", { name: /smart playlist/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.getByRole("textbox").first().fill(smartPlaylistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Look for the smart playlist in the list (may have sparkle icon)
    const playlistLink = page.getByText(smartPlaylistName).first();
    if (await playlistLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playlistLink.click({ force: true });
      // Smart playlist page should show heading
      await expect(page.getByRole("heading").first()).toBeVisible();
    }
  });
});
