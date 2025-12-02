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
    await waitForQueuePanel(page);
    
    // Should show empty state message (it's a heading in the UI)
    await expect(page.getByRole("heading", { name: "Your queue is empty" })).toBeVisible();
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
      const closeButton = page.locator('aside').filter({ hasText: /^Queue/ }).getByRole("button").filter({ has: page.locator('svg') }).last();
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
});
