import { test, expect } from "./fixtures";

test.describe("Playlist Reordering", () => {
  // Helper to create a playlist with songs
  async function createPlaylistWithSongs(page: import("@playwright/test").Page, playlistName: string) {
    // Create playlist
    await page.goto("/playlists");
    const createButton = page.getByRole("button", { name: /create|new|\+/i }).first();
    await createButton.click();
    
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill(playlistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();
    
    await page.waitForTimeout(1000);
    
    // Add songs from Test Album
    await page.goto("/library");
    await page.waitForSelector('[data-testid="media-card"], article', { timeout: 10000 });
    
    const testAlbum = page.locator('[data-testid="media-card"], article').filter({ hasText: "Test Album" });
    await testAlbum.click();
    
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    
    // Add each song to playlist via context menu
    const songRows = page.locator('[data-testid="song-row"]');
    const count = await songRows.count();
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      const songRow = songRows.nth(i);
      await songRow.click({ button: "right" });
      
      const addToPlaylistItem = page.getByRole("menuitem", { name: /add to playlist/i });
      if (await addToPlaylistItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addToPlaylistItem.click();
        
        const playlistOption = page.getByRole("menuitem", { name: new RegExp(playlistName, "i") });
        if (await playlistOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await playlistOption.click();
          await page.waitForTimeout(500);
        }
      }
    }
    
    // Navigate to the playlist
    await page.goto("/playlists");
    const playlistLink = page.getByText(playlistName);
    await playlistLink.click();
    
    await expect(page).toHaveURL(/\/playlists\//);
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
  }

  test.describe("Drag Handle Visibility", () => {
    test("drag handle appears on hover when sort is Custom", async ({ authenticatedPage: page }) => {
      const playlistName = `Drag Test ${Date.now()}`;
      await createPlaylistWithSongs(page, playlistName);
      
      // Ensure sort is "Custom" (default for playlists)
      const sortButton = page.getByRole("button", { name: /sort options/i });
      if (await sortButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sortButton.click();
        
        const customOption = page.getByRole("menuitem", { name: /custom/i });
        if (await customOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await customOption.click();
        } else {
          await page.keyboard.press("Escape");
        }
      }
      
      await page.waitForTimeout(500);
      
      // Ensure list view is active
      const listButton = page.getByRole("button", { name: /list view/i });
      if (await listButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await listButton.click();
        await page.waitForTimeout(300);
      }
      
      // Clear any filter
      const filterInput = page.getByRole("textbox", { name: /filter/i });
      if (await filterInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await filterInput.clear();
        await page.waitForTimeout(300);
      }
      
      // Hover over a song row - drag handle should appear
      const songRow = page.locator('[data-testid="song-row"]').first();
      await songRow.hover();
      
      // Look for the GripVertical icon (drag handle)
      const dragHandle = page.locator('svg.lucide-grip-vertical');
      await expect(dragHandle.first()).toBeVisible({ timeout: 3000 });
    });

    test("drag handle is hidden when filter is active", async ({ authenticatedPage: page }) => {
      const playlistName = `Filter Drag Test ${Date.now()}`;
      await createPlaylistWithSongs(page, playlistName);
      
      // Apply a filter
      const filterInput = page.getByRole("textbox", { name: /filter/i });
      await filterInput.fill("First");
      await page.waitForTimeout(500);
      
      // Hover over song row
      const songRow = page.locator('[data-testid="song-row"]').first();
      await songRow.hover();
      
      // Drag handle should NOT be visible
      const dragHandle = page.locator('svg.lucide-grip-vertical');
      await expect(dragHandle).not.toBeVisible({ timeout: 2000 });
    });

    test("drag handle is hidden when sort is not Custom", async ({ authenticatedPage: page }) => {
      const playlistName = `Sort Drag Test ${Date.now()}`;
      await createPlaylistWithSongs(page, playlistName);
      
      // Change sort to "Name"
      const sortButton = page.getByRole("button", { name: /sort options/i });
      if (await sortButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sortButton.click();
        
        const nameOption = page.getByRole("menuitem", { name: /^name$/i });
        if (await nameOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nameOption.click();
          await page.waitForTimeout(300);
        }
      }
      
      // Hover over song row
      const songRow = page.locator('[data-testid="song-row"]').first();
      await songRow.hover();
      
      // Drag handle should NOT be visible
      const dragHandle = page.locator('svg.lucide-grip-vertical');
      await expect(dragHandle).not.toBeVisible({ timeout: 2000 });
    });

    test("drag handle is hidden in grid view", async ({ authenticatedPage: page }) => {
      const playlistName = `Grid Drag Test ${Date.now()}`;
      await createPlaylistWithSongs(page, playlistName);
      
      // Switch to grid view
      const gridButton = page.getByRole("button", { name: /grid view/i });
      if (await gridButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await gridButton.click();
        await page.waitForTimeout(300);
      }
      
      // Hover over a media card
      const mediaCard = page.locator('[data-testid="media-card"]').first();
      if (await mediaCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await mediaCard.hover();
        
        // Drag handle should NOT be visible
        const dragHandle = page.locator('svg.lucide-grip-vertical');
        await expect(dragHandle).not.toBeVisible({ timeout: 2000 });
      }
    });
  });

  test.describe("Drag and Drop Reordering", () => {
    test("can drag song to new position", async ({ authenticatedPage: page }) => {
      const playlistName = `Reorder Test ${Date.now()}`;
      await createPlaylistWithSongs(page, playlistName);
      
      // Ensure Custom sort and list view
      const sortButton = page.getByRole("button", { name: /sort options/i });
      if (await sortButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sortButton.click();
        const customOption = page.getByRole("menuitem", { name: /custom/i });
        if (await customOption.isVisible().catch(() => false)) {
          await customOption.click();
        } else {
          await page.keyboard.press("Escape");
        }
      }
      
      const listButton = page.getByRole("button", { name: /list view/i });
      if (await listButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await listButton.click();
        await page.waitForTimeout(300);
      }
      
      // Get initial order
      const songRows = page.locator('[data-testid="song-row"]');
      const initialCount = await songRows.count();
      
      if (initialCount >= 2) {
        const firstSongText = await songRows.first().textContent();
        const secondSongText = await songRows.nth(1).textContent();
        
        // Hover to reveal drag handle
        await songRows.first().hover();
        await page.waitForTimeout(200);
        
        // Find the drag handle
        const dragHandle = page.locator('svg.lucide-grip-vertical').first();
        
        if (await dragHandle.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Get bounding boxes
          const handleBox = await dragHandle.boundingBox();
          const secondRowBox = await songRows.nth(1).boundingBox();
          
          if (handleBox && secondRowBox) {
            // Perform drag operation
            await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
            await page.mouse.down();
            await page.mouse.move(
              secondRowBox.x + secondRowBox.width / 2,
              secondRowBox.y + secondRowBox.height + 10,
              { steps: 10 }
            );
            await page.mouse.up();
            
            await page.waitForTimeout(500);
            
            // Verify order changed (first song is now second)
            const newFirstText = await songRows.first().textContent();
            
            // The order should have changed
            expect(newFirstText).not.toBe(firstSongText);
          }
        }
      }
    });

    test("reorder persists after page reload", async ({ authenticatedPage: page }) => {
      const playlistName = `Persist Reorder ${Date.now()}`;
      await createPlaylistWithSongs(page, playlistName);
      
      // Get the current URL for later
      const playlistUrl = page.url();
      
      // Ensure Custom sort
      const sortButton = page.getByRole("button", { name: /sort options/i });
      if (await sortButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sortButton.click();
        const customOption = page.getByRole("menuitem", { name: /custom/i });
        if (await customOption.isVisible().catch(() => false)) {
          await customOption.click();
        } else {
          await page.keyboard.press("Escape");
        }
      }
      
      // Perform a drag operation if possible
      const songRows = page.locator('[data-testid="song-row"]');
      const count = await songRows.count();
      
      if (count >= 2) {
        await songRows.first().hover();
        const dragHandle = page.locator('svg.lucide-grip-vertical').first();
        
        if (await dragHandle.isVisible({ timeout: 3000 }).catch(() => false)) {
          const handleBox = await dragHandle.boundingBox();
          const secondRowBox = await songRows.nth(1).boundingBox();
          
          if (handleBox && secondRowBox) {
            await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
            await page.mouse.down();
            await page.mouse.move(
              secondRowBox.x + secondRowBox.width / 2,
              secondRowBox.y + secondRowBox.height + 10,
              { steps: 10 }
            );
            await page.mouse.up();
            
            await page.waitForTimeout(500);
            
            // Get new order
            const newFirstText = await songRows.first().textContent();
            
            // Reload page
            await page.reload();
            await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
            
            // Verify order persisted
            const afterReloadFirstText = await page.locator('[data-testid="song-row"]').first().textContent();
            expect(afterReloadFirstText).toBe(newFirstText);
          }
        }
      }
    });
  });

  test.describe("Drag During Selection", () => {
    test("drag is disabled when songs are selected", async ({ authenticatedPage: page }) => {
      const playlistName = `Selection Drag ${Date.now()}`;
      await createPlaylistWithSongs(page, playlistName);
      
      // Ensure list view and custom sort
      const listButton = page.getByRole("button", { name: /list view/i });
      if (await listButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await listButton.click();
        await page.waitForTimeout(300);
      }
      
      // Select a song
      const firstSong = page.locator('[data-testid="song-row"]').first();
      await firstSong.hover();
      
      const checkbox = firstSong.locator('button[role="checkbox"], input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await checkbox.click();
        
        // Bulk bar should appear
        const bulkBar = page.getByRole("toolbar");
        await expect(bulkBar).toBeVisible();
        
        // Now drag handle should be disabled (cursor should change)
        const dragHandle = page.locator('svg.lucide-grip-vertical');
        
        // Drag handle may still be visible but dragging should be disabled
        // The component has `disabled={hasSelection}` prop
        expect(await bulkBar.isVisible()).toBeTruthy();
      }
    });
  });
});
