/**
 * Song likes: repeatable likes on top of favorites. A tap likes the song (and
 * favorites it); a second tap within the server's 12-hour window undoes it.
 */

import type { Page } from "@playwright/test";
import {
  test,
  expect,
  playTestAlbumSong,
  waitForPlayerReady,
} from "./fixtures";

function toast(page: Page, text: RegExp) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

async function openSongContextMenu(page: Page, songTitle: string) {
  const songRow = page
    .locator('[data-testid="song-row"]')
    .filter({ hasText: songTitle })
    .first();
  await expect(songRow).toBeVisible();
  await songRow.click({ button: "right", position: { x: 180, y: 20 } });

  const contextMenu = page.locator(
    '[data-slot="context-menu-content"][data-state="open"]',
  );
  await expect(contextMenu).toBeVisible();
  return contextMenu;
}

test.describe("Song likes", () => {
  test("player like button likes and favorites, a second tap undoes both", async ({
    authenticatedPage: page,
  }) => {
    await playTestAlbumSong(page, 2);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    const likeButton = playerBar.getByTestId("like-button");
    await expect(likeButton).toHaveAttribute("aria-pressed", "false");
    await expect(
      playerBar.getByRole("button", { name: "Add to favorites" }),
    ).toBeVisible();

    await likeButton.click();
    await expect(toast(page, /^Liked$/)).toBeVisible();
    await expect(likeButton).toHaveAttribute("aria-pressed", "true");
    await expect(likeButton.getByTestId("like-count")).toHaveText("1");
    await expect(
      playerBar.getByRole("button", { name: "Remove from favorites" }),
    ).toBeVisible();

    await likeButton.click();
    await expect(toast(page, /like removed/i)).toBeVisible();
    await expect(likeButton).toHaveAttribute("aria-pressed", "false");
    await expect(likeButton.getByTestId("like-count")).toHaveCount(0);
    await expect(
      playerBar.getByRole("button", { name: "Add to favorites" }),
    ).toBeVisible();
  });

  test("song menu likes a song and offers to undo it", async ({
    authenticatedPage: page,
  }) => {
    await playTestAlbumSong(page, 1);
    const songTitle = "Second Song";

    let contextMenu = await openSongContextMenu(page, songTitle);
    await contextMenu.getByRole("menuitem", { name: /^like$/i }).click();
    await expect(toast(page, /^Liked$/)).toBeVisible();

    contextMenu = await openSongContextMenu(page, songTitle);
    const undo = contextMenu.getByRole("menuitem", {
      name: /undo like \(1\)/i,
    });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(toast(page, /like removed/i)).toBeVisible();
  });
});
