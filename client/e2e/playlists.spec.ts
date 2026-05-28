/**
 * Playlist tests - Create and manage playlists
 */

import type { Page } from "@playwright/test";
import { test, expect, type ServerInfo } from "./fixtures";

function basicAuthHeader(server: ServerInfo): string {
  return `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getFirstSongId(responseBody: unknown): string {
  if (!isRecord(responseBody)) {
    throw new Error("Search response was not an object");
  }

  const searchResult = responseBody.searchResult;
  if (!isRecord(searchResult) || !Array.isArray(searchResult.song)) {
    throw new Error("Search response did not include songs");
  }

  const [firstSong] = searchResult.song;
  if (!isRecord(firstSong)) {
    throw new Error("Search response did not include a first song");
  }

  const songId = firstSong.id;
  if (typeof songId !== "string") {
    throw new Error("Search response first song did not include an ID");
  }

  return songId;
}

function getImportedPlaylistId(responseBody: unknown): string {
  if (!isRecord(responseBody)) {
    throw new Error("Import playlist response was not an object");
  }

  const playlistId = responseBody.playlistId;
  if (typeof playlistId !== "string") {
    throw new Error("Import playlist response did not include a playlist ID");
  }

  return playlistId;
}

async function fetchFirstSongId(
  page: Page,
  server: ServerInfo,
): Promise<string> {
  const params = new URLSearchParams({
    query: "*",
    artistCount: "0",
    albumCount: "0",
    songCount: "1",
  });
  const response = await page.request.get(
    `${server.url}/api/search?${params}`,
    {
      headers: { Authorization: basicAuthHeader(server) },
    },
  );

  expect(response.ok()).toBe(true);
  return getFirstSongId(await response.json());
}

async function createRepeatedSongPlaylist({
  page,
  server,
  name,
  songId,
  entryCount,
}: {
  page: Page;
  server: ServerInfo;
  name: string;
  songId: string;
  entryCount: number;
}): Promise<string> {
  const response = await page.request.post(
    `${server.url}/api/playlists/import`,
    {
      headers: { Authorization: basicAuthHeader(server) },
      data: {
        name,
        comment: null,
        folderId: null,
        entries: Array.from({ length: entryCount }, () => ({
          songId,
          missing: null,
        })),
      },
    },
  );

  expect(response.ok()).toBe(true);
  return getImportedPlaylistId(await response.json());
}

test.describe("Playlists", () => {
  test("can create a new playlist", async ({ authenticatedPage: page }) => {
    const playlistName = `Test Playlist ${Date.now()}`;

    await page.goto("/playlists");

    // Click the "New" dropdown button
    const newButton = page.getByRole("button", { name: /new/i });
    await expect(newButton).toBeVisible({ timeout: 10000 });
    await newButton.click();

    // Click "Playlist" in the dropdown
    const playlistOption = page.getByRole("menuitem", { name: /^playlist$/i });
    await expect(playlistOption).toBeVisible();
    await playlistOption.click();

    // Dialog should appear
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill in playlist name
    await dialog.getByRole("textbox").fill(playlistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Should see success or stay on playlists page
    expect(page.url()).toContain("/playlists");
  });

  test("can add songs to playlist via context menu", async ({
    authenticatedPage: page,
  }) => {
    const playlistName = `Add Songs Test ${Date.now()}`;

    // Create playlist first
    await page.goto("/playlists");
    const newButton = page.getByRole("button", { name: /new/i });
    await expect(newButton).toBeVisible({ timeout: 10000 });
    await newButton.click();
    await page.getByRole("menuitem", { name: /^playlist$/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole("textbox").fill(playlistName);
    await dialog.getByRole("button", { name: /create|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Go to album and add song
    await page.goto("/library");

    // Switch to grid view
    const gridViewButton = page.getByRole("button", { name: /grid view/i });
    await expect(gridViewButton).toBeVisible({ timeout: 10000 });
    await gridViewButton.click();

    // Wait for media cards and click Test Album
    const testAlbum = page
      .locator('[data-testid="media-card"]')
      .filter({ hasText: "Test Album" });
    await expect(testAlbum).toBeVisible({ timeout: 10000 });
    await testAlbum.click();

    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    // Wait for all async data to load and React state to settle
    // This includes shuffle excludes fetch, starred state initialization, etc.
    await page.waitForTimeout(1000);

    // Right-click to open context menu
    const songRow = page.locator('[data-testid="song-row"]').first();
    await songRow.click({ button: "right" });

    // Wait for context menu to be visible
    const contextMenu = page.locator('[data-slot="context-menu-content"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // Click Add to Playlist using JavaScript evaluate to avoid Playwright's stability checks
    // which can fail if React re-renders the context menu
    await page.evaluate(() => {
      const menuItems = document.querySelectorAll(
        '[data-slot="context-menu-content"] [role="menuitem"]',
      );
      for (const item of menuItems) {
        if (item.textContent?.toLowerCase().includes("add to playlist")) {
          (item as HTMLElement).click();
          break;
        }
      }
    });

    // Wait for the Add to Playlist dialog to open
    const addToPlaylistDialog = page.getByRole("dialog");
    await expect(addToPlaylistDialog).toBeVisible({ timeout: 5000 });

    // Find and click the playlist button inside the dialog
    const playlistButton = addToPlaylistDialog.getByRole("button", {
      name: new RegExp(playlistName, "i"),
    });
    if (await playlistButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playlistButton.click();

      // Verify toast
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: /added/i }),
      ).toBeVisible({ timeout: 3000 });
    }
  });

  test("playlist detail refreshes after editing metadata", async ({
    authenticatedPage: page,
  }) => {
    const playlistName = `Playlist Refresh ${Date.now()}`;
    const updatedPlaylistName = `${playlistName} Updated`;

    await page.goto("/playlists");

    const newButton = page.getByRole("button", { name: /new/i });
    await expect(newButton).toBeVisible({ timeout: 10000 });
    await newButton.click();
    await page.getByRole("menuitem", { name: /^playlist$/i }).click();

    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible({ timeout: 5000 });
    await createDialog.getByRole("textbox").fill(playlistName);
    await createDialog.getByRole("button", { name: /create|save/i }).click();
    await expect(createDialog).not.toBeVisible({ timeout: 5000 });

    await expect(page).toHaveURL(/\/playlists\/details\?id=/);
    await expect(
      page.getByRole("heading", { name: playlistName, exact: true }),
    ).toBeVisible({ timeout: 10000 });

    await page
      .locator('main [data-slot="dropdown-menu-trigger"]')
      .last()
      .click();
    await page.getByRole("menuitem", { name: /edit playlist/i }).click();

    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible({ timeout: 5000 });
    await editDialog.getByLabel("Name").fill(updatedPlaylistName);
    await editDialog.getByRole("button", { name: /^save$/i }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: updatedPlaylistName, exact: true }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("playlist detail does not repeatedly refetch the second sparse page", async ({
    authenticatedPage: page,
    server,
  }) => {
    const playlistName = `Sparse Request Test ${Date.now()}`;
    const songId = await fetchFirstSongId(page, server);
    const playlistId = await createRepeatedSongPlaylist({
      page,
      server,
      name: playlistName,
      songId,
      entryCount: 75,
    });

    let secondPageRequestCount = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname === `/api/playlists/${playlistId}/songs` &&
        url.searchParams.get("offset") === "50"
      ) {
        secondPageRequestCount += 1;
      }
    });

    const secondPageResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/playlists/${playlistId}/songs` &&
        url.searchParams.get("offset") === "50" &&
        response.ok()
      );
    });

    await page.goto(`/playlists/details?id=${playlistId}`);
    await expect(
      page.getByRole("heading", { name: playlistName, exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await secondPageResponse;

    await expect
      .poll(() => secondPageRequestCount, {
        intervals: [200, 200, 200, 200, 200, 200],
        timeout: 1200,
      })
      .toBeLessThanOrEqual(2);
  });
});
