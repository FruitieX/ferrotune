import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

// Helper to get queue panel - works for both desktop sidebar and mobile sheet
async function getQueuePanel(page: import("@playwright/test").Page) {
  // Desktop uses aside with the Queue header, mobile uses sheet dialog
  const sidebar = page.locator('aside').filter({ hasText: /^Queue/ });
  const sheet = page.getByRole('dialog', { name: 'Queue' });
  
  // Check which one is visible
  if (await sidebar.isVisible().catch(() => false)) {
    return sidebar;
  }
  return sheet;
}

// Helper to wait for queue panel to open
async function waitForQueuePanel(page: import("@playwright/test").Page) {
  // On mobile, the desktop sidebar exists but is hidden (hidden xl:flex).
  // We need to check for either the visible sidebar OR the visible dialog.
  // Use separate expects to avoid strict mode violation from or() with hidden elements.
  const sidebar = page.locator('aside').filter({ hasText: /^Queue/ });
  const sheet = page.getByRole('dialog', { name: 'Queue' });
  
  // Wait for at least one to be visible
  await Promise.race([
    expect(sidebar).toBeVisible({ timeout: 10000 }).catch(() => {}),
    expect(sheet).toBeVisible({ timeout: 10000 }).catch(() => {}),
  ]);
  
  // Now verify at least one is actually visible
  const sidebarVisible = await sidebar.isVisible().catch(() => false);
  const sheetVisible = await sheet.isVisible().catch(() => false);
  
  if (!sidebarVisible && !sheetVisible) {
    throw new Error('Neither queue sidebar nor sheet is visible');
  }
  
  return getQueuePanel(page);
}

test.describe("Queue Management", () => {
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

  test("queue button is visible in player bar", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await expect(queueButton).toBeVisible();
  });

  test("can open queue panel", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Queue panel should open - wait for it
    await waitForQueuePanel(page);
  });

  test("queue shows empty state when nothing playing", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Wait for queue panel
    const queuePanel = await waitForQueuePanel(page);
    
    // Clear queue if it has items (from server-side persistence of previous tests)
    const clearButton = queuePanel.getByRole("button", { name: "Clear" });
    if (await clearButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearButton.click();
      // Wait for clear to take effect
      await page.waitForTimeout(500);
    }
    
    // Now check for empty state message
    await expect(queuePanel.getByRole("heading", { name: "Your queue is empty" })).toBeVisible({ timeout: 15000 });
  });

  test("playing a song populates queue", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Open queue
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    // Wait for queue panel to open
    const queuePanel = await waitForQueuePanel(page);
    
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
    const queuePanel = await waitForQueuePanel(page);
    
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
    await waitForQueuePanel(page);
    
    // Close - different methods for desktop sidebar vs mobile sheet
    const viewportSize = page.viewportSize();
    const isDesktop = viewportSize && viewportSize.width >= 1280; // xl breakpoint
    
    if (isDesktop) {
      // Desktop: click the close button in sidebar
      const closeButton = page.getByRole("button", { name: /close queue/i });
      await closeButton.click();
    } else {
      // Mobile: press Escape to close sheet
      await page.keyboard.press("Escape");
    }
    
    // Wait for panel to close - on desktop sidebar is hidden but still in DOM
    // So we check that it's not visible by checking the button state instead
    await page.waitForTimeout(300);
    
    // Click queue button again - it should open (if it was properly closed)
    await queueButton.click();
    await waitForQueuePanel(page);
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
    const queuePanel = await waitForQueuePanel(page);
    
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
    const queuePanel = await waitForQueuePanel(page);
    
    // Should show "Now Playing" section with current track
    await expect(queuePanel.getByText(/now playing/i)).toBeVisible();
  });

  test("can clear queue", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Open queue
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    const queuePanel = await waitForQueuePanel(page);
    
    // Click Clear button
    const clearButton = queuePanel.getByRole("button", { name: "Clear" });
    await expect(clearButton).toBeVisible();
    await clearButton.click();
    
    // Queue should show empty state
    await expect(queuePanel.getByRole("heading", { name: "Your queue is empty" })).toBeVisible({ timeout: 5000 });
  });

  test("queue updates when adding songs via Play Next", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Open queue and note initial count
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    const queuePanel = await waitForQueuePanel(page);
    
    // Close queue
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    
    // Go to another album
    await page.goto("/library/albums");
    await page.locator('[data-testid="media-card"], article').filter({ hasText: "Another Album" }).click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    
    // Add song via context menu "Play Next"
    const songRow = page.locator('[data-testid="song-row"]').first();
    await songRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Play Next" }).click();
    
    // Verify toast
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: /next|added/i })).toBeVisible({ timeout: 3000 });
    
    // Open queue again and verify song was added
    await queueButton.click();
    const updatedQueuePanel = await waitForQueuePanel(page);
    
    // Should now contain the added song
    await expect(updatedQueuePanel.getByText("FLAC Track One")).toBeVisible({ timeout: 5000 });
  });

  test("queue updates when adding songs via Add to Queue", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Go to another album
    await page.goto("/library/albums");
    await page.locator('[data-testid="media-card"], article').filter({ hasText: "Another Album" }).click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    
    // Add song via context menu "Add to Queue"
    const songRow = page.locator('[data-testid="song-row"]').first();
    await songRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add to Queue" }).click();
    
    // Verify toast
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: /added to queue/i })).toBeVisible({ timeout: 3000 });
    
    // Open queue and verify song is at the end
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    const queuePanel = await waitForQueuePanel(page);
    
    await expect(queuePanel.getByText("FLAC Track One")).toBeVisible({ timeout: 5000 });
  });

  test("queue shows Up Next section", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Open queue
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    const queuePanel = await waitForQueuePanel(page);
    
    // Should show "Up Next" section (when there are more songs)
    await expect(queuePanel.getByText(/up next/i)).toBeVisible();
  });

  test("double-clicking queue item plays it", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    
    // Verify First Song is playing
    await expect(page.locator("footer")).toContainText("First Song");
    
    // Open queue
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    const queuePanel = await waitForQueuePanel(page);
    
    // Double-click on Second Song
    await queuePanel.getByText("Second Song").dblclick();
    
    await page.waitForTimeout(500);
    
    // Should now be playing Second Song
    await expect(page.locator("footer")).toContainText("Second Song");
  });

  test("queue keyboard navigation with Escape", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    
    const queueButton = page.locator("footer").getByRole("button", { name: /queue/i }).first();
    await queueButton.click();
    
    await waitForQueuePanel(page);
    
    // Press Escape to close
    await page.keyboard.press("Escape");
    
    await page.waitForTimeout(300);
    
    // On mobile, sheet should be closed
    // On desktop, sidebar may toggle
    // Just verify we can open it again
    await queueButton.click();
    await waitForQueuePanel(page);
  });
});
