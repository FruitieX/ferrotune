import { test, expect } from "./fixtures";

test.describe("Playback", () => {
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
