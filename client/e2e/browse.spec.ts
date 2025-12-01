import { test, expect } from "./fixtures";

test.describe("Browse Library", () => {
  test.describe("Library Page", () => {
    test("displays library page with tabs", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      
      // Wait for page to be fully loaded
      await page.waitForLoadState("networkidle");
      
      // Should show library heading
      await expect(page.getByRole("heading", { name: /library/i })).toBeVisible();
      
      // Should show tabs for albums, artists, genres
      await expect(page.getByRole("tab", { name: /albums/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /artists/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /genres/i })).toBeVisible();
    });

    test("albums tab is active by default", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("tab", { name: /albums/i })).toHaveAttribute("data-state", "active");
    });

    test("can switch between tabs", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForLoadState("networkidle");
      
      // Wait for albums tab to be visible first
      await expect(page.getByRole("tab", { name: /albums/i })).toBeVisible();
      
      // Click artists tab
      await page.getByRole("tab", { name: /artists/i }).click();
      await expect(page.getByRole("tab", { name: /artists/i })).toHaveAttribute("data-state", "active");
      
      // Click genres tab
      await page.getByRole("tab", { name: /genres/i }).click();
      await expect(page.getByRole("tab", { name: /genres/i })).toHaveAttribute("data-state", "active");
      
      // Back to albums
      await page.getByRole("tab", { name: /albums/i }).click();
      await expect(page.getByRole("tab", { name: /albums/i })).toHaveAttribute("data-state", "active");
    });
  });

  test.describe("Favorites", () => {
    test("favorites page shows tabs", async ({ authenticatedPage: page }) => {
      await page.goto("/favorites");
      await page.waitForLoadState("networkidle");
      
      // Should show heading
      await expect(page.getByRole("heading", { name: /liked songs/i })).toBeVisible();
      
      // Should show tabs
      await expect(page.getByRole("tab", { name: /songs/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /albums/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /artists/i })).toBeVisible();
    });

    test("can switch between favorite tabs", async ({ authenticatedPage: page }) => {
      await page.goto("/favorites");
      await page.waitForLoadState("networkidle");
      
      // Wait for songs tab to be visible first
      await expect(page.getByRole("tab", { name: /songs/i })).toBeVisible();
      
      // Click albums tab
      await page.getByRole("tab", { name: /albums/i }).click();
      await expect(page.getByRole("tab", { name: /albums/i })).toHaveAttribute("data-state", "active");
      
      // Click artists tab
      await page.getByRole("tab", { name: /artists/i }).click();
      await expect(page.getByRole("tab", { name: /artists/i })).toHaveAttribute("data-state", "active");
      
      // Click songs tab
      await page.getByRole("tab", { name: /songs/i }).click();
      await expect(page.getByRole("tab", { name: /songs/i })).toHaveAttribute("data-state", "active");
    });
  });

  test.describe("Navigation", () => {
    test("sidebar navigation to library works", async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      
      // Click library link in sidebar - wait for it to be stable
      const libraryLink = page.getByRole("link", { name: /library/i }).first();
      await expect(libraryLink).toBeVisible();
      await libraryLink.click();
      await expect(page).toHaveURL("/library");
    });

    // Skip on mobile since sidebar is collapsed and navigation works differently
    test("sidebar navigation to favorites works", async ({ authenticatedPage: page }, testInfo) => {
      // On mobile, use direct navigation instead of sidebar
      if (testInfo.project.name === "mobile-chrome") {
        await page.goto("/favorites");
        await expect(page).toHaveURL("/favorites");
        return;
      }
      
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      
      // Click favorites link in sidebar - wait for it to be stable
      const favoritesLink = page.getByRole("link", { name: /favorites|liked/i }).first();
      await expect(favoritesLink).toBeVisible();
      await favoritesLink.click();
      await expect(page).toHaveURL("/favorites");
    });
  });

  test.describe("Genre Details", () => {
    test("can navigate to genre detail page", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForLoadState("networkidle");
      
      // Click genres tab
      await page.getByRole("tab", { name: /genres/i }).click();
      await expect(page.getByRole("tab", { name: /genres/i })).toHaveAttribute("data-state", "active");
      
      // Wait for genres to load and click the first one
      const genreCard = page.locator('a[href^="/library/genres/details"]').first();
      await expect(genreCard).toBeVisible({ timeout: 10000 });
      await genreCard.click();
      
      // Should navigate to genre details page
      await expect(page).toHaveURL(/\/library\/genres\/details/);
    });

    test("genre detail page shows header and albums", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForLoadState("networkidle");
      
      // Click genres tab
      await page.getByRole("tab", { name: /genres/i }).click();
      
      // Get the first genre link and its text
      const genreCard = page.locator('a[href^="/library/genres/details"]').first();
      await expect(genreCard).toBeVisible({ timeout: 10000 });
      await genreCard.click();
      
      // Should show genre header
      await expect(page.getByText("Genre", { exact: true })).toBeVisible();
      
      // Should show Albums section
      await expect(page.getByRole("heading", { name: "Albums" })).toBeVisible();
      
      // Should show Play and Shuffle buttons in the action bar (not player bar)
      // Use more specific locator - first play button in page (before player bar)
      const actionButtons = page.locator('.sticky button');
      await expect(actionButtons.filter({ hasText: "Play" }).first()).toBeVisible();
      await expect(actionButtons.filter({ hasText: "Shuffle" }).first()).toBeVisible();
    });

    test("genre detail page has view mode toggle", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForLoadState("networkidle");
      
      // Click genres tab
      await page.getByRole("tab", { name: /genres/i }).click();
      
      // Navigate to a genre
      const genreCard = page.locator('a[href^="/library/genres/details"]').first();
      await expect(genreCard).toBeVisible({ timeout: 10000 });
      await genreCard.click();
      
      // Should have grid and list view buttons in the action bar
      // These are in the sticky header
      const stickyHeader = page.locator('.sticky').first();
      await expect(stickyHeader.locator('button').filter({ has: page.locator('[class*="lucide-grid"]') })).toBeVisible({ timeout: 5000 });
    });
  });
});
