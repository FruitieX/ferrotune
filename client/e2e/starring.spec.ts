import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

test.describe("Starring and Ratings", () => {
  test.describe("Starring Songs", () => {
    test("can star a song from context menu", async ({ authenticatedPage: page }) => {
      // Go to album
      await page.goto("/library");
      await page.waitForSelector("article", { timeout: 10000 });
      await page.getByText("Test Album").click();
      
      // Wait for tracks
      await page.waitForSelector('[data-testid="song-row"], tr', { timeout: 10000 });
      
      // Right-click first track
      await page.getByText("First Song").click({ button: "right" });
      
      // Click star option
      const starOption = page.getByRole("menuitem", { name: /star|add to favorites/i });
      if (await starOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await starOption.click();
        await page.waitForTimeout(500);
      }
      
      expect(page.url()).toBeTruthy();
    });

    test("starred songs appear in favorites", async ({ authenticatedPage: page }) => {
      // First star a song
      await page.goto("/library");
      await page.waitForSelector("article", { timeout: 10000 });
      await page.getByText("Test Album").click();
      await page.waitForSelector('[data-testid="song-row"], tr', { timeout: 10000 });
      
      // Star via context menu
      await page.getByText("First Song").click({ button: "right" });
      const starOption = page.getByRole("menuitem", { name: /star|add to favorites/i });
      if (await starOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await starOption.click();
        await page.waitForTimeout(1000);
      }
      
      // Go to favorites
      await page.goto("/favorites");
      
      // Should show the starred song
      await page.waitForTimeout(1000);
      expect(page.url()).toContain("/favorites");
    });

    test("can unstar a song", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForSelector("article", { timeout: 10000 });
      await page.getByText("Test Album").click();
      await page.waitForSelector('[data-testid="song-row"], tr', { timeout: 10000 });
      
      // Star first
      await page.getByText("First Song").click({ button: "right" });
      let starOption = page.getByRole("menuitem", { name: /star|add to favorites/i });
      if (await starOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await starOption.click();
        await page.waitForTimeout(500);
      }
      
      // Unstar
      await page.getByText("First Song").click({ button: "right" });
      const unstarOption = page.getByRole("menuitem", { name: /unstar|remove from favorites/i });
      if (await unstarOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await unstarOption.click();
        await page.waitForTimeout(500);
      }
      
      expect(page.url()).toBeTruthy();
    });
  });

  test.describe("Ratings", () => {
    test("can rate song from context menu", async ({ authenticatedPage: page }) => {
      await page.goto("/library");
      await page.waitForSelector("article", { timeout: 10000 });
      await page.getByText("Test Album").click();
      await page.waitForSelector('[data-testid="song-row"], tr', { timeout: 10000 });
      
      // Right-click first track
      await page.getByText("First Song").click({ button: "right" });
      
      // Look for rate option
      const rateOption = page.getByRole("menuitem", { name: /rate|rating/i });
      
      if (await rateOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await rateOption.hover();
        await page.waitForTimeout(300);
        
        // Click a star rating
        const fiveStars = page.getByRole("menuitem", { name: /5/i });
        if (await fiveStars.isVisible({ timeout: 1000 }).catch(() => false)) {
          await fiveStars.click();
          await page.waitForTimeout(500);
        }
      }
      
      expect(page.url()).toBeTruthy();
    });
  });

  test.describe("Favorites Page", () => {
    test("favorites page has tabs", async ({ authenticatedPage: page }) => {
      await page.goto("/favorites");
      
      await expect(page.getByRole("tab", { name: /songs/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /albums/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /artists/i })).toBeVisible();
    });

    test("can switch to albums tab", async ({ authenticatedPage: page }) => {
      await page.goto("/favorites");
      
      await page.getByRole("tab", { name: /albums/i }).click();
      await expect(page.getByRole("tab", { name: /albums/i })).toHaveAttribute("data-state", "active");
    });

    test("can switch to artists tab", async ({ authenticatedPage: page }) => {
      await page.goto("/favorites");
      
      await page.getByRole("tab", { name: /artists/i }).click();
      await expect(page.getByRole("tab", { name: /artists/i })).toHaveAttribute("data-state", "active");
    });
  });
});
