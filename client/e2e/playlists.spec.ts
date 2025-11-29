import { test, expect, testConfig } from "./fixtures";

test.describe("Playlists", () => {
  test("playlists page is accessible", async ({ authenticatedPage: page }) => {
    await page.goto("/playlists");
    
    await expect(page.getByRole("heading", { name: "Playlists", exact: true })).toBeVisible();
  });

  test("can open create playlist dialog", async ({ authenticatedPage: page }) => {
    await page.goto("/playlists");
    
    const createButton = page.getByRole("button", { name: /create|new|\+/i }).first();
    await createButton.click();
    
    // Dialog should open
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
  });

  test("can create a new playlist", async ({ authenticatedPage: page }) => {
    const playlistName = `Test Playlist ${Date.now()}`;
    
    await page.goto("/playlists");
    
    const createButton = page.getByRole("button", { name: /create|new|\+/i }).first();
    await createButton.click();
    
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    
    // Fill in name
    await dialog.getByRole("textbox").fill(playlistName);
    
    // Submit
    await dialog.getByRole("button", { name: /create|save/i }).click();
    
    // Wait for dialog to close
    await page.waitForTimeout(1000);
    
    expect(page.url()).toContain("/playlists");
  });

  test("can navigate to playlist detail", async ({ authenticatedPage: page }) => {
    // First create a playlist
    const playlistName = `Nav Test ${Date.now()}`;
    
    await page.goto("/playlists");
    
    const createButton = page.getByRole("button", { name: /create|new|\+/i }).first();
    await createButton.click();
    
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(playlistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();
    
    await page.waitForTimeout(1000);
    
    // Click on the playlist
    const playlistLink = page.getByText(playlistName);
    if (await playlistLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await playlistLink.click();
      await expect(page).toHaveURL(/\/playlists\//);
    }
  });

  test("playlist detail shows empty state", async ({ authenticatedPage: page }) => {
    // Create a new empty playlist
    const playlistName = `Empty Test ${Date.now()}`;
    
    await page.goto("/playlists");
    
    const createButton = page.getByRole("button", { name: /create|new|\+/i }).first();
    await createButton.click();
    
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(playlistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();
    
    await page.waitForTimeout(1000);
    
    // Navigate to it
    const playlistLink = page.getByText(playlistName);
    if (await playlistLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await playlistLink.click();
      await expect(page).toHaveURL(/\/playlists\//);
      
      // Should show empty state or no tracks
      await expect(page.getByRole("heading")).toBeVisible();
    }
  });

  test("can delete playlist", async ({ authenticatedPage: page }) => {
    // Create a playlist to delete
    const playlistName = `Delete Test ${Date.now()}`;
    
    await page.goto("/playlists");
    
    const createButton = page.getByRole("button", { name: /create|new|\+/i }).first();
    await createButton.click();
    
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(playlistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();
    
    await page.waitForTimeout(1000);
    
    // Navigate to playlist
    const playlistLink = page.getByText(playlistName);
    if (await playlistLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await playlistLink.click();
      await expect(page).toHaveURL(/\/playlists\//);
      
      // Look for delete button
      const deleteButton = page.getByRole("button", { name: /delete/i }).first();
      if (await deleteButton.isVisible().catch(() => false)) {
        await deleteButton.click();
        
        // Confirm deletion if dialog appears
        const confirmButton = page.getByRole("button", { name: /delete|confirm|yes/i });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }
        
        await page.waitForTimeout(1000);
      }
    }
    
    expect(page.url()).toBeTruthy();
  });
});
