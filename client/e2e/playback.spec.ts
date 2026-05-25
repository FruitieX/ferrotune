/**
 * Playback tests - Player controls and queue behavior
 */

import type { Page } from "@playwright/test";
import {
  test,
  expect,
  playFirstSong,
  playTestAlbumSong,
  waitForPlayerReady,
  resetState,
} from "./fixtures";
import { setDocumentVisibility } from "./page-visibility";
import { setServerPreference, waitForAuthenticatedHome } from "./app-helpers";

interface AudioPlaybackSnapshot {
  isPlaying: boolean;
  maxCurrentTime: number;
  visibilityState: DocumentVisibilityState;
}

async function getAudioPlaybackSnapshot(
  page: Page,
): Promise<AudioPlaybackSnapshot> {
  return page.evaluate(() => {
    const loadedAudioElements = Array.from(
      document.querySelectorAll("audio"),
    ).filter((audio) => audio.currentSrc !== "" || audio.src !== "");

    return {
      isPlaying: loadedAudioElements.some(
        (audio) => !audio.paused && !audio.ended,
      ),
      maxCurrentTime: loadedAudioElements.reduce(
        (maxTime, audio) => Math.max(maxTime, audio.currentTime),
        0,
      ),
      visibilityState: document.visibilityState,
    };
  });
}

async function getDisplayedCurrentTime(page: Page): Promise<number> {
  const timeText = await page
    .getByTestId("player-bar")
    .getByTestId("progress-current-duration")
    .first()
    .textContent();
  if (!timeText) return 0;

  return parseDurationText(timeText.split("/")[0] ?? "");
}

function parseDurationText(value: string): number {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;

  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

async function getDisplayedDuration(page: Page): Promise<string> {
  const timeText =
    (await page
      .getByTestId("player-bar")
      .getByTestId("progress-current-duration")
      .first()
      .textContent()) ?? "";
  return (timeText.split("/")[1] ?? "").trim();
}

async function waitForServerPreference(
  page: Page,
  key: string,
  value: unknown,
): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(
        ({ preferenceKey, expectedValue }) => {
          type ServerStorageStateForTest = {
            __ferrotuneServerStorageState?: {
              loadedAccounts: Set<string>;
              valueCacheByAccount: Map<string, Map<string, unknown>>;
            };
          };

          const storageState = (window as Window & ServerStorageStateForTest)
            .__ferrotuneServerStorageState;

          if (!storageState) {
            return false;
          }

          for (const [
            account,
            valueCache,
          ] of storageState.valueCacheByAccount) {
            if (
              storageState.loadedAccounts.has(account) &&
              valueCache.get(preferenceKey) === expectedValue
            ) {
              return true;
            }
          }

          return false;
        },
        { preferenceKey: key, expectedValue: value },
      ),
    )
    .toBe(true);
}

async function getProgressTimeOverlayOpacity(page: Page): Promise<number> {
  return page
    .getByTestId("player-bar")
    .getByTestId("progress-time-overlay")
    .first()
    .evaluate((element) =>
      Number.parseFloat(window.getComputedStyle(element).opacity),
    );
}

async function expectProgressTimeOverlayOpacity(
  page: Page,
  expectedOpacity: number,
): Promise<void> {
  await expect
    .poll(() => getProgressTimeOverlayOpacity(page), { timeout: 5000 })
    .toBe(expectedOpacity);
}

async function forceActiveAudioDurationChangeToInfinity(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const audio = Array.from(document.querySelectorAll("audio")).find(
      (element) => element.currentSrc !== "" || element.src !== "",
    );

    if (!audio) {
      throw new Error("No active audio element found");
    }

    Object.defineProperty(audio, "duration", {
      configurable: true,
      get: () => Number.POSITIVE_INFINITY,
    });
    audio.dispatchEvent(new Event("durationchange"));
  });
}

test.describe("Playback", () => {
  // Reset all server state before each test for isolation
  test.beforeEach(async ({ authenticatedPage: page, server }) => {
    await resetState(page, server);
    // Reload to ensure fresh state is loaded
    await page.reload();
  });

  test("player bar has all controls and can play/pause", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toBeVisible();

    // Check for core controls
    await expect(
      playerBar.getByRole("button", { name: /play|pause/i }).first(),
    ).toBeVisible();
    await expect(
      playerBar.getByRole("button", { name: /next/i }),
    ).toBeVisible();
    await expect(
      playerBar.getByRole("button", { name: /previous/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /queue/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /mute|unmute/i }).first(),
    ).toBeVisible();
  });

  test("can play album and skip between tracks", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song");

    // Skip to next
    await playerBar.getByRole("button", { name: /next/i }).click();
    await expect(playerBar).toContainText("Second Song");

    // Skip to next again
    await playerBar.getByRole("button", { name: /next/i }).click();
    await expect(playerBar).toContainText("Third Song");

    // Skip previous
    await playerBar.getByRole("button", { name: /previous/i }).click();
    await expect(playerBar).toContainText("Second Song");
  });

  test("direct streams keep the stored song duration in the player", async ({
    authenticatedPage: page,
  }) => {
    await setServerPreference(page, "transcodingEnabled", false);
    await page.reload();
    await waitForAuthenticatedHome(page);
    await waitForServerPreference(page, "transcodingEnabled", false);

    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song");
    await expect.poll(async () => getDisplayedDuration(page)).toBe("0:03");
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const audio = Array.from(document.querySelectorAll("audio")).find(
            (element) => element.currentSrc !== "" || element.src !== "",
          );
          return audio?.currentSrc || audio?.src || "";
        }),
      )
      .toContain("/api/stream");

    const streamUrl = await page.evaluate(() => {
      const audio = Array.from(document.querySelectorAll("audio")).find(
        (element) => element.currentSrc !== "" || element.src !== "",
      );
      return audio?.currentSrc || audio?.src || "";
    });
    expect(streamUrl).not.toContain("format=opus");

    await forceActiveAudioDurationChangeToInfinity(page);
    await expect.poll(async () => getDisplayedDuration(page)).toBe("0:03");
  });

  test("can configure current and total duration label visibility", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    const progressSlider = playerBar.getByRole("slider", {
      name: "Playback progress",
    });

    await expect(
      playerBar.getByTestId("progress-current-duration"),
    ).toHaveCount(1);
    await expectProgressTimeOverlayOpacity(page, 0);

    await progressSlider.hover();
    await expectProgressTimeOverlayOpacity(page, 1);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    const labelVisibilitySetting = page.getByTestId(
      "progress-time-label-visibility-setting",
    );
    await expect(labelVisibilitySetting).toBeVisible();

    await labelVisibilitySetting
      .getByRole("button", { name: "Always" })
      .click();
    await waitForServerPreference(
      page,
      "progress-time-label-visibility",
      "always",
    );
    await expectProgressTimeOverlayOpacity(page, 1);

    await labelVisibilitySetting.getByRole("button", { name: "Never" }).click();
    await waitForServerPreference(
      page,
      "progress-time-label-visibility",
      "never",
    );
    await expect(
      page.getByTestId("player-bar").getByTestId("progress-current-duration"),
    ).toHaveCount(0);
    await expectProgressTimeOverlayOpacity(page, 0);

    await labelVisibilitySetting
      .getByRole("button", { name: "On hover" })
      .click();
    await waitForServerPreference(
      page,
      "progress-time-label-visibility",
      "hover",
    );
    await expect(
      page.getByTestId("player-bar").getByTestId("progress-current-duration"),
    ).toHaveCount(1);
    await expectProgressTimeOverlayOpacity(page, 0);

    await page
      .getByTestId("player-bar")
      .getByRole("slider", { name: "Playback progress" })
      .hover();
    await expectProgressTimeOverlayOpacity(page, 1);
  });

  test("keeps playing after switching to another browser tab and back", async ({
    authenticatedPage: page,
  }) => {
    await test.step("Start a longer track", async () => {
      await playTestAlbumSong(page, 2);
      await waitForPlayerReady(page);

      const playerBar = page.getByTestId("player-bar");
      await expect(playerBar).toContainText("Third Song");
      await expect(
        playerBar.getByRole("button", { name: "Pause" }).first(),
      ).toBeVisible({ timeout: 10000 });
      await expect
        .poll(async () => (await getAudioPlaybackSnapshot(page)).isPlaying)
        .toBe(true);
    });

    await test.step("Simulate background and restore visibility", async () => {
      await setDocumentVisibility(page, "hidden");
      await expect
        .poll(
          async () => (await getAudioPlaybackSnapshot(page)).visibilityState,
        )
        .toBe("hidden");

      await setDocumentVisibility(page, "visible");
      await expect
        .poll(
          async () => (await getAudioPlaybackSnapshot(page)).visibilityState,
        )
        .toBe("visible");
    });

    await test.step("Verify playback is still advancing", async () => {
      const timeAfterRestore = (await getAudioPlaybackSnapshot(page))
        .maxCurrentTime;

      await expect
        .poll(async () => {
          const snapshot = await getAudioPlaybackSnapshot(page);
          return (
            snapshot.isPlaying &&
            snapshot.maxCurrentTime > timeAfterRestore + 0.25
          );
        })
        .toBe(true);

      await expect(
        page
          .getByTestId("player-bar")
          .getByRole("button", { name: "Pause" })
          .first(),
      ).toBeVisible();
    });
  });

  test("queue end shows 'Not playing' and can restart", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");

    // Skip through all tracks
    await expect(playerBar).toContainText("First Song");
    await playerBar.getByRole("button", { name: /next/i }).click();
    await expect(playerBar).toContainText("Second Song");
    await playerBar.getByRole("button", { name: /next/i }).click();
    await expect(playerBar).toContainText("Third Song");
    await expect
      .poll(() => getDisplayedCurrentTime(page), { timeout: 10000 })
      .toBeGreaterThan(0);
    await playerBar.getByRole("button", { name: /next/i }).click();

    // Queue ended
    await expect(playerBar).toContainText("Not playing");

    // Click play to restart
    await playerBar.getByRole("button", { name: /play/i }).click();
    await expect(playerBar).toContainText("First Song");
  });

  test("repeat mode advances track on next click", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song");

    // Enable repeat one (click twice: off -> all -> one)
    const repeatButton = playerBar.getByRole("button", { name: /repeat/i });
    await repeatButton.click();
    await repeatButton.click();

    // Click next - should still advance (repeat one only loops on natural end)
    await playerBar.getByRole("button", { name: /next/i }).click();
    await expect(playerBar).toContainText("Second Song");
  });
});
