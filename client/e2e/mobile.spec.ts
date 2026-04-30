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
import type { Locator, Page } from "@playwright/test";

async function setServerPreference(page: Page, key: string, value: unknown) {
  await page.evaluate(
    async ({ preferenceKey, nextValue }) => {
      const connection = JSON.parse(
        localStorage.getItem("ferrotune-connection") || "null",
      );

      if (
        !connection?.serverUrl ||
        !connection.username ||
        !connection.password
      ) {
        throw new Error("Missing authenticated connection in localStorage");
      }

      const response = await fetch(
        `${connection.serverUrl.replace(/\/$/, "")}/ferrotune/preferences/${encodeURIComponent(preferenceKey)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${btoa(`${connection.username}:${connection.password}`)}`,
          },
          body: JSON.stringify({ value: nextValue }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to update '${preferenceKey}' preference: ${response.status}`,
        );
      }
    },
    { preferenceKey: key, nextValue: value },
  );
}

async function setQueuePanelPreference(page: Page, value: boolean) {
  await setServerPreference(page, "queue-panel-open", value);
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

async function openMobileAccountMenu(page: Page) {
  await page.locator("header").first().getByRole("button").first().click();
}

async function swipeQueueSheetClosed(page: Page, queueSheet: Locator) {
  const box = await queueSheet.boundingBox();
  if (!box) {
    throw new Error("Queue sheet bounding box was not available");
  }

  const startX = box.x + 32;
  const endX = box.x + box.width + 120;
  const y = box.y + 56;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 6 });
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

  test("tap reaches fullscreen player while queue gesture close animates", async ({
    authenticatedPage: page,
  }) => {
    await playFirstSong(page);
    await waitForPlayerReady(page);

    const playerBar = page.getByTestId("player-bar");
    await playerBar.getByRole("button", { name: /first song/i }).click();

    const fullscreenPlayer = page.locator('[data-fullscreen-player="true"]');
    await expect(fullscreenPlayer).toBeVisible({ timeout: 10000 });

    const closeButton = fullscreenPlayer.locator("button").first();
    const closeButtonBox = await closeButton.boundingBox();
    if (!closeButtonBox) {
      throw new Error("Fullscreen close button bounding box was not available");
    }

    await fullscreenPlayer.getByRole("button", { name: /^queue$/i }).click();

    const queueSheet = page.getByRole("dialog", { name: /queue/i });
    await expect(queueSheet).toBeVisible({ timeout: 10000 });

    await swipeQueueSheetClosed(page, queueSheet);
    await expect(queueSheet).toHaveAttribute("data-gesture-closing", "true");

    await page.mouse.click(
      closeButtonBox.x + closeButtonBox.width / 2,
      closeButtonBox.y + closeButtonBox.height / 2,
    );

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
