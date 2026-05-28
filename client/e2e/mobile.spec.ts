/**
 * Mobile-specific E2E tests.
 *
 * This file contains a curated subset of tests that verify mobile-specific behavior:
 * - Responsive layout
 * - Bottom navigation
 * - Queue sheet (vs sidebar on desktop)
 * - Touch interactions
 *
 * These are the ONLY tests that run on mobile-chrome project.
 */

import {
  test,
  expect,
  login,
  waitForPlayerReady,
  playFirstSong,
} from "./fixtures";
import { setServerPreference } from "./app-helpers";
import type { Locator, Page } from "@playwright/test";

async function setQueuePanelPreference(page: Page, value: boolean) {
  await setServerPreference(page, "queue-panel-open", value);
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

interface FeedbackSnapshot {
  backgroundColor: string;
  borderColor: string;
  boxShadow: string;
  filter: string;
  scale: string;
  transform: string;
}

async function getFeedbackSnapshot(
  locator: Locator,
): Promise<FeedbackSnapshot> {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);

    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      filter: style.filter,
      scale: style.scale,
      transform: style.transform,
    };
  });
}

function hasFeedbackChange(
  before: FeedbackSnapshot,
  after: FeedbackSnapshot,
): boolean {
  return (
    before.backgroundColor !== after.backgroundColor ||
    before.borderColor !== after.borderColor ||
    before.boxShadow !== after.boxShadow ||
    before.filter !== after.filter ||
    before.scale !== after.scale ||
    before.transform !== after.transform
  );
}

async function expectPressedFeedback(
  page: Page,
  locator: Locator,
): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 10000 });

  const before = await getFeedbackSnapshot(locator);
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Pressed feedback target bounding box was not available");
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  try {
    await expect
      .poll(
        async () =>
          hasFeedbackChange(before, await getFeedbackSnapshot(locator)),
        { timeout: 3000 },
      )
      .toBe(true);
  } finally {
    await page.mouse.up();
  }
}

async function addSecondarySavedAccount(page: Page) {
  await page.evaluate(() => {
    const connection = JSON.parse(
      localStorage.getItem("ferrotune-connection") || "null",
    );

    if (!connection) {
      throw new Error("Missing active connection in localStorage");
    }

    localStorage.setItem(
      "ferrotune-saved-accounts",
      JSON.stringify([
        connection,
        {
          ...connection,
          serverUrl: `${connection.serverUrl}/`,
          label: "Secondary account",
        },
      ]),
    );
  });
}

async function mockCastSdkAvailable(page: Page) {
  await page.route("**/cast_sender.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        (() => {
          const castState = {
            NO_DEVICES_AVAILABLE: "NO_DEVICES_AVAILABLE",
            NOT_CONNECTED: "NOT_CONNECTED",
            CONNECTING: "CONNECTING",
            CONNECTED: "CONNECTED"
          };
          const context = {
            setOptions() {},
            getCastState() {
              return castState.NOT_CONNECTED;
            },
            addEventListener() {},
            removeEventListener() {},
            getCurrentSession() {
              return null;
            },
            requestSession() {
              window.__ferrotuneCastRequested = true;
              return Promise.resolve();
            }
          };

          window.chrome = {
            cast: {
              AutoJoinPolicy: { ORIGIN_SCOPED: "ORIGIN_SCOPED" },
              media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "default-receiver" }
            }
          };
          window.cast = {
            framework: {
              CastState: castState,
              SessionState: {
                SESSION_ENDED: "SESSION_ENDED",
                NO_SESSION: "NO_SESSION"
              },
              CastContextEventType: {
                CAST_STATE_CHANGED: "CAST_STATE_CHANGED",
                SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED"
              },
              CastContext: {
                getInstance() {
                  return context;
                }
              }
            }
          };

          window.__onGCastApiAvailable?.(true);
        })();
      `,
    });
  });
}

async function openMobileAccountMenu(page: Page) {
  await page.locator("header").first().getByRole("button").first().click();
}

async function swipeQueueSheetClosed(page: Page, queueSheet: Locator) {
  const dragClosed = async () => {
    const box = await queueSheet.boundingBox();
    if (!box) {
      throw new Error("Queue sheet bounding box was not available");
    }

    const startX = box.x + 32;
    const endX = box.x + box.width + Math.max(120, box.width / 2);
    const y = box.y + 56;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 10 });
    await page.mouse.up();
  };

  await dragClosed();

  if (
    (await queueSheet.isVisible().catch(() => false)) &&
    (await queueSheet.getAttribute("data-gesture-closing")) !== "true"
  ) {
    await dragClosed();
  }
}

async function swipePlayerBarFullscreenOpen(page: Page, playerBar: Locator) {
  const box = await playerBar.boundingBox();
  if (!box) {
    throw new Error("Player bar bounding box was not available");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endY = Math.max(8, startY - Math.max(180, box.height * 2));

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 12 });
  await page.mouse.up();
}

async function swipePlayerBarFullscreenOpenThenCancel(
  page: Page,
  playerBar: Locator,
) {
  const box = await playerBar.boundingBox();
  if (!box) {
    throw new Error("Player bar bounding box was not available");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const sideDragX = startX - 64;
  const openPreviewY = Math.max(8, startY - Math.max(240, box.height * 3));
  const cancelY = Math.min(startY + 48, box.y + box.height + 48);
  const swipeTarget = playerBar.getByTestId("now-playing-swipe-target");
  const swipeTargetBox = await swipeTarget.boundingBox();
  if (!swipeTargetBox) {
    throw new Error("Now playing swipe target bounding box was not available");
  }
  const initialTargetX = swipeTargetBox.x;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(sideDragX, startY + 4, { steps: 4 });
  await page.mouse.move(sideDragX, openPreviewY, { steps: 12 });
  await expect
    .poll(
      async () => {
        const currentBox = await swipeTarget.boundingBox();
        return Math.abs((currentBox?.x ?? initialTargetX) - initialTargetX);
      },
      { timeout: 10000 },
    )
    .toBeLessThan(8);
  await page.mouse.move(sideDragX - 72, openPreviewY + 8, { steps: 4 });
  await expect
    .poll(
      async () => {
        const currentBox = await swipeTarget.boundingBox();
        return Math.abs((currentBox?.x ?? initialTargetX) - initialTargetX);
      },
      { timeout: 10000 },
    )
    .toBeLessThan(8);
  await page.mouse.move(sideDragX, cancelY, { steps: 12 });
  await page.mouse.up();
}

async function waitForFullscreenPlayerSettled(fullscreenPlayer: Locator) {
  const closeButton = fullscreenPlayer.getByRole("button", {
    name: /close fullscreen player/i,
  });

  await expect(closeButton).toBeVisible({ timeout: 10000 });
  await expect
    .poll(
      async () => {
        const box = await fullscreenPlayer.boundingBox();
        return Math.abs(box?.y ?? Number.POSITIVE_INFINITY);
      },
      { timeout: 10000 },
    )
    .toBeLessThan(8);
  await expect
    .poll(
      async () => {
        const box = await closeButton.boundingBox();
        return box?.y ?? Number.POSITIVE_INFINITY;
      },
      { timeout: 10000 },
    )
    .toBeLessThan(160);
}

async function swipeFullscreenDownFromAlbumArt(page: Page, albumArt: Locator) {
  const box = await albumArt.boundingBox();
  if (!box) {
    throw new Error("Fullscreen album art bounding box was not available");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endY = Math.min(
    startY + Math.max(180, box.height / 2),
    box.y + box.height - 8,
  );

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 12 });
  await page.mouse.up();
}

async function swipeFullscreenDownAfterAlbumArtSideDrag(
  page: Page,
  fullscreenPlayer: Locator,
  albumArt: Locator,
) {
  const box = await albumArt.boundingBox();
  if (!box) {
    throw new Error("Fullscreen album art bounding box was not available");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const sideDragX = startX - 44;
  const endY = Math.min(
    startY + Math.max(200, box.height / 2),
    box.y + box.height - 8,
  );

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(sideDragX, startY + 8, { steps: 4 });
  await page.mouse.move(sideDragX, endY, { steps: 12 });
  await page.mouse.up();

  const releaseBox = await fullscreenPlayer.boundingBox();
  const backdrop = page.getByTestId("fullscreen-backdrop");
  const backdropStyle = await backdrop.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      opacity: Number.parseFloat(style.opacity),
      backdropFilter: style.backdropFilter,
    };
  });
  const viewportHeight = page.viewportSize()?.height ?? 0;

  return {
    releaseSheetY: releaseBox?.y ?? viewportHeight,
    releaseBackdropOpacity: backdropStyle.opacity,
    releaseBackdropFilter: backdropStyle.backdropFilter,
    viewportHeight,
  };
}

async function dragAlbumArtSideThenDownThenUp(
  page: Page,
  fullscreenPlayer: Locator,
  albumArt: Locator,
) {
  const sheetBox = await fullscreenPlayer.boundingBox();
  const artBox = await albumArt.boundingBox();
  if (!sheetBox || !artBox) {
    throw new Error(
      "Fullscreen player or album art bounding box was not available",
    );
  }

  const startX = artBox.x + artBox.width / 2;
  const startY = artBox.y + artBox.height / 2;
  const sideDragX = startX - 72;
  const afterRestSideDragX = sideDragX - 96;
  const downY = Math.min(startY + 84, artBox.y + artBox.height - 8);
  const upY = startY + 28;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(sideDragX, startY + 4, { steps: 4 });

  const artSideBox = await albumArt.boundingBox();

  await page.mouse.move(sideDragX, downY, { steps: 10 });

  const sheetDownBox = await fullscreenPlayer.boundingBox();
  const artDownBox = await albumArt.boundingBox();

  await expect
    .poll(
      async () => {
        const currentBox = await albumArt.boundingBox();
        return Math.abs((currentBox?.x ?? artBox.x) - artBox.x);
      },
      { timeout: 10000 },
    )
    .toBeLessThan(8);

  const artRestBox = await albumArt.boundingBox();

  await page.mouse.move(afterRestSideDragX, downY + 8, { steps: 4 });

  await expect
    .poll(
      async () => {
        const currentBox = await albumArt.boundingBox();
        return Math.abs((currentBox?.x ?? artBox.x) - artBox.x);
      },
      { timeout: 10000 },
    )
    .toBeLessThan(8);

  const artAfterRestSideBox = await albumArt.boundingBox();

  await page.mouse.move(afterRestSideDragX, upY, { steps: 10 });

  const sheetUpBox = await fullscreenPlayer.boundingBox();
  const artUpBox = await albumArt.boundingBox();

  await page.mouse.up();

  return {
    initialSheetY: sheetBox.y,
    sheetDownY: sheetDownBox?.y ?? sheetBox.y,
    sheetUpY: sheetUpBox?.y ?? sheetBox.y,
    initialArtX: artBox.x,
    artSideX: artSideBox?.x ?? artBox.x,
    artDownX: artDownBox?.x ?? artBox.x,
    artRestX: artRestBox?.x ?? artBox.x,
    artAfterRestSideX: artAfterRestSideBox?.x ?? artBox.x,
    artUpX: artUpBox?.x ?? artBox.x,
  };
}

async function dragAlbumArtPastHorizontalLimit(page: Page, albumArt: Locator) {
  const box = await albumArt.boundingBox();
  if (!box) {
    throw new Error("Fullscreen album art bounding box was not available");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const farPastNextX = startX - box.width * 2.5;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(farPastNextX, startY, { steps: 12 });

  const draggedBox = await albumArt.boundingBox();
  await page.mouse.up();

  return {
    initialX: box.x,
    draggedX: draggedBox?.x ?? box.x,
    maxExpectedDistance: box.width + 40,
  };
}

async function swipeFullscreenClosed(page: Page, fullscreenPlayer: Locator) {
  const box = await fullscreenPlayer.boundingBox();
  if (!box) {
    throw new Error("Fullscreen player bounding box was not available");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + 96;
  const endY = Math.min(box.y + box.height - 8, startY + 260);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 12 });
  await page.mouse.up();
}

test.describe("Mobile Tests", () => {
  test("can login with valid credentials", async ({ page, server }) => {
    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    await expect(page).toHaveURL("/");
    await expect(page.locator("h1:has-text('Home')").first()).toBeVisible();
  });

  test("native resume repaint hook responds on normal screens", async ({
    page,
    server,
  }) => {
    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    const initialToken = await page.evaluate(
      () => document.documentElement.dataset.lastResumeRepaintToken ?? "",
    );

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("ferrotune:native-app-resume"));
    });

    await page.waitForFunction(
      (previousToken) =>
        (document.documentElement.dataset.lastResumeRepaintToken ?? "") !==
        previousToken,
      initialToken,
    );

    await page.waitForFunction(
      () => !document.documentElement.hasAttribute("data-app-resume-repaint"),
    );
    await expect(page.locator("h1:has-text('Home')").first()).toBeVisible();
  });

  test("bottom navigation to library works", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    // Mobile uses bottom nav bar
    const bottomNav = page.getByTestId("mobile-nav");
    await expect(bottomNav).toBeVisible();

    // Dismiss any toasts that might be overlaying the nav
    const toast = page.locator("[data-sonner-toast]");
    if (await toast.isVisible().catch(() => false)) {
      await toast.click({ force: true });
    }

    const libraryNavLink = bottomNav.locator('a[href="/library"]').first();
    await expect(libraryNavLink).toBeAttached();
    await libraryNavLink.evaluate((element) => {
      (element as HTMLAnchorElement).click();
    });
    await expect(page).toHaveURL(/\/library/);
  });

  test("player bar shows controls on mobile", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toBeVisible();

    // Play/pause should be visible
    const playPauseButton = playerBar
      .getByRole("button", { name: /play|pause/i })
      .first();
    await expect(playPauseButton).toBeVisible();
  });

  test("shared interactive surfaces show pressed feedback on mobile", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");

    const bottomNav = page.getByTestId("mobile-nav");
    const searchNavLink = bottomNav.locator('a[href="/search"]').first();
    await expectPressedFeedback(page, searchNavLink);
    await expect(page).toHaveURL(/\/search/);

    await page.goto("/library/songs");
    await expectPressedFeedback(
      page,
      page.getByRole("button", { name: /view options/i }),
    );
    await page.getByRole("button", { name: /^list$/i }).click();

    const songRow = page
      .locator('[data-testid="song-row"], [data-testid="media-row"]')
      .first();
    await expectPressedFeedback(page, songRow);

    await page.goto("/library/albums");
    await page.getByRole("button", { name: /view options/i }).click();
    await page.getByRole("button", { name: /^grid$/i }).click();

    const albumCard = page.locator('[data-testid="media-card"]').first();
    await expectPressedFeedback(page, albumCard);
  });

  test("hides progress seek overlay after touch tap", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const progressSlider = page
      .getByTestId("player-bar")
      .getByRole("slider", { name: "Playback progress" });
    await expectProgressTimeOverlayOpacity(page, 0);
    await progressSlider.tap({ position: { x: 120, y: 8 } });
    await expectProgressTimeOverlayOpacity(page, 0);
  });

  test("player overflow shows Cast when a receiver is available", async ({
    page,
    server,
  }) => {
    await mockCastSdkAvailable(page);
    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toBeVisible();

    await playerBar.getByRole("button", { name: /more options/i }).click();
    await expect(
      page.getByRole("button", { name: /cast to device/i }),
    ).toBeVisible();
  });

  test("queue opens as sheet on mobile", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // On mobile, queue is in the more menu
    const playerBar = page.getByTestId("player-bar");
    const moreButton = playerBar.getByRole("button", { name: /more options/i });
    await moreButton.click();

    // Click queue in the popover menu
    const queueButton = page.getByRole("button", { name: /queue/i });
    await queueButton.click();

    // Mobile uses a sheet/dialog, not sidebar
    const queueSheet = page.getByRole("dialog", { name: /queue/i });
    await expect(queueSheet).toBeVisible({ timeout: 10000 });

    // Verify queue has content
    await expect(queueSheet.getByText("First Song")).toBeVisible();

    // Close the queue to avoid polluting subsequent tests via server preferences
    await page.keyboard.press("Escape");
    await expect(queueSheet).not.toBeVisible();
  });

  test("home header extends behind the safe area inset", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-top", "24px");
    });

    const header = page.locator("header").first();
    await expect(header).toBeVisible();

    const metrics = await header.evaluate((element) => {
      const content = element.firstElementChild;
      if (!(content instanceof HTMLElement)) {
        throw new Error("Missing home header content");
      }

      const headerBox = element.getBoundingClientRect();
      const contentBox = content.getBoundingClientRect();
      const contentStyle = window.getComputedStyle(content);

      return {
        headerTop: Math.round(headerBox.top),
        contentHeight: Math.round(contentBox.height),
        contentPaddingTop: contentStyle.paddingTop,
      };
    });

    expect(metrics.headerTop).toBe(0);
    expect(metrics.contentHeight).toBeGreaterThanOrEqual(88);
    expect(metrics.contentPaddingTop).toBe("24px");
  });

  test("closing queue keeps fullscreen player open on mobile", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });

    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });

    await fullscreenPlayer.getByRole("button", { name: /^queue$/i }).click();

    const queueSheet = page.getByRole("dialog", { name: /queue/i });
    await expect(queueSheet).toBeVisible({ timeout: 10000 });

    await queueSheet.getByRole("button", { name: /close queue/i }).click();

    await expect(queueSheet).not.toBeVisible({ timeout: 10000 });
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
  });

  test("swiping queue closed keeps fullscreen player open on mobile", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });

    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });

    await fullscreenPlayer.getByRole("button", { name: /^queue$/i }).click();

    const queueSheet = page.getByRole("dialog", { name: /queue/i });
    await expect(queueSheet).toBeVisible({ timeout: 10000 });

    await swipeQueueSheetClosed(page, queueSheet);

    await expect(queueSheet).not.toBeVisible({ timeout: 10000 });
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
  });

  test("swiping player bar up opens fullscreen player", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });

    await swipePlayerBarFullscreenOpen(page, playerBar);

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await expect(fullscreenPlayer).toHaveAttribute(
      "data-fullscreen-gesture-phase",
      "open",
    );
    await expect(
      fullscreenPlayer.getByRole("button", { name: /^queue$/i }),
    ).toBeVisible();
  });

  test("dragging player bar back down cancels fullscreen open", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });

    await swipePlayerBarFullscreenOpenThenCancel(page, playerBar);

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("fullscreen-backdrop")).not.toBeVisible();

    await playerBar.getByRole("button", { name: /first song/i }).click();
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);
    await fullscreenPlayer
      .getByRole("button", { name: /close fullscreen player/i })
      .click();
    await expect(fullscreenPlayer).not.toBeVisible({ timeout: 10000 });

    const searchNavLink = page
      .getByTestId("mobile-nav")
      .locator('a[href="/search"]')
      .first();
    await expect(searchNavLink).toBeVisible();
    await searchNavLink.tap();
    await expect(page).toHaveURL(/\/search/);
  });

  test("swiping fullscreen down closes and hides it", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);

    await swipeFullscreenClosed(page, fullscreenPlayer);

    await expect(fullscreenPlayer).not.toBeVisible({ timeout: 10000 });
    await expect(
      fullscreenPlayer.getByRole("button", {
        name: /close fullscreen player/i,
      }),
    ).not.toBeVisible();
    await expect(
      fullscreenPlayer.getByRole("button", { name: /^queue$/i }),
    ).not.toBeVisible();
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
  });

  test("album art vertical swipe closes fullscreen without skipping", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);

    await swipeFullscreenDownFromAlbumArt(
      page,
      fullscreenPlayer.getByTestId("fullscreen-album-art"),
    );

    await expect(fullscreenPlayer).not.toBeVisible({ timeout: 10000 });
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
  });

  test("album art diagonal close releases fullscreen backdrop", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);

    const releaseState = await swipeFullscreenDownAfterAlbumArtSideDrag(
      page,
      fullscreenPlayer,
      fullscreenPlayer.getByTestId("fullscreen-album-art"),
    );

    expect(releaseState.releaseSheetY).toBeLessThan(
      releaseState.viewportHeight - 80,
    );
    expect(releaseState.releaseBackdropOpacity).toBeGreaterThan(0);
    expect(releaseState.releaseBackdropFilter).not.toBe("none");

    await expect(fullscreenPlayer).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("fullscreen-backdrop")).not.toBeVisible();

    const searchNavLink = page
      .getByTestId("mobile-nav")
      .locator('a[href="/search"]')
      .first();
    await expect(searchNavLink).toBeVisible();
    await searchNavLink.tap();
    await expect(page).toHaveURL(/\/search/);
  });

  test("album art side drag hands off to vertical sheet drag", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);

    const positions = await dragAlbumArtSideThenDownThenUp(
      page,
      fullscreenPlayer,
      fullscreenPlayer.getByTestId("fullscreen-album-art"),
    );

    expect(positions.sheetDownY).toBeGreaterThan(positions.initialSheetY + 32);
    expect(positions.sheetUpY).toBeLessThan(positions.sheetDownY - 24);
    const sideDelta = Math.abs(positions.artSideX - positions.initialArtX);
    const downDelta = Math.abs(positions.artDownX - positions.initialArtX);
    const restDelta = Math.abs(positions.artRestX - positions.initialArtX);
    const afterRestSideDelta = Math.abs(
      positions.artAfterRestSideX - positions.initialArtX,
    );
    const upDelta = Math.abs(positions.artUpX - positions.initialArtX);
    expect(sideDelta).toBeGreaterThan(24);
    expect(downDelta).toBeLessThanOrEqual(sideDelta + 8);
    expect(restDelta).toBeLessThan(8);
    expect(afterRestSideDelta).toBeLessThan(8);
    expect(upDelta).toBeLessThanOrEqual(sideDelta + 8);

    await expect
      .poll(
        async () => {
          const box = await fullscreenPlayer
            .getByTestId("fullscreen-album-art")
            .boundingBox();
          return Math.abs(
            (box?.x ?? positions.initialArtX) - positions.initialArtX,
          );
        },
        { timeout: 10000 },
      )
      .toBeLessThan(8);

    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);
    await swipeFullscreenDownFromAlbumArt(
      page,
      fullscreenPlayer.getByTestId("fullscreen-album-art"),
    );
    await expect(fullscreenPlayer).not.toBeVisible({ timeout: 10000 });
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
  });

  test("album art horizontal swipe stops at adjacent track position", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await expect(playerBar).toContainText("First Song", { timeout: 10000 });
    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);

    const dragState = await dragAlbumArtPastHorizontalLimit(
      page,
      fullscreenPlayer.getByTestId("fullscreen-album-art"),
    );

    expect(
      Math.abs(dragState.draggedX - dragState.initialX),
    ).toBeLessThanOrEqual(dragState.maxExpectedDistance);
  });

  test("tap reaches fullscreen player while queue gesture close animates", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);

    const closeButton = fullscreenPlayer.getByRole("button", {
      name: /close fullscreen player/i,
    });

    await fullscreenPlayer.getByRole("button", { name: /^queue$/i }).click();

    const queueSheet = page.getByRole("dialog", { name: /queue/i });
    await expect(queueSheet).toBeVisible({ timeout: 10000 });

    await swipeQueueSheetClosed(page, queueSheet);
    await expect(queueSheet).toHaveAttribute("data-gesture-closing", "true");

    await closeButton.tap();

    await expect(fullscreenPlayer).not.toBeVisible({ timeout: 10000 });
  });

  test("first tap after queue swipe close reaches fullscreen", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });
    await waitForFullscreenPlayerSettled(fullscreenPlayer);

    const closeButton = fullscreenPlayer.getByRole("button", {
      name: /close fullscreen player/i,
    });

    await fullscreenPlayer.getByRole("button", { name: /^queue$/i }).click();
    const queueSheet = page.getByRole("dialog", { name: /queue/i });
    await expect(queueSheet).toBeVisible({ timeout: 10000 });

    await swipeQueueSheetClosed(page, queueSheet);
    await expect(queueSheet).not.toBeVisible({ timeout: 10000 });

    await closeButton.tap();

    await expect(fullscreenPlayer).not.toBeVisible({ timeout: 10000 });
  });

  test("account switch keeps queue sheet hidden on mobile mount", async ({
    authenticatedPage: page,
  }) => {
    await addSecondarySavedAccount(page);
    await setQueuePanelPreference(page, true);
    await page.reload();

    await expect(page.getByRole("dialog", { name: /queue/i })).not.toBeVisible({
      timeout: 10000,
    });

    await openMobileAccountMenu(page);
    await page.getByText("Secondary account", { exact: true }).click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const connection = JSON.parse(
            localStorage.getItem("ferrotune-connection") || "null",
          );
          return connection?.serverUrl || "";
        }),
      )
      .toMatch(/\/$/);

    await expect(page.getByRole("dialog", { name: /queue/i })).not.toBeVisible({
      timeout: 10000,
    });

    await setQueuePanelPreference(page, false);
  });

  test("server column preferences do not override mobile column defaults", async ({
    authenticatedPage: page,
  }) => {
    await setServerPreference(page, "column-visibility", {
      trackNumber: true,
      artist: true,
      album: true,
      duration: true,
      playCount: true,
      dateAdded: true,
      lastPlayed: true,
      year: true,
      starred: true,
      genre: true,
      bitRate: true,
      format: true,
      rating: true,
    });

    await page.goto("/library/songs");

    const moreOptionsButton = page.getByRole("button", {
      name: /view options/i,
    });
    await moreOptionsButton.click();

    await page.getByRole("button", { name: /^list$/i }).click();

    await moreOptionsButton.click();
    await page.getByRole("button", { name: /^columns$/i }).click();

    const playCountColumn = page.getByRole("button", {
      name: /^play count$/i,
    });
    await expect(playCountColumn).toBeVisible();
    await expect(playCountColumn.locator("svg")).toHaveCount(0);
  });

  test("search page is accessible", async ({ authenticatedPage: page }) => {
    await page.goto("/search");

    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });

  test("settings header protects the safe area", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/settings");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-top", "24px");
    });

    const header = page.locator("header", { hasText: "Settings" }).first();
    await expect(header).toBeVisible();

    const metrics = await header.evaluate((element) => {
      const content = element.firstElementChild;
      if (!(content instanceof HTMLElement)) {
        throw new Error("Missing settings header content");
      }

      const headerBox = element.getBoundingClientRect();
      const contentStyle = window.getComputedStyle(content);

      return {
        headerTop: Math.round(headerBox.top),
        contentPaddingTop: contentStyle.paddingTop,
      };
    });

    expect(metrics.headerTop).toBe(0);
    expect(metrics.contentPaddingTop).toBe("40px");
  });

  test("can navigate to album detail", async ({ authenticatedPage: page }) => {
    await page.goto("/library/albums");

    // Dismiss any overlays that might be open (e.g., queue panel from server preferences)
    const queueDialog = page.getByRole("dialog", { name: /queue/i });
    if (await queueDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
      await expect(queueDialog).not.toBeVisible();
    }

    // On mobile, open the view options menu and switch to grid view
    const moreOptionsButton = page.getByRole("button", {
      name: /view options/i,
    });
    await moreOptionsButton.click();
    const gridMenuItem = page.getByRole("button", { name: /^grid$/i });
    await gridMenuItem.click();

    // Click album from either grid card view or list/link view
    const albumCard = page.locator('[data-testid="media-card"]').first();
    const albumLink = page
      .locator("a")
      .filter({ hasText: /^Test Album/ })
      .first();

    const hasAlbumCard = await albumCard
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    if (hasAlbumCard) {
      await albumCard.click();
    } else {
      await expect(albumLink).toBeVisible({ timeout: 10000 });
      await albumLink.click();
    }

    await expect(page).toHaveURL(/\/library\/albums\/details/);
  });

  test("can use song dropdown via long press or more button", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/songs");

    // On mobile, the list view button is hidden behind the overflow menu
    // Open the mobile overflow menu and click on "List"
    const moreOptionsButton = page.getByRole("button", {
      name: /view options/i,
    });
    await moreOptionsButton.click();

    // Click on List view option in the drawer
    const listMenuItem = page.getByRole("button", { name: /^list$/i });
    await listMenuItem.click();

    const songRow = page
      .locator('[data-testid="song-row"], [data-testid="media-row"]')
      .first();
    await expect(songRow).toBeVisible({ timeout: 10000 });

    // On mobile, try using context menu (long press simulation via right click)
    await songRow.click({ button: "right" });

    // On mobile, the context menu opens as a bottom drawer
    const drawer = page.locator("[data-vaul-drawer]");
    if (await drawer.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(
        page.locator("button", { hasText: /^play$/i }),
      ).toBeVisible();
    }
  });

  test("can star a song", async ({ authenticatedPage: page }) => {
    await page.goto("/library/albums");
    const albumLink = page
      .locator("a")
      .filter({ hasText: /^Test Album/ })
      .first();
    await expect(albumLink).toBeVisible({ timeout: 10000 });
    await albumLink.click();

    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    // Disable CSS animations: the drawer/context menu animations cause Playwright
    // to wait for stability, during which a React re-render detaches the DOM nodes.
    await page.addStyleTag({
      content:
        "*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }",
    });

    const firstSongRow = page.locator('[data-testid="song-row"]').first();

    // Right-click to open context menu (on mobile, opens as a drawer)
    await firstSongRow.click({ button: "right" });

    // On mobile, the context menu opens as a bottom drawer
    const drawer = page.locator("[data-vaul-drawer]");
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Star via drawer menu
    const starItem = page.locator("button", {
      hasText: /add to favorites/i,
    });
    await starItem.click();

    // Verify the drawer closed (star action succeeded)
    await expect(drawer).not.toBeVisible({ timeout: 10000 });
  });

  test("playlist page is accessible", async ({ authenticatedPage: page }) => {
    await page.goto("/playlists");

    await expect(
      page.getByRole("heading", { name: "Playlists", exact: true }),
    ).toBeVisible();
  });

  test("tagger page loads", async ({ authenticatedPage: page }) => {
    await page.goto("/tagger");

    // Tagger should show heading
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });
  });
});
