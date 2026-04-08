import { expect, test } from "./fixtures";

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

test.describe("Home continue listening", () => {
  test("smart playlists and song radio entries navigate to the correct routes", async ({
    authenticatedPage: page,
  }) => {
    const smartPlaylistId = "smart-playlist-home";
    const smartPlaylistName = `Home Smart Playlist ${Date.now()}`;
    const seedSongId = "radio-seed";
    const seedSongTitle = `Radio Seed ${Date.now()}`;
    const radioName = `${seedSongTitle} Radio`;

    await page.route(
      `**/ferrotune/songs/${seedSongId}/similar*`,
      async (route) => {
        await route.fulfill({
          json: {
            songs: [
              makeSong("radio-similar-1", "Similar Song One"),
              makeSong("radio-similar-2", "Similar Song Two"),
            ],
          },
        });
      },
    );

    await page.route(`**/ferrotune/songs/${seedSongId}`, async (route) => {
      await route.fulfill({
        json: {
          song: makeSong(seedSongId, seedSongTitle),
        },
      });
    });

    await page.route("**/ferrotune/home*", async (route) => {
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
});
