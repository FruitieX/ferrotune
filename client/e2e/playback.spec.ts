/**
 * Playback tests - Player controls and queue behavior
 */

import {
  test,
  expect,
  playFirstSong,
  waitForPlayerReady,
  resetState,
} from "./fixtures";

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
