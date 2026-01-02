/**
 * Queue management tests - Queue panel and interactions
 */

import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

async function waitForQueuePanel(page: import("@playwright/test").Page) {
  // Wait for the queue heading to be visible
  const queueHeading = page.getByRole("heading", {
    name: "Queue",
    exact: true,
  });
  await expect(queueHeading).toBeVisible({ timeout: 10000 });

  // Return the parent container - either aside (desktop) or dialog (mobile)
  const sidebar = page.locator("aside").filter({
    has: page.getByRole("heading", { name: "Queue" }),
  });
  if (await sidebar.isVisible().catch(() => false)) {
    return sidebar;
  }
  // For dialog, just return a generic container that has the heading
  return page.locator('[role="dialog"]').filter({
    has: page.getByRole("heading", { name: "Queue" }),
  });
}

test.describe("Queue Management", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.evaluate(() => {
      const keysToRemove = Object.keys(localStorage).filter(
        (key) => key.includes("queue") || key.includes("shuffle"),
      );
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    });
    await page.reload();
  });

  test("can open queue panel and see empty state", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    const queuePanel = await waitForQueuePanel(page);

    // Clear queue if needed
    const clearButton = queuePanel.getByRole("button", { name: "Clear" });
    if (await clearButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearButton.click({ force: true });
      await page.waitForTimeout(500);
    }

    await expect(
      queuePanel.getByRole("heading", { name: "Your queue is empty" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("playing a song populates queue with album tracks", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    const queuePanel = await waitForQueuePanel(page);

    // Queue should show all Test Album tracks
    await expect(queuePanel.getByText("First Song")).toBeVisible();
    await expect(queuePanel.getByText("Second Song")).toBeVisible();
    await expect(queuePanel.getByText("Third Song")).toBeVisible();
  });

  test("clicking queue item changes current track", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    await expect(page.locator("footer")).toContainText("First Song");

    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    // Wait for queue heading
    await expect(
      page.getByRole("heading", { name: "Queue", exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Wait for virtualized list to stabilize
    await page.waitForTimeout(500);

    // Find and click "Third Song" - using page-level locator to avoid scope issues
    const thirdSong = page.getByText("Third Song").first();
    await expect(thirdSong).toBeVisible({ timeout: 5000 });

    // Double-click to play (single click may just select)
    await thirdSong.dblclick({ force: true });
    await page.waitForTimeout(500);

    await expect(page.locator("footer")).toContainText("Third Song");
  });
});
