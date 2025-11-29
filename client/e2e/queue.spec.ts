import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

test.describe("Queue Management", () => {
  test("queue button is visible in player bar", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await expect(queueButton).toBeVisible();
  });

  test("can open queue panel", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Queue panel should open - look for the sheet/panel title specifically
    await expect(page.getByRole("heading", { name: "Queue", exact: true })).toBeVisible();
  });

  test("queue shows empty state when nothing playing", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Should show empty state message
    await expect(page.getByText("Your queue is empty")).toBeVisible();
  });

  test("playing a song populates queue", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Open queue
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Wait for queue panel to open
    const queuePanel = page.locator('[data-slot="sheet-content"]');
    await expect(queuePanel).toBeVisible();
    
    // Queue should show current track - scope to the queue panel
    await expect(queuePanel.getByText("First Song")).toBeVisible();
  });

  test("queue shows all tracks from album", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Open queue
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Wait for queue panel to open
    const queuePanel = page.locator('[data-slot="sheet-content"]');
    await expect(queuePanel).toBeVisible();
    
    // Queue should show all Test Album tracks - scope to the queue panel
    await expect(queuePanel.getByText("First Song")).toBeVisible();
    await expect(queuePanel.getByText("Second Song")).toBeVisible();
    await expect(queuePanel.getByText("Third Song")).toBeVisible();
  });

  test("can close queue panel", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Wait for panel to open
    await expect(page.getByRole("heading", { name: "Queue", exact: true })).toBeVisible();
    
    // Close by pressing Escape
    await page.keyboard.press("Escape");
    
    // Wait for panel to close
    await expect(page.getByRole("heading", { name: "Queue", exact: true })).toBeHidden();
  });

  test("clicking queue item changes current track", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Verify First Song is playing
    await expect(page.locator("footer")).toContainText("First Song");
    
    // Open queue
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Wait for queue panel to open
    const queuePanel = page.locator('[data-slot="sheet-content"]');
    await expect(queuePanel).toBeVisible();
    
    // Click on Third Song in queue (scope to queue panel to avoid ambiguity)
    await queuePanel.getByText("Third Song").click();
    
    await page.waitForTimeout(500);
    
    // Should now be playing Third Song
    await expect(page.locator("footer")).toContainText("Third Song");
  });

  test("now playing section shows current track", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Open queue
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Wait for queue panel to open
    const queuePanel = page.locator('[data-slot="sheet-content"]');
    await expect(queuePanel).toBeVisible();
    
    // Should show "Now Playing" section with current track
    await expect(queuePanel.getByText(/now playing/i)).toBeVisible();
  });
});
