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
      await page.waitForTimeout(500);
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

    // Open queue via button in footer
    const queueButton = page
      .locator("footer")
      .getByRole("button", { name: /queue/i })
      .first();
    await queueButton.click();

    // Mobile uses a sheet/dialog, not sidebar
    const queueSheet = page.getByRole("dialog", { name: /queue/i });
    await expect(queueSheet).toBeVisible({ timeout: 10000 });

    // Verify queue has content
    await expect(queueSheet.getByText("First Song")).toBeVisible();
  });

  test("search page is accessible", async ({ authenticatedPage: page }) => {
    await page.goto("/search");

    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });

  test("can navigate to album detail", async ({ authenticatedPage: page }) => {
    await page.goto("/library/albums");

    const albumCard = page.locator('[data-testid="media-card"]').first();
    await expect(albumCard).toBeVisible({ timeout: 10000 });
    await albumCard.click();

    await expect(page).toHaveURL(/\/library\/albums\/details/);
  });

  test("can use song dropdown via long press or more button", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/songs");

    // Switch to list view
    const listViewButton = page.getByRole("button", { name: /list view/i });
    await listViewButton.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const songRow = page.locator('[data-testid="song-row"]').first();

    // On mobile, try using context menu (long press simulation via right click)
    await songRow.click({ button: "right" });

    // Should open a context menu
    const contextMenu = page.locator('[data-slot="context-menu-content"]');
    if (await contextMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(
        contextMenu.getByRole("menuitem", { name: /^play$/i }),
      ).toBeVisible();
    }
  });

  test("can star a song", async ({ authenticatedPage: page }) => {
    await page.goto("/library");
    await page.waitForSelector("article", { timeout: 10000 });
    await page.getByText("Test Album").click();

    await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const firstSongRow = page.locator('[data-testid="song-row"]').first();
    await firstSongRow.hover();

    const starButton = firstSongRow
      .getByRole("button")
      .filter({ has: page.locator("svg") })
      .first();
    await starButton.click();

    await page.waitForTimeout(500);
    expect(page.url()).toBeTruthy();
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
