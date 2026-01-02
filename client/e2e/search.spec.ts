/**
 * Search tests - Search functionality
 */

import { test, expect } from "./fixtures";

test.describe("Search", () => {
  test("search finds results and updates URL", async ({
    authenticatedPage: page,
  }) => {
    // First get an artist name from the library
    await page.goto("/library/artists");
    const artistCard = page.locator('[data-testid="media-card"]').first();
    await expect(artistCard).toBeVisible({ timeout: 10000 });
    const artistName = await page
      .locator("h3")
      .filter({ hasText: /\w+/ })
      .first()
      .textContent();

    // Search for the artist
    await page.goto("/search");
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill(artistName!.trim());

    await page.waitForTimeout(1500); // Wait for debounce

    // URL should contain query
    expect(page.url()).toContain("q=");

    // Should show matching result
    const result = page.getByText(artistName!.trim()).first();
    await expect(result).toBeVisible();
  });

  test("search query populates from URL", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/search?q=preloaded");

    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toHaveValue("preloaded");
  });
});
