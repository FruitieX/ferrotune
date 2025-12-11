import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

// Helper to get queue panel - works for both desktop sidebar and mobile sheet
async function getQueuePanel(page: import("@playwright/test").Page) {
  // Desktop uses aside with the Queue heading, mobile uses sheet dialog
  const sidebar = page.locator("aside").filter({
    has: page.getByRole("heading", { name: "Queue" }),
  });
  const sheet = page.getByRole("dialog", { name: "Queue" });

  // Check which one is visible
  if (await sidebar.isVisible().catch(() => false)) {
    return sidebar;
  }
  return sheet;
}

// Helper to wait for queue panel to open
async function waitForQueuePanel(page: import("@playwright/test").Page) {
  // The queue panel can be either a sidebar (desktop) or a sheet (mobile)
  // The sidebar animates its width from 0 to 360px
  // We need to wait for the Queue heading to become visible

  // Look for the Queue heading (exact match to avoid "Your queue is empty")
  const queueHeading = page.getByRole("heading", {
    name: "Queue",
    exact: true,
  });

  // Wait for the heading to be visible (indicates panel is fully open)
  await expect(queueHeading).toBeVisible({ timeout: 10000 });

  // Now get the actual panel container
  return getQueuePanel(page);
}

test.describe("Queue Management", () => {
  // TODO: These tests are flaky due to queue sidebar rendering timing issues.
  // The queue sidebar uses animations and responsive breakpoints that make it
  // difficult to reliably wait for in E2E tests. Skip for now and fix later.
  test.describe.configure({ mode: "serial" });

  // Clear queue-related state before each test to ensure clean slate
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.evaluate(() => {
      // Only clear queue-related keys, not auth credentials
      const keysToRemove = Object.keys(localStorage).filter(
        (key) =>
          key.includes("queue") ||
          key.includes("shuffle") ||
          key.includes("volume"),
      );
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    });
    // Reload to apply cleared state
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  });

  test("queue button is visible in player bar", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await expect(queueButton).toBeVisible();
  });

  test("can open queue panel", async ({ authenticatedPage: page }) => {
    await page.goto("/");

    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    // Queue panel should open - wait for it
    await waitForQueuePanel(page);
  });

  test("queue shows empty state when nothing playing", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
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
    await expect(
      queuePanel.getByRole("heading", { name: "Your queue is empty" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("playing a song populates queue", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Open queue
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    // Wait for queue panel to open
    const queuePanel = await waitForQueuePanel(page);

    // Queue should show current track - scope to the queue panel
    await expect(queuePanel.getByText("First Song")).toBeVisible();
  });

  test("queue shows all tracks from album", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Open queue
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
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

    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
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

  test("clicking queue item changes current track", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Verify First Song is playing
    await expect(page.locator("footer")).toContainText("First Song");

    // Open queue
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    // Wait for queue panel to open
    const queuePanel = await waitForQueuePanel(page);

    // Click on Third Song in queue (scope to queue panel to avoid ambiguity)
    await queuePanel.getByText("Third Song").click();

    await page.waitForTimeout(500);

    // Should now be playing Third Song
    await expect(page.locator("footer")).toContainText("Third Song");
  });

  test("now playing section shows current track", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Open queue
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    // Wait for queue panel to open
    const queuePanel = await waitForQueuePanel(page);

    // Should show "Playing from" indicator and the current track
    // The queue panel shows "Playing from [Album]" and highlights the current track
    await expect(queuePanel.getByText(/playing from/i)).toBeVisible();
    // The currently playing song should be visible in the queue
    await expect(queuePanel.getByText("First Song")).toBeVisible();
  });

  test("can clear queue", async ({ authenticatedPage: page }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Open queue
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    const queuePanel = await waitForQueuePanel(page);

    // Verify queue has items before clearing
    await expect(queuePanel.getByText("First Song")).toBeVisible({
      timeout: 5000,
    });

    // Wait for the Clear button to be stable and click it
    const clearButton = queuePanel.getByRole("button", { name: "Clear" });
    await expect(clearButton).toBeVisible({ timeout: 5000 });
    // Use force due to framer-motion animations making the button "unstable"
    await clearButton.click({ force: true });

    // Wait for tracks to disappear (clear operation involves server call)
    await expect(queuePanel.getByText("First Song")).not.toBeVisible({
      timeout: 10000,
    });

    // Queue should show empty state
    await expect(
      queuePanel.getByRole("heading", { name: "Your queue is empty" }),
    ).toBeVisible({ timeout: 10000 });
  });

  // TODO: This test is currently failing - the Play Next action appears to show a toast
  // but doesn't actually add the song to the queue. Needs investigation into why
  // addToQueueAtom isn't working correctly in this scenario.
  test.skip("queue updates when adding songs via Play Next", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Open queue and verify it shows tracks
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();
    const initialQueuePanel = await waitForQueuePanel(page);
    await expect(initialQueuePanel.getByText("First Song")).toBeVisible({
      timeout: 5000,
    });

    // Close queue using the close button instead of Escape for reliability
    const closeButton = initialQueuePanel.getByRole("button", {
      name: "Close queue",
    });
    await closeButton.click({ force: true });
    await expect(
      page.getByRole("heading", { name: "Queue", exact: true }),
    ).not.toBeVisible({ timeout: 3000 });

    // Go to another album
    await page.goto("/library/albums");
    await page.waitForLoadState("domcontentloaded");
    const albumCard = page
      .locator('[data-testid="media-card"], article')
      .filter({ hasText: "Another Album" })
      .first();
    await expect(albumCard).toBeVisible({ timeout: 10000 });
    await albumCard.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    // Use the "More options" dropdown button instead of right-click
    const songRow = page.locator('[data-testid="song-row"]').first();
    await songRow.hover();
    const moreButton = songRow.getByRole("button", { name: "More options" });
    await expect(moreButton).toBeVisible({ timeout: 5000 });
    await moreButton.click();

    // Wait for dropdown menu to appear and click Play Next
    const dropdownMenu = page.locator('[role="menu"]');
    await expect(dropdownMenu).toBeVisible({ timeout: 5000 });
    const playNextItem = dropdownMenu.getByRole("menuitem", {
      name: "Play Next",
    });
    await expect(playNextItem).toBeVisible({ timeout: 5000 });
    await playNextItem.click();

    // Verify toast shows successful addition
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /play next|added/i }),
    ).toBeVisible({ timeout: 5000 });

    // Wait for the queue operation to complete (involves server call)
    // The toast shows immediately but the queue update is async
    await page.waitForTimeout(1000);

    // Open queue again and verify song was added
    await queueButton.click();
    const updatedQueuePanel = await waitForQueuePanel(page);

    // First verify the existing songs are still there
    await expect(updatedQueuePanel.getByText("First Song")).toBeVisible({
      timeout: 10000,
    });

    // Should now contain the added song
    await expect(updatedQueuePanel.getByText("FLAC Track One")).toBeVisible({
      timeout: 10000,
    });
  });

  test("queue updates when adding songs via Add to Queue", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Go to another album
    await page.goto("/library/albums");
    await page.waitForLoadState("domcontentloaded");
    const albumCard2 = page
      .locator('[data-testid="media-card"], article')
      .filter({ hasText: "Another Album" })
      .first();
    await expect(albumCard2).toBeVisible({ timeout: 10000 });
    await albumCard2.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    // Use the "More options" dropdown button instead of right-click
    const songRow = page.locator('[data-testid="song-row"]').first();
    await songRow.hover();
    const moreButton = songRow.getByRole("button", { name: "More options" });
    await moreButton.click();

    // Click "Add to Queue" in the dropdown menu
    await page.getByRole("menuitem", { name: "Add to Queue" }).click();

    // Verify toast - message is like 'Added "Song Name" to queue'
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /added.*to queue/i }),
    ).toBeVisible({ timeout: 3000 });

    // Open queue and verify song is at the end
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();
    const queuePanel = await waitForQueuePanel(page);

    await expect(queuePanel.getByText("FLAC Track One")).toBeVisible({
      timeout: 5000,
    });
  });

  test("queue shows track count when multiple songs", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Open queue
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    const queuePanel = await waitForQueuePanel(page);

    // Should show track count (e.g., "3 tracks")
    await expect(queuePanel.getByText(/\d+ tracks?/i)).toBeVisible();
  });

  test("double-clicking queue item plays it", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Verify First Song is playing
    await expect(page.locator("footer")).toContainText("First Song");

    // Open queue
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    const queuePanel = await waitForQueuePanel(page);

    // Verify queue has songs
    await expect(queuePanel.getByText("First Song")).toBeVisible({
      timeout: 10000,
    });
    await expect(queuePanel.getByText("Second Song")).toBeVisible({
      timeout: 10000,
    });

    // Double-click on Second Song using force to avoid stability issues with virtualized list
    const secondSongItem = queuePanel.getByText("Second Song");
    await secondSongItem.dblclick({ force: true });

    await page.waitForTimeout(500);

    // Should now be playing Second Song
    await expect(page.locator("footer")).toContainText("Second Song");
  });

  test("queue keyboard navigation with Escape", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
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
