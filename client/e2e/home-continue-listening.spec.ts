import { expect, test } from "./fixtures";
import { setServerPreference } from "./app-helpers";
import type { Locator, Page } from "@playwright/test";

async function openContextMenu(page: Page, element: Locator) {
  await element.click({ button: "right" });
  const contextMenu = page.locator(
    '[data-slot="context-menu-content"][data-state="open"]',
  );
  await expect(contextMenu).toBeVisible({ timeout: 5000 });
  return contextMenu;
}

function makeSong(id: string, title: string) {
  return {
    id,
    parent: null,
    title,
    album: "Test Album",
    albumId: "test-album-id",
    artist: "Test Artist",
    artistId: "test-artist-id",
    track: 1,
    discNumber: 1,
    year: 2024,
    genre: "Rock",
    coverArt: "test-album-id",
    coverArtData: null,
    coverArtWidth: null,
    coverArtHeight: null,
    size: 123456,
    contentType: "audio/mpeg",
    suffix: "mp3",
    duration: 180,
    bitRate: 320,
    path: `/music/${id}.mp3`,
    fullPath: null,
    starred: null,
    userRating: null,
    created: "2024-01-01T00:00:00Z",
    type: "music",
    playCount: 1,
    lastPlayed: "2024-01-02T00:00:00Z",
    replayGainTrackGain: null,
    replayGainTrackPeak: null,
    originalReplayGainTrackGain: null,
    originalReplayGainTrackPeak: null,
    computedReplayGainTrackGain: null,
    computedReplayGainTrackPeak: null,
  };
}

async function routeHomeSongSections(
  page: Page,
  options: {
    mostPlayedRecently?: ReturnType<typeof makeSong>[];
    forgottenFavorites?: ReturnType<typeof makeSong>[];
  } = {},
) {
  await page.route("**/api/songs/most-played-recently*", async (route) => {
    const songs = options.mostPlayedRecently ?? [];
    await route.fulfill({
      json: {
        song: songs,
        total: songs.length,
      },
    });
  });
  await page.route("**/api/songs/forgotten-favorites*", async (route) => {
    const songs = options.forgottenFavorites ?? [];
    await route.fulfill({
      json: {
        song: songs,
        total: songs.length,
        seed: 1,
      },
    });
  });
}

test.describe("Home continue listening", () => {
  test("default quick tiles link to favorites and history", async ({
    authenticatedPage: page,
  }) => {
    await page.route("**/api/home*", async (route) => {
      await route.fulfill({
        json: {
          continueListening: { entries: [], total: 0 },
          mostPlayedRecently: { song: [], total: 0 },
          recentlyAdded: { album: [], total: 0 },
          forgottenFavorites: { song: [], total: 0, seed: 1 },
          discover: { album: [], total: 0, seed: 1 },
        },
      });
    });
    await routeHomeSongSections(page);

    await page.goto("/");

    await expect(
      page.getByRole("link", { name: /favorites open favorite songs/i }),
    ).toHaveAttribute("href", "/favorites");
    await expect(
      page.getByRole("link", {
        name: /recently played open listening history/i,
      }),
    ).toHaveAttribute("href", "/history");
  });

  test("quick tile queue actions use configured section filters", async ({
    authenticatedPage: page,
  }) => {
    await setServerPreference(page, "home-tiles-v1", [
      {
        id: "forgotten-favorites-shuffle",
        kind: "forgottenFavorites",
        action: "shuffle",
      },
    ]);
    await setServerPreference(page, "home-sections-v1", [
      {
        id: "forgotten-favorites",
        kind: "forgottenFavorites",
        enabled: true,
        forgottenFavoritesMinPlays: 42,
        forgottenFavoritesNotPlayedSinceDays: 365,
      },
    ]);

    await page.route("**/api/home*", async (route) => {
      await route.fulfill({
        json: {
          continueListening: { entries: [], total: 0 },
          mostPlayedRecently: { song: [], total: 0 },
          recentlyAdded: { album: [], total: 0 },
          forgottenFavorites: { song: [], total: 0, seed: 1 },
          discover: { album: [], total: 0, seed: 1 },
        },
      });
    });
    await routeHomeSongSections(page);

    await page.route("**/api/queue/start", async (route) => {
      const body = route.request().postDataJSON() as {
        sourceType: string;
        sourceId?: string;
        sourceName?: string;
        shuffle?: boolean;
        filters?: Record<string, unknown>;
      };
      await route.fulfill({
        json: {
          totalCount: 0,
          currentIndex: 0,
          isShuffled: Boolean(body.shuffle),
          repeatMode: "off",
          source: {
            type: body.sourceType,
            id: body.sourceId ?? null,
            name: body.sourceName ?? null,
            filters: body.filters ?? null,
            sort: null,
            instanceId: "00000000-0000-4000-8000-000000000000",
          },
          window: { offset: 0, songs: [] },
        },
      });
    });

    await page.goto("/");

    const startQueueRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/queue/start") &&
        request.method() === "POST",
    );
    await page
      .getByRole("button", {
        name: /forgotten favorites shuffle favorite songs/i,
      })
      .click();

    const requestBody = (await startQueueRequest).postDataJSON() as {
      sourceType: string;
      shuffle: boolean;
      filters?: Record<string, unknown>;
    };
    expect(requestBody.sourceType).toBe("forgottenFavorites");
    expect(requestBody.shuffle).toBe(true);
    expect(requestBody.filters).toMatchObject({
      minPlays: 42,
      notPlayedSinceDays: 365,
    });
  });

  test("custom playlist sections render multiple rows and start playlist queues", async ({
    authenticatedPage: page,
  }) => {
    const playlistId = "home-playlist-section";
    const playlistName = "Home Playlist Section";
    const smartPlaylistId = "home-smart-section";
    const smartPlaylistName = "Home Smart Section";
    const song = makeSong("playlist-section-track", "Playlist Section Track");
    const smartSong = makeSong("smart-section-track", "Smart Section Track");

    await setServerPreference(page, "home-sections-v1", [
      {
        id: "custom-playlist-section",
        kind: "playlistSongs",
        enabled: true,
        playlistId,
        playlistName,
        playlistType: "playlist",
      },
      {
        id: "custom-smart-section",
        kind: "playlistSongs",
        enabled: true,
        playlistId: smartPlaylistId,
        playlistName: smartPlaylistName,
        playlistType: "smartPlaylist",
      },
    ]);

    await page.route("**/api/home*", async (route) => {
      await route.fulfill({
        json: {
          continueListening: { entries: [], total: 0 },
          mostPlayedRecently: { song: [], total: 0 },
          recentlyAdded: { album: [], total: 0 },
          forgottenFavorites: { song: [], total: 0, seed: 1 },
          discover: { album: [], total: 0, seed: 1 },
        },
      });
    });
    await routeHomeSongSections(page);

    await page.route(`**/api/playlists/${playlistId}/songs*`, async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("entryType")).toBe("song");
      await route.fulfill({
        json: {
          id: playlistId,
          name: playlistName,
          comment: null,
          owner: "test",
          public: false,
          totalEntries: 1,
          matchedCount: 1,
          missingCount: 0,
          duration: song.duration,
          filteredCount: 1,
          created: "2024-01-01T00:00:00Z",
          changed: "2024-01-01T00:00:00Z",
          coverArt: null,
          sharedWithMe: false,
          canEdit: true,
          entries: [
            {
              entryId: "playlist-section-entry",
              position: 0,
              entryType: "song",
              addedToPlaylist: "2024-01-01T00:00:00Z",
              songIndex: 0,
              song,
              missing: null,
            },
          ],
        },
      });
    });

    await page.route(
      `**/api/smart-playlists/${smartPlaylistId}/songs*`,
      async (route) => {
        await route.fulfill({
          json: {
            id: smartPlaylistId,
            name: smartPlaylistName,
            totalCount: 1,
            totalDuration: smartSong.duration,
            offset: 0,
            songs: [smartSong],
          },
        });
      },
    );

    await page.route("**/api/queue/start", async (route) => {
      const body = route.request().postDataJSON() as {
        sourceType: string;
        sourceId?: string;
        sourceName?: string;
        shuffle?: boolean;
      };
      await route.fulfill({
        json: {
          totalCount: 1,
          currentIndex: 0,
          isShuffled: Boolean(body.shuffle),
          repeatMode: "off",
          source: {
            type: body.sourceType,
            id: body.sourceId ?? null,
            name: body.sourceName ?? null,
            filters: null,
            sort: null,
            instanceId: "00000000-0000-4000-8000-000000000000",
          },
          window: { offset: 0, songs: [song] },
        },
      });
    });

    await page.goto("/");

    const headings = page.locator("section h2");
    await expect(headings.nth(0)).toContainText(playlistName);
    await expect(headings.nth(1)).toContainText(smartPlaylistName);

    const section = page.locator("section").filter({
      has: page.getByRole("heading", { name: playlistName }),
    });

    await expect(
      section.getByRole("link", { name: playlistName }).first(),
    ).toHaveAttribute("href", `/playlists/details?id=${playlistId}`);
    await expect(
      section.getByRole("link", { name: song.title }).first(),
    ).toBeVisible();

    const smartSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: smartPlaylistName }),
    });
    await expect(
      smartSection.getByRole("link", { name: smartPlaylistName }).first(),
    ).toHaveAttribute("href", `/playlists/smart?id=${smartPlaylistId}`);
    await expect(
      smartSection.getByRole("link", { name: smartSong.title }).first(),
    ).toBeVisible();

    const startQueueRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/queue/start") &&
        request.method() === "POST",
    );
    await section.getByRole("button", { name: `Play ${playlistName}` }).click();

    const requestBody = (await startQueueRequest).postDataJSON() as {
      sourceType: string;
      sourceId?: string;
      sourceName?: string;
      shuffle?: boolean;
    };
    expect(requestBody.sourceType).toBe("playlist");
    expect(requestBody.sourceId).toBe(playlistId);
    expect(requestBody.sourceName).toBe(playlistName);
    expect(requestBody.shuffle).toBe(false);
  });

  test("most played recently renders track cards", async ({
    authenticatedPage: page,
  }) => {
    const song = makeSong("recent-track", "Recently Played Track");

    await page.route("**/api/home*", async (route) => {
      await route.fulfill({
        json: {
          continueListening: { entries: [], total: 0 },
          mostPlayedRecently: { song: [song], total: 1 },
          recentlyAdded: { album: [], total: 0 },
          forgottenFavorites: { song: [], total: 0, seed: 1 },
          discover: { album: [], total: 0, seed: 1 },
        },
      });
    });
    await routeHomeSongSections(page, { mostPlayedRecently: [song] });

    await page.goto("/");

    const section = page.locator("section").filter({
      has: page.getByRole("heading", { name: /most played recently/i }),
    });

    await expect(
      section.getByRole("link", { name: song.title }).first(),
    ).toHaveAttribute(
      "href",
      `/library/albums/details?id=${song.albumId}&songId=${song.id}`,
    );
    await expect(section.getByText(song.artist).first()).toBeVisible();
  });

  test("section headings link to list pages", async ({
    authenticatedPage: page,
  }) => {
    const song = makeSong("recent-section-track", "Recent Section Track");

    await page.route("**/api/home*", async (route) => {
      await route.fulfill({
        json: {
          continueListening: { entries: [], total: 0 },
          mostPlayedRecently: { song: [song], total: 1 },
          recentlyAdded: { album: [], total: 0 },
          forgottenFavorites: { song: [], total: 0, seed: 1 },
          discover: { album: [], total: 0, seed: 1 },
        },
      });
    });
    await page.route("**/api/songs/forgotten-favorites*", async (route) => {
      await route.fulfill({
        json: {
          song: [],
          total: 0,
          seed: 1,
        },
      });
    });

    await page.route("**/api/songs/most-played-recently*", async (route) => {
      await route.fulfill({
        json: {
          song: [song],
          total: 1,
        },
      });
    });

    await page.goto("/");

    const headingLink = page.getByRole("link", {
      name: /most played recently/i,
    });
    await expect(headingLink).toHaveAttribute(
      "href",
      "/home/most-played-recently?days=30",
    );

    await headingLink.click();

    await expect(page).toHaveURL(/\/home\/most-played-recently\?days=30$/);
    await expect(
      page.getByRole("heading", { name: "Most Played Recently" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("song-row").filter({ hasText: song.title }),
    ).toBeVisible();
  });

  test("section list views expose filter sort and column controls", async ({
    authenticatedPage: page,
  }) => {
    const song = makeSong("recent-controls-track", "Recent Controls Track");

    await page.route("**/api/songs/most-played-recently*", async (route) => {
      await route.fulfill({
        json: {
          song: [song],
          total: 1,
        },
      });
    });

    await page.goto("/home/most-played-recently");

    await expect(
      page.getByRole("heading", { name: "Most Played Recently" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Toggle columns" }).click();
    const lastPlayedColumn = page.getByRole("menuitemcheckbox", {
      name: "Last Played",
    });
    await expect(lastPlayedColumn).toHaveAttribute("aria-checked", "false");
    await lastPlayedColumn.click();
    await expect(lastPlayedColumn).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    const filterRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/songs/most-played-recently" &&
        url.searchParams.get("filter") === "Recent"
      );
    });
    await page.getByRole("textbox", { name: "Filter items" }).fill("Recent");
    const filterRequest = await filterRequestPromise;
    const filterUrl = new URL(filterRequest.url());
    expect(filterUrl.searchParams.get("sort")).toBe("playCount");
    expect(filterUrl.searchParams.get("sortDir")).toBe("desc");

    const sortRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/songs/most-played-recently" &&
        url.searchParams.get("sort") === "artist" &&
        url.searchParams.get("sortDir") === "asc"
      );
    });
    await page.getByRole("button", { name: "Sort options" }).click();
    await page.getByRole("menuitem", { name: "Artist" }).click();
    await sortRequestPromise;
  });

  test("smart playlists and song radio entries navigate to the correct routes", async ({
    authenticatedPage: page,
  }) => {
    const smartPlaylistId = "smart-playlist-home";
    const smartPlaylistName = `Home Smart Playlist ${Date.now()}`;
    const seedSongId = "radio-seed";
    const seedSongTitle = `Radio Seed ${Date.now()}`;
    const radioName = `${seedSongTitle} Radio`;

    await page.route(`**/api/songs/${seedSongId}/similar*`, async (route) => {
      await route.fulfill({
        json: {
          songs: [
            makeSong("radio-similar-1", "Similar Song One"),
            makeSong("radio-similar-2", "Similar Song Two"),
          ],
        },
      });
    });

    await page.route(`**/api/songs/${seedSongId}`, async (route) => {
      await route.fulfill({
        json: {
          song: makeSong(seedSongId, seedSongTitle),
        },
      });
    });

    await page.route("**/api/home*", async (route) => {
      const response = await route.fetch();
      const homeResponse = (await response.json()) as {
        continueListening: { entries: unknown[]; total: number };
      };

      homeResponse.continueListening = {
        entries: [
          {
            type: "smartPlaylist",
            lastPlayed: "2024-01-03T00:00:00Z",
            album: null,
            playlist: {
              id: smartPlaylistId,
              name: smartPlaylistName,
              playlistType: "smartPlaylist",
              songCount: 7,
              duration: 1260,
              coverArt: null,
            },
            source: null,
          },
          {
            type: "songRadio",
            lastPlayed: "2024-01-04T00:00:00Z",
            album: null,
            playlist: null,
            source: {
              id: seedSongId,
              name: radioName,
              sourceType: "songRadio",
              coverArt: "test-album-id",
            },
          },
        ],
        total: 2,
      };

      await route.fulfill({ response, json: homeResponse });
    });
    await routeHomeSongSections(page);

    await page.goto("/library");
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /continue listening/i }),
    ).toBeVisible();

    const smartPlaylistLink = page
      .getByRole("link", { name: smartPlaylistName })
      .first();
    await expect(smartPlaylistLink).toHaveAttribute(
      "href",
      `/playlists/smart?id=${smartPlaylistId}`,
    );
    await page.goto(`/playlists/smart?id=${smartPlaylistId}`);
    await expect(page).toHaveURL(
      new RegExp(`/playlists/smart\\?id=${smartPlaylistId}$`),
    );

    await page.goto("/");

    const radioLink = page.getByRole("link", { name: radioName }).first();
    await expect(radioLink).toHaveAttribute(
      "href",
      `/radio/song?id=${seedSongId}`,
    );
    await page.goto(`/radio/song?id=${seedSongId}`);
    await expect(page).toHaveURL(new RegExp(`/radio/song\\?id=${seedSongId}$`));
    await expect(page.getByRole("heading", { name: radioName })).toBeVisible();
    await expect(
      page.getByText(`Based on ${seedSongTitle} by Test Artist`),
    ).toBeVisible();
  });

  test("virtual source entries link correctly and expose context menus", async ({
    authenticatedPage: page,
  }) => {
    await page.route("**/api/home*", async (route) => {
      await route.fulfill({
        json: {
          continueListening: {
            entries: [
              {
                type: "albumList",
                lastPlayed: "2024-01-05T00:00:00Z",
                album: null,
                playlist: null,
                source: {
                  id: "random",
                  name: "Discover Something New",
                  sourceType: "albumList",
                  coverArt: null,
                },
              },
              {
                type: "albumList",
                lastPlayed: "2024-01-04T00:00:00Z",
                album: null,
                playlist: null,
                source: {
                  id: "newest",
                  name: "Recently Added",
                  sourceType: "albumList",
                  coverArt: null,
                },
              },
              {
                type: "forgottenFavorites",
                lastPlayed: "2024-01-03T00:00:00Z",
                album: null,
                playlist: null,
                source: {
                  id: "forgottenFavorites",
                  name: "Forgotten Favorites",
                  sourceType: "forgottenFavorites",
                  coverArt: null,
                },
              },
              {
                type: "mostPlayedRecently",
                lastPlayed: "2024-01-02T00:00:00Z",
                album: null,
                playlist: null,
                source: {
                  id: "mostPlayedRecently",
                  name: "Most Played Recently",
                  sourceType: "mostPlayedRecently",
                  coverArt: null,
                },
              },
            ],
            total: 4,
          },
          mostPlayedRecently: { song: [], total: 0 },
          recentlyAdded: { album: [], total: 0 },
          forgottenFavorites: { song: [], total: 0, seed: 1 },
          discover: { album: [], total: 0, seed: 1 },
        },
      });
    });
    await routeHomeSongSections(page);

    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /continue listening/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Discover Something New" }).first(),
    ).toHaveAttribute("href", "/home/discover");
    await expect(
      page.getByRole("link", { name: "Recently Added" }).first(),
    ).toHaveAttribute("href", "/home/recently-added");
    await expect(
      page.getByRole("link", { name: "Forgotten Favorites" }).first(),
    ).toHaveAttribute("href", "/home/forgotten-favorites");
    await expect(
      page.getByRole("link", { name: "Most Played Recently" }).first(),
    ).toHaveAttribute("href", "/home/most-played-recently");

    const forgottenFavoritesCard = page
      .getByTestId("media-card")
      .filter({ hasText: "Forgotten Favorites" })
      .first();
    await expect(
      forgottenFavoritesCard.locator('[data-cover-type="forgottenFavorites"]'),
    ).toBeVisible();
    const contextMenu = await openContextMenu(page, forgottenFavoritesCard);

    await expect(
      contextMenu.getByRole("menuitem", { name: /^play$/i }),
    ).toBeVisible();
    await expect(
      contextMenu.getByRole("menuitem", { name: /shuffle/i }),
    ).toBeVisible();
    await expect(
      contextMenu.getByRole("menuitem", { name: /play next/i }),
    ).toBeVisible();
    await expect(
      contextMenu.getByRole("menuitem", { name: /add to queue/i }),
    ).toBeVisible();
  });
});
