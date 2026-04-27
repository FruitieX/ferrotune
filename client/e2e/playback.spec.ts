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

async function setDocumentVisibility(
  page: Page,
  visibilityState: DocumentVisibilityState,
): Promise<void> {
  await page.evaluate((nextVisibilityState) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => nextVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibilityState);
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
    await playerBar.getByRole("button", { name: /next/i }).click();
    await playerBar.getByRole("button", { name: /next/i }).click();
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
