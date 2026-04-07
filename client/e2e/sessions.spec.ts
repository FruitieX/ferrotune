/**
 * Multi-session tests — two browser windows controlling the same session.
 *
 * Tests verify:
 * - Owner tab plays audio, follower tab shows the same track
 * - Toggle shuffle / repeat from either tab does NOT restart playback
 * - Volume change in follower tab is reflected on owner tab
 * - Session switching basics
 */

import { expect, Page, BrowserContext } from "@playwright/test";
import {
  test,
  playFirstSong,
  waitForPlayerReady,
  resetState,
  ServerInfo,
} from "./fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a second authenticated browser context + page pointing at the same
 * Ferrotune server.  Returns the fully-logged-in page.
 */
async function createSecondTab(
  browser: import("@playwright/test").Browser,
  server: ServerInfo,
  baseURL: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Navigate and inject auth (both connection and saved accounts for dropdown)
  await page.goto("/");
  await page.evaluate(
    ({ serverUrl, username, password }) => {
      const conn = { serverUrl, username, password };
      localStorage.setItem("ferrotune-connection", JSON.stringify(conn));
      localStorage.setItem("ferrotune-saved-accounts", JSON.stringify([conn]));
    },
    {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    },
  );
  await page.reload();
  await expect(page.locator("h1:has-text('Home')").first()).toBeVisible({
    timeout: 15000,
  });
  return { context, page };
}

/**
 * Get the playback progress (current time in seconds) shown in the player bar.
 * Returns 0 if not found.
 */
async function getDisplayedCurrentTime(page: Page): Promise<number> {
  // The time is shown as "M:SS" text in the player bar
  const timeText = await page
    .locator('[data-testid="player-bar"]')
    .locator("span.tabular-nums")
    .first()
    .textContent();
  if (!timeText) return 0;
  const parts = timeText.trim().split(":");
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return 0;
}

async function sendTakeoverCommand(
  page: Page,
  options?: { resumePlayback?: boolean },
): Promise<void> {
  await page.evaluate(async ({ resumePlayback }) => {
    const connection = JSON.parse(
      localStorage.getItem("ferrotune-connection") || "null",
    );
    const sessionId = JSON.parse(
      sessionStorage.getItem("ferrotune-session-id") || "null",
    );
    const clientId = JSON.parse(
      sessionStorage.getItem("ferrotune-client-id") || "null",
    );

    if (
      !connection?.serverUrl ||
      !connection.username ||
      !connection.password
    ) {
      throw new Error("Missing authenticated connection in localStorage");
    }

    if (!sessionId || !clientId) {
      throw new Error("Missing session or client id in sessionStorage");
    }

    const response = await fetch(
      `${connection.serverUrl.replace(/\/$/, "")}/ferrotune/sessions/${encodeURIComponent(sessionId)}/command`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${connection.username}:${connection.password}`)}`,
        },
        body: JSON.stringify({
          action: "takeOver",
          clientId,
          clientName: "ferrotune-web",
          ...(resumePlayback !== undefined ? { resumePlayback } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Takeover command failed: ${response.status}`);
    }
  }, options ?? {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe.serial("Multi-Session Playback", () => {
  test.beforeEach(async ({ authenticatedPage: page, server }) => {
    await resetState(page, server);
    // Ensure saved accounts are set so the session dropdown renders
    await page.evaluate(
      ({ serverUrl, username, password }) => {
        const existing = localStorage.getItem("ferrotune-saved-accounts");
        if (!existing || existing === "[]") {
          localStorage.setItem(
            "ferrotune-saved-accounts",
            JSON.stringify([{ serverUrl, username, password }]),
          );
        }
      },
      {
        serverUrl: server.url,
        username: server.username,
        password: server.password,
      },
    );
    await page.reload();
  });

  test("queue metadata changes (shuffle, repeat) do not restart playback on owner", async ({
    authenticatedPage: page,
  }) => {
    // Start playback on the owner tab
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");

    // Wait for playback to start, then IMMEDIATELY pause to freeze position
    const pauseBtn = playerBar.getByRole("button", { name: "Pause" }).first();
    await expect(pauseBtn).toBeVisible({ timeout: 10000 });
    await pauseBtn.click();

    const playBtn = playerBar.getByRole("button", { name: "Play" }).first();
    await expect(playBtn).toBeVisible({ timeout: 5000 });

    // Capture time while paused
    const timeBeforeShuffle = await getDisplayedCurrentTime(page);

    // Toggle shuffle - should NOT restart or affect paused state
    const shuffleBtn = playerBar.getByRole("button", { name: "Shuffle" });
    await shuffleBtn.click();
    await page.waitForTimeout(1000);

    const timeAfterShuffle = await getDisplayedCurrentTime(page);
    expect(timeAfterShuffle).toBe(timeBeforeShuffle);
    await expect(playBtn).toBeVisible({ timeout: 5000 });

    // Toggle repeat - should also NOT restart or affect paused state
    const repeatBtn = playerBar.getByRole("button", { name: "Repeat" });
    await repeatBtn.click();
    await page.waitForTimeout(1000);

    const timeAfterRepeat = await getDisplayedCurrentTime(page);
    expect(timeAfterRepeat).toBe(timeBeforeShuffle);
    await expect(playBtn).toBeVisible({ timeout: 5000 });

    // Resume playback — should continue from where it was
    await playBtn.click();
    await expect(pauseBtn).toBeVisible({ timeout: 5000 });
  });

  test("follower can see owner playback state and control play/pause", async ({
    authenticatedPage: ownerPage,
    server,
    browser,
  }) => {
    // Start playback on owner and immediately pause to avoid short test songs
    // from finishing before follower is ready
    await playFirstSong(ownerPage);
    await waitForPlayerReady(ownerPage);

    const ownerBar = ownerPage.getByTestId("player-bar");
    const ownerPauseBtn = ownerBar
      .getByRole("button", { name: "Pause" })
      .first();
    await expect(ownerPauseBtn).toBeVisible({ timeout: 10000 });
    await ownerPauseBtn.click();
    await expect(
      ownerBar.getByRole("button", { name: "Play" }).first(),
    ).toBeVisible({ timeout: 5000 });

    // Create a second tab (follower)
    const baseURL =
      ownerPage.url().split("/")[0] + "//" + ownerPage.url().split("/")[2];
    const { context: followerCtx, page: followerPage } = await createSecondTab(
      browser,
      server,
      baseURL,
    );

    try {
      // Follower auto-joins the owner's session — wait for queue to load
      const followerBar = followerPage.getByTestId("player-bar");
      await expect(followerBar).toContainText(/Song/, { timeout: 15000 });

      // Follower should show Play button (since owner is paused)
      const followerPlayBtn = followerBar
        .getByRole("button", { name: "Play" })
        .first();
      await expect(followerPlayBtn).toBeVisible({ timeout: 10000 });

      // Resume from follower
      await followerPlayBtn.click();

      // Owner should resume (show Pause button)
      await expect(ownerPauseBtn).toBeVisible({ timeout: 10000 });

      // Follower should also show Pause now
      const followerPauseBtn = followerBar
        .getByRole("button", { name: "Pause" })
        .first();
      await expect(followerPauseBtn).toBeVisible({ timeout: 10000 });

      // Pause from follower
      await followerPauseBtn.click();

      // Owner should be paused again
      await expect(
        ownerBar.getByRole("button", { name: "Play" }).first(),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await followerCtx.close();
    }
  });

  test("takeover without explicit resume signal stays paused", async ({
    authenticatedPage: ownerPage,
    server,
    browser,
  }) => {
    await playFirstSong(ownerPage);
    await waitForPlayerReady(ownerPage);

    const ownerBar = ownerPage.getByTestId("player-bar");
    const baseURL =
      ownerPage.url().split("/")[0] + "//" + ownerPage.url().split("/")[2];
    const { context: followerCtx, page: followerPage } = await createSecondTab(
      browser,
      server,
      baseURL,
    );

    try {
      const followerBar = followerPage.getByTestId("player-bar");
      await expect(followerBar).toContainText(/Song/, { timeout: 15000 });

      const followerPauseBtn = followerBar
        .getByRole("button", { name: "Pause" })
        .first();
      await expect(followerPauseBtn).toBeVisible({ timeout: 10000 });

      // Give the follower tab a user gesture so a later unexpected play()
      // call is not hidden by autoplay policy.
      await followerBar.click({ position: { x: 10, y: 10 } });

      let blockedPauseHeartbeat = false;
      await ownerPage.route(
        "**/ferrotune/sessions/**/heartbeat*",
        async (route) => {
          const request = route.request();
          let payload: unknown;

          try {
            payload = request.postDataJSON();
          } catch {
            payload = null;
          }

          if (
            !blockedPauseHeartbeat &&
            request.method() === "POST" &&
            payload &&
            typeof payload === "object" &&
            "isPlaying" in payload &&
            (payload as { isPlaying?: boolean }).isPlaying === false
          ) {
            blockedPauseHeartbeat = true;
            await route.abort();
            return;
          }

          await route.continue();
        },
      );

      await ownerBar.getByRole("button", { name: "Pause" }).first().click();
      await expect.poll(() => blockedPauseHeartbeat).toBe(true);
      await expect(
        ownerBar.getByRole("button", { name: "Play" }).first(),
      ).toBeVisible({ timeout: 10000 });

      // The follower never received the pause heartbeat, so it still thinks
      // the remote owner is playing.
      await expect(followerPauseBtn).toBeVisible({ timeout: 5000 });

      // Simulate an ownership change with no explicit resume request.
      await sendTakeoverCommand(followerPage);

      await expect(
        followerBar.getByRole("button", { name: "Play" }).first(),
      ).toBeVisible({ timeout: 10000 });
      await expect
        .poll(async () => {
          return await followerPage.evaluate(() =>
            Array.from(document.querySelectorAll("audio")).every(
              (audio) => audio.paused,
            ),
          );
        })
        .toBe(true);
    } finally {
      await followerCtx.close();
    }
  });

  test("follower shuffle/repeat do not restart owner playback", async ({
    authenticatedPage: ownerPage,
    server,
    browser,
  }) => {
    // Start playback on owner and immediately pause to avoid songs finishing
    await playFirstSong(ownerPage);
    await waitForPlayerReady(ownerPage);

    const ownerBar = ownerPage.getByTestId("player-bar");
    await ownerBar.getByRole("button", { name: "Pause" }).first().click();
    await expect(
      ownerBar.getByRole("button", { name: "Play" }).first(),
    ).toBeVisible({ timeout: 5000 });

    // Capture time while paused
    const ownerTimeBefore = await getDisplayedCurrentTime(ownerPage);

    // Create follower
    const baseURL =
      ownerPage.url().split("/")[0] + "//" + ownerPage.url().split("/")[2];
    const { context: followerCtx, page: followerPage } = await createSecondTab(
      browser,
      server,
      baseURL,
    );

    try {
      // Follower auto-joins the owner's session — wait for queue to load
      const followerBar = followerPage.getByTestId("player-bar");
      await expect(followerBar).toContainText(/Song/, { timeout: 15000 });

      // Toggle shuffle from FOLLOWER
      const shuffleBtn = followerBar.getByRole("button", { name: "Shuffle" });
      await shuffleBtn.click();
      await ownerPage.waitForTimeout(1000);

      // Owner should still be at the same position, still paused
      const ownerTimeAfterShuffle = await getDisplayedCurrentTime(ownerPage);
      expect(ownerTimeAfterShuffle).toBe(ownerTimeBefore);
      await expect(
        ownerBar.getByRole("button", { name: "Play" }).first(),
      ).toBeVisible({ timeout: 5000 });

      // Toggle repeat from FOLLOWER
      const repeatBtn = followerBar.getByRole("button", { name: "Repeat" });
      await repeatBtn.click();
      await ownerPage.waitForTimeout(1000);

      const ownerTimeAfterRepeat = await getDisplayedCurrentTime(ownerPage);
      expect(ownerTimeAfterRepeat).toBe(ownerTimeBefore);
      await expect(
        ownerBar.getByRole("button", { name: "Play" }).first(),
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await followerCtx.close();
    }
  });

  test("follower volume change affects owner playback", async ({
    authenticatedPage: ownerPage,
    server,
    browser,
  }) => {
    // Start playback on owner and immediately pause
    await playFirstSong(ownerPage);
    await waitForPlayerReady(ownerPage);

    const ownerBar = ownerPage.getByTestId("player-bar");
    await ownerBar.getByRole("button", { name: "Pause" }).first().click();
    await expect(
      ownerBar.getByRole("button", { name: "Play" }).first(),
    ).toBeVisible({ timeout: 5000 });

    // Create follower
    const baseURL =
      ownerPage.url().split("/")[0] + "//" + ownerPage.url().split("/")[2];
    const { context: followerCtx, page: followerPage } = await createSecondTab(
      browser,
      server,
      baseURL,
    );

    try {
      // Follower auto-joins the owner's session — wait for queue to load
      const followerBar = followerPage.getByTestId("player-bar");
      await expect(followerBar).toContainText(/Song/, { timeout: 15000 });

      // Mute from follower
      const muteBtn = followerBar
        .getByRole("button", { name: /volume|mute/i })
        .first();
      await muteBtn.click();

      // Owner should now be muted too
      await expect(
        ownerBar.getByRole("button", { name: /unmute/i }).first(),
      ).toBeVisible({ timeout: 10000 });

      // Unmute from follower
      const unmuteBtn = followerBar
        .getByRole("button", { name: /unmute/i })
        .first();
      await unmuteBtn.click();

      // Owner should be unmuted
      await expect(
        ownerBar.getByRole("button", { name: /volume|mute/i }).first(),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await followerCtx.close();
    }
  });

  test("queue add/remove does not restart playback on owner", async ({
    authenticatedPage: page,
  }) => {
    // Start playback and pause immediately to freeze position
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    const pauseBtn = playerBar.getByRole("button", { name: "Pause" }).first();
    await expect(pauseBtn).toBeVisible({ timeout: 10000 });
    await pauseBtn.click();

    const playBtn = playerBar.getByRole("button", { name: "Play" }).first();
    await expect(playBtn).toBeVisible({ timeout: 5000 });

    const timeBeforeAdd = await getDisplayedCurrentTime(page);

    // Navigate to songs library and add a song to queue via context menu
    await page.goto("/library/songs");
    const listViewButton = page.getByRole("button", { name: /list view/i });
    await expect(listViewButton).toBeVisible({ timeout: 10000 });
    await listViewButton.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const songRow = page.locator('[data-testid="song-row"]').first();
    await songRow.click({ button: "right" });
    const contextMenu = page.locator('[data-slot="context-menu-content"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    await contextMenu.getByRole("menuitem", { name: /add to queue/i }).click();

    // Wait for the queue to update
    await page.waitForTimeout(1500);

    // Should still be paused and at approximately the same time (allow 1s drift from pause delay)
    const timeAfterAdd = await getDisplayedCurrentTime(page);
    expect(Math.abs(timeAfterAdd - timeBeforeAdd)).toBeLessThanOrEqual(1);
    await expect(playBtn).toBeVisible({ timeout: 5000 });

    // Now open the queue panel and remove a non-current song
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();
    await expect(
      page.getByRole("heading", { name: "Queue", exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Right-click a non-current song in the queue to remove it
    // Find a queue item that is NOT the currently playing track
    const queueItems = page.locator('[data-testid="queue-item"]');
    const queueItemCount = await queueItems.count();

    if (queueItemCount > 1) {
      // Click the last queue item's context menu
      const lastItem = queueItems.last();
      await lastItem.click({ button: "right" });
      const queueContextMenu = page.locator(
        '[data-slot="context-menu-content"]',
      );
      const removeOption = queueContextMenu.getByRole("menuitem", {
        name: /remove from queue/i,
      });
      if (await removeOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await removeOption.click();
        await page.waitForTimeout(1500);

        // Should still be paused and at approximately the same time
        const timeAfterRemove = await getDisplayedCurrentTime(page);
        expect(Math.abs(timeAfterRemove - timeBeforeAdd)).toBeLessThanOrEqual(
          1,
        );
        await expect(playBtn).toBeVisible({ timeout: 5000 });
      }
    }

    // Resume playback — should continue from where it was
    await playBtn.click();
    await expect(pauseBtn).toBeVisible({ timeout: 5000 });
  });
});
