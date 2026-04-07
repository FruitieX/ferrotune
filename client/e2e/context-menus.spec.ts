/**
 * Context menu tests - Right-click menus for songs, albums, artists
 */

import {
  test,
  expect,
  playFirstSong,
  resetState,
  waitForPlayerReady,
} from "./fixtures";
import { openQueuePanel } from "./queue-helpers";

async function openContextMenu(
  page: import("@playwright/test").Page,
  element: import("@playwright/test").Locator,
) {
  await element.click({ button: "right" });
  const contextMenu = page.locator(
    '[data-slot="context-menu-content"][data-state="open"]',
  );
  await expect(contextMenu).toBeVisible({ timeout: 5000 });
  return contextMenu;
}

test.describe("Context Menus", () => {
  test.beforeEach(async ({ authenticatedPage: page, server }) => {
    await resetState(page, server);
    await page.reload();
  });

  test("song context menu has all actions and can play", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/songs");

    const listViewButton = page.getByRole("button", { name: /list view/i });
    await expect(listViewButton).toBeVisible({ timeout: 10000 });
    await listViewButton.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const songRow = page.locator('[data-testid="song-row"]').first();
    const contextMenu = await openContextMenu(page, songRow);

    // Check for expected menu items
    await expect(
      contextMenu.getByRole("menuitem", { name: /^play$/i }),
    ).toBeVisible();
    await expect(
      contextMenu.getByRole("menuitem", { name: /play next/i }),
    ).toBeVisible();
    await expect(
      contextMenu.getByRole("menuitem", { name: /add to queue/i }),
    ).toBeVisible();
    await expect(
      contextMenu.getByRole("menuitem", { name: /add to playlist/i }),
    ).toBeVisible();

    // Play the song
    await contextMenu.getByRole("menuitem", { name: /^play$/i }).click();
    await waitForPlayerReady(page);
    await expect(page.getByTestId("player-bar")).toBeVisible();
  });

  test("album card context menu can play and shuffle", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/albums");

    // Switch to grid view to get media cards
    const gridViewButton = page.getByRole("button", { name: /grid view/i });
    await expect(gridViewButton).toBeVisible({ timeout: 10000 });
    await gridViewButton.click();

    await page.waitForSelector('[data-testid="media-card"]', {
      timeout: 10000,
    });

    const albumCard = page.locator('[data-testid="media-card"]').first();
    const contextMenu = await openContextMenu(page, albumCard);

    await expect(
      contextMenu.getByRole("menuitem", { name: /^play$/i }),
    ).toBeVisible();
    await expect(
      contextMenu.getByRole("menuitem", { name: /shuffle/i }),
    ).toBeVisible();

    // Play the album
    await contextMenu.getByRole("menuitem", { name: /^play$/i }).click();
    await waitForPlayerReady(page);
  });

  test("artist card context menu can play and shuffle", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/artists");

    // Switch to grid view
    const gridViewButton = page.getByRole("button", { name: /grid view/i });
    await expect(gridViewButton).toBeVisible({ timeout: 10000 });
    await gridViewButton.click();
    await page.waitForSelector('[data-testid="media-card"]', {
      timeout: 10000,
    });

    const artistCard = page.locator('[data-testid="media-card"]').first();
    const contextMenu = await openContextMenu(page, artistCard);

    // Artist context menu uses "Play All" and "Shuffle All"
    await expect(
      contextMenu.getByRole("menuitem", { name: /play all/i }),
    ).toBeVisible();
    await expect(
      contextMenu.getByRole("menuitem", { name: /shuffle all/i }),
    ).toBeVisible();
  });

  test("play next inserts immediately after the current song", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
    await playerBar.getByRole("button", { name: /next/i }).click();
    await expect(playerBar).toContainText("Second Song", { timeout: 10000 });

    await page.goto("/library/songs");

    const listViewButton = page.getByRole("button", { name: /list view/i });
    await expect(listViewButton).toBeVisible({ timeout: 10000 });
    await listViewButton.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const flacTrackOne = page
      .locator('[data-testid="song-row"]')
      .filter({ hasText: "FLAC Track One" })
      .first();
    const flacTrackTwo = page
      .locator('[data-testid="song-row"]')
      .filter({ hasText: "FLAC Track Two" })
      .first();

    await (await openContextMenu(page, flacTrackOne))
      .getByRole("menuitem", { name: /play next/i })
      .click();
    await (await openContextMenu(page, flacTrackTwo))
      .getByRole("menuitem", { name: /play next/i })
      .click();

    await expect(playerBar).toContainText("Second Song", { timeout: 10000 });

    const queuePanel = await openQueuePanel(page);
    const queueItems = queuePanel.locator('[data-testid="queue-item"]');

    await expect(queueItems.nth(0)).toContainText("First Song");
    await expect(queueItems.nth(1)).toContainText("Second Song");
    await expect(queueItems.nth(2)).toContainText("FLAC Track Two");
    await expect(queueItems.nth(3)).toContainText("FLAC Track One");
    await expect(queueItems.nth(4)).toContainText("Third Song");
  });
});
