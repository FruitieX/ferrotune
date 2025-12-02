import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

test.describe("Playback", () => {
  // Clear queue-related state before each test to ensure clean slate
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.evaluate(() => {
      // Only clear queue-related keys, not auth credentials
      const keysToRemove = Object.keys(localStorage).filter(key => 
        key.includes('queue') || key.includes('shuffle') || key.includes('volume')
      );
      keysToRemove.forEach(key => localStorage.removeItem(key));
    });
    // Reload to apply cleared state  
    await page.reload();
    await page.waitForLoadState("networkidle");
  });

  test("player bar is visible when authenticated", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    
    // Player bar should be visible (has data-testid="player-bar")
    await expect(page.getByTestId("player-bar")).toBeVisible();
  });

  test("player bar has playback controls", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    
    // Should have play/pause button
    const playPauseButton = page.getByRole("button", { name: /play|pause/i }).first();
    await expect(playPauseButton).toBeVisible();
  });

  test("volume control is accessible", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    
    // Volume button should have aria-label
    const volumeButton = page.getByRole("button", { name: /mute|unmute/i }).first();
    await expect(volumeButton).toBeVisible();
  });

  test("can mute/unmute volume", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    
    // Find volume/mute button
    const volumeButton = page.getByRole("button", { name: /mute|unmute/i }).first();
    await expect(volumeButton).toBeVisible();
    
    // Click to toggle mute
    await volumeButton.click();
    await page.waitForTimeout(300);
    
    // Click again to unmute
    await volumeButton.click();
    await page.waitForTimeout(300);
    
    // Should still be visible
    await expect(page.getByRole("button", { name: /mute|unmute/i }).first()).toBeVisible();
  });

  test("skip buttons exist", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    
    const playerBar = page.getByTestId("player-bar");
    
    // Previous and Next buttons
    const skipNext = playerBar.getByRole("button", { name: /next/i });
    const skipPrev = playerBar.getByRole("button", { name: /previous/i });
    
    await expect(skipNext).toBeVisible();
    await expect(skipPrev).toBeVisible();
  });

  test("queue button exists", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    
    const queueButton = page.getByRole("button", { name: /queue/i });
    await expect(queueButton).toBeVisible();
  });
});

test.describe("Repeat Mode Behavior", () => {
  test("repeat one only loops track on natural end, not on next click", async ({ authenticatedPage: page }, testInfo) => {
    // Skip this test on mobile since repeat button is in a different location
    if (testInfo.project.name === "mobile-chrome") {
      test.skip();
      return;
    }
    
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    const playerBar = page.getByTestId("player-bar");
    
    // Verify First Song is playing
    await expect(playerBar).toContainText("First Song");
    
    // Enable repeat one mode (click repeat twice: off -> all -> one)
    const repeatButton = playerBar.getByRole("button", { name: /repeat/i });
    await repeatButton.click(); // off -> all
    await page.waitForTimeout(200);
    await repeatButton.click(); // all -> one
    await page.waitForTimeout(200);
    
    // Click next - should advance to Second Song (not repeat First Song)
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(500);
    
    // Should be playing Second Song, not First Song
    await expect(playerBar).toContainText("Second Song");
  });
});

test.describe("Queue End Behavior", () => {
  test("clicking next on last track shows 'Not playing' state", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    const playerBar = page.getByTestId("player-bar");
    
    // Skip to Third Song (last in queue)
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    
    // Verify we're on the last track
    await expect(playerBar).toContainText("Third Song");
    
    // Click next again - should end the queue
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(500);
    
    // Should show "Not playing" instead of track info
    await expect(playerBar).toContainText("Not playing");
  });

  test("queue panel hides 'Now Playing' section when queue ends", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    const playerBar = page.getByTestId("player-bar");
    
    // Skip to last track and end queue
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(500);
    
    // Open queue panel
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Wait for queue panel - desktop uses aside, mobile uses sheet dialog
    // Check for either one being visible (can't use .or() due to strict mode with hidden elements)
    const sidebar = page.locator('aside').filter({ hasText: /^Queue/ });
    const sheet = page.getByRole('dialog', { name: 'Queue' });
    
    await Promise.race([
      expect(sidebar).toBeVisible({ timeout: 10000 }).catch(() => {}),
      expect(sheet).toBeVisible({ timeout: 10000 }).catch(() => {}),
    ]);
    
    const queuePanel = (await sidebar.isVisible().catch(() => false)) ? sidebar : sheet;
    
    // "Now Playing" section should not be visible
    await expect(queuePanel.getByText(/now playing/i)).toBeHidden();
  });

  test("clicking play after queue ends restarts from first track", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    const playerBar = page.getByTestId("player-bar");
    
    // Skip to last track and end queue
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(500);
    
    // Verify queue ended
    await expect(playerBar).toContainText("Not playing");
    
    // Click play button
    await playerBar.getByRole("button", { name: /play/i }).click();
    await page.waitForTimeout(500);
    
    // Should restart from first track
    await expect(playerBar).toContainText("First Song");
  });

  test("track list does not show any track as active when queue ends", async ({ authenticatedPage: page }) => {
    // Navigate to Test Album
    await page.goto("/library");
    await page.waitForSelector('[data-testid="album-card"], article', { timeout: 10000 });
    
    const testAlbum = page.locator('[data-testid="album-card"], article').filter({ hasText: "Test Album" });
    await testAlbum.click();
    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"], [role="row"]', { timeout: 10000 });
    
    // Double-click first track to play
    const firstTrack = page.locator('[data-testid="song-row"], [role="row"]').first();
    await firstTrack.dblclick();
    await waitForPlayerReady(page);
    
    const playerBar = page.getByTestId("player-bar");
    
    // Skip to last track and end queue
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(500);
    
    // Verify queue ended
    await expect(playerBar).toContainText("Not playing");
    
    // Check that no track row has the "now playing" indicator (primary color text)
    // The active track typically has text-primary class
    const activeTrackIndicator = page.locator('[data-testid="song-row"] .text-primary, [role="row"] .text-primary');
    await expect(activeTrackIndicator).toHaveCount(0);
  });

  test("can play new tracks after queue ends", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    const playerBar = page.getByTestId("player-bar");
    
    // Skip to last track and end queue
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(300);
    await playerBar.getByRole("button", { name: /next/i }).click();
    await page.waitForTimeout(500);
    
    // Verify queue ended
    await expect(playerBar).toContainText("Not playing");
    
    // Navigate to a different album and play a track
    await page.goto("/library");
    await page.waitForSelector('[data-testid="album-card"], article', { timeout: 10000 });
    
    const anotherAlbum = page.locator('[data-testid="album-card"], article').filter({ hasText: "Another Album" });
    await anotherAlbum.click();
    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"], [role="row"]', { timeout: 10000 });
    
    // Double-click first track to play
    const firstTrack = page.locator('[data-testid="song-row"], [role="row"]').first();
    await firstTrack.dblclick();
    await page.waitForTimeout(1000);
    
    // Should now be playing the new track
    await expect(playerBar).toContainText("FLAC Track");
  });
});
