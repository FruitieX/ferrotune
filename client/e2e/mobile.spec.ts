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
    const bottomNav = page.locator("nav").filter({
      has: page.getByRole("link", { name: /library/i }),
    });
    await expect(bottomNav).toBeVisible();

    // Dismiss any toasts that might be overlaying the nav
    const toast = page.locator("[data-sonner-toast]");
    if (await toast.isVisible().catch(() => false)) {
      await toast.click({ force: true });
    }

    // Use force click in case toast is still animating out
    await bottomNav
      .getByRole("link", { name: /library/i })
      .click({ force: true });
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
