/**
 * Queue management tests - Queue panel and interactions
 */

import {
  test,
  expect,
  playFirstSong,
  waitForPlayerReady,
  resetState,
} from "./fixtures";
import { setServerPreference } from "./app-helpers";
import { openQueuePanel } from "./queue-helpers";
import type { Page } from "@playwright/test";

async function playFilteredFlacTrack(page: Page, trackName = "FLAC Track One") {
  await page.goto("/library/songs");

  const listViewButton = page.getByRole("button", { name: /list view/i });
  await expect(listViewButton).toBeVisible({ timeout: 10000 });
  await listViewButton.click();

  const filterInput = page.getByLabel("Filter library items");
  await expect(filterInput).toBeVisible({ timeout: 10000 });
  await filterInput.fill("FLAC");
  await expect(
    page.locator('[data-testid="song-row"]').filter({ hasText: "First Song" }),
  ).toHaveCount(0, { timeout: 10000 });

  const flacRow = page
    .locator('[data-testid="song-row"]')
    .filter({ hasText: trackName })
    .first();
  await expect(flacRow).toBeVisible({ timeout: 10000 });
  const startQueueResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/ferrotune/queue/start") &&
      response.request().method() === "POST" &&
      response.status() === 200,
    { timeout: 10000 },
  );
  await flacRow.hover();
  await flacRow.getByRole("button", { name: /^play$/i }).click({ force: true });
  await startQueueResponse;
  await waitForPlayerReady(page);
  await expect(page.getByTestId("player-bar")).toContainText(trackName, {
    timeout: 10000,
  });
}

test.describe.serial("Queue Management", () => {
  // Reset all server state before each test for isolation
  test.beforeEach(async ({ authenticatedPage: page, server }) => {
    await resetState(page, server);
    await page.reload();
  });

  test("can open queue panel and see empty state", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    const queuePanel = await openQueuePanel(page);

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

    const queuePanel = await openQueuePanel(page);

    // Queue should show all Test Album tracks
    await expect(queuePanel.getByText("First Song")).toBeVisible();
    await expect(queuePanel.getByText("Second Song")).toBeVisible();
    await expect(queuePanel.getByText("Third Song")).toBeVisible();
  });

  test("queue item play button changes current track", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);
    await expect(page.locator("footer")).toContainText("First Song");

    const queuePanel = await openQueuePanel(page);
    const thirdQueueItem = queuePanel
      .locator('[data-testid="queue-item"]')
      .filter({ hasText: "Third Song" })
      .first();

    await expect(thirdQueueItem).toBeVisible({ timeout: 5000 });
    await thirdQueueItem.hover();
    await thirdQueueItem
      .getByRole("button", { name: "Play Third Song" })
      .click();

    await expect(page.locator("footer")).toContainText("Third Song");
  });

  test("library songs marks the played row and card as current", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/songs");

    const listViewButton = page.getByRole("button", { name: /list view/i });
    await expect(listViewButton).toBeVisible({ timeout: 10000 });
    await listViewButton.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const flacRow = page
      .locator('[data-testid="song-row"]')
      .filter({ hasText: "FLAC Track One" })
      .first();

    await expect(flacRow).toBeVisible({ timeout: 10000 });
    await flacRow.dblclick();
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("FLAC Track One", {
      timeout: 10000,
    });
    await playerBar.getByRole("button", { name: /pause/i }).first().click();
    await expect(flacRow).toHaveAttribute("data-current-track", "true", {
      timeout: 10000,
    });
    await expect(
      page.locator('[data-testid="song-row"][data-current-track="true"]'),
    ).toHaveCount(1);

    const gridViewButton = page.getByRole("button", { name: /grid view/i });
    await expect(gridViewButton).toBeVisible({ timeout: 10000 });
    await gridViewButton.click();

    const flacCard = page
      .locator('[data-testid="media-card"]')
      .filter({ hasText: "FLAC Track One" })
      .first();

    await expect(flacCard).toHaveAttribute("data-current-track", "true", {
      timeout: 10000,
    });
  });

  test("search terms can be excluded from queue materialization", async ({
    authenticatedPage: page,
  }) => {
    await setServerPreference(page, "apply-search-terms-to-queue", true);
    await page.reload();

    await playFilteredFlacTrack(page);

    let queuePanel = await openQueuePanel(page);
    await expect(queuePanel.getByText("FLAC Track One")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      queuePanel
        .locator('[data-testid="queue-item"]')
        .filter({ hasText: "First Song" }),
    ).toHaveCount(0);

    await setServerPreference(page, "apply-search-terms-to-queue", false);
    await page.reload();

    await playFilteredFlacTrack(page, "FLAC Track Two");

    queuePanel = await openQueuePanel(page);
    await expect(
      queuePanel
        .locator('[data-testid="queue-item"]')
        .filter({ hasText: "First Song" }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("removing an earlier queue item keeps the same current track", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song");
    await playerBar.getByRole("button", { name: /next/i }).click();
    await expect(playerBar).toContainText("Second Song");

    const queuePanel = await openQueuePanel(page);
    const firstQueueItem = queuePanel
      .locator('[data-testid="queue-item"]')
      .filter({ hasText: "First Song" })
      .first();

    await expect(firstQueueItem).toBeVisible({ timeout: 5000 });
    await firstQueueItem.click({ button: "right" });

    const contextMenu = page.locator('[data-slot="context-menu-content"]');
    const removeItem = contextMenu.getByRole("menuitem", {
      name: /remove from queue/i,
    });
    await expect(removeItem).toBeVisible({ timeout: 5000 });
    await removeItem.click();

    await expect(playerBar).toContainText("Second Song");
    await expect(
      queuePanel
        .locator('[data-testid="queue-item"]')
        .filter({ hasText: "First Song" }),
    ).toHaveCount(0);
  });
});
