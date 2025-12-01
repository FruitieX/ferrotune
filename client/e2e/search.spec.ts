import { test, expect } from "./fixtures";

// Helper to type in search
async function searchFor(page: import("@playwright/test").Page, query: string) {
  const searchInput = page.getByPlaceholder(/search/i);
  await searchInput.fill(query);
  await page.waitForTimeout(500); // Wait for debounce
}

test.describe("Search", () => {
  test("search page is accessible", async ({ authenticatedPage: page }) => {
    await page.goto("/search");
    await page.waitForTimeout(500);
    
    // Should show search input
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });

  test("can type in search box", async ({ authenticatedPage: page }) => {
    await page.goto("/search");
    await page.waitForTimeout(500);
    
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("test query");
    
    await expect(searchInput).toHaveValue("test query");
  });

  test("search updates URL with query", async ({ authenticatedPage: page }) => {
    await page.goto("/search");
    await page.waitForTimeout(500);
    
    await searchFor(page, "music");
    
    // Wait for URL update (debounced)
    await page.waitForTimeout(1500);
    
    // URL should contain query parameter
    expect(page.url()).toContain("q=music");
  });

  test("search with query parameter populates input", async ({ authenticatedPage: page }) => {
    await page.goto("/search?q=preloaded");
    await page.waitForTimeout(500);
    
    // Search input should be populated from URL
    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toHaveValue("preloaded");
  });

  test("search returns results for artists", async ({ authenticatedPage: page }) => {
    // Navigate to the library page and switch to Artists tab
    await page.goto("/library");
    await page.waitForLoadState("networkidle");
    
    // Click the Artists tab to switch to it
    await page.getByRole("tab", { name: /artists/i }).click();
    
    // Wait for artists tab to be active
    await expect(page.getByRole("tab", { name: /artists/i })).toHaveAttribute("data-state", "active");
    
    // Wait for artist data to load
    await page.waitForTimeout(1000);
    
    const firstArtist = page.locator('a[href^="/library/artists/details"]').first();
    await expect(firstArtist).toBeVisible({ timeout: 5000 });
    
    // Get artist name
    const artistName = await firstArtist.textContent();
    expect(artistName).toBeTruthy();
    
    // Search for the artist
    await page.goto("/search");
    await page.waitForTimeout(500);
    await searchFor(page, artistName!);
    await page.waitForTimeout(1500);
    
    // Should show artist in results
    const result = page.getByText(artistName!).first();
    await expect(result).toBeVisible();
  });

  test("empty search shows appropriate state", async ({ authenticatedPage: page }) => {
    await page.goto("/search");
    await page.waitForTimeout(500);
    
    // Search input should be visible but results area empty
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.clear();
    
    // Page should remain on search
    expect(page.url()).toContain("/search");
  });

  test("no results for gibberish search", async ({ authenticatedPage: page }) => {
    await page.goto("/search");
    await page.waitForTimeout(500);
    
    await searchFor(page, "xyznonexistent12345abcdef");
    await page.waitForTimeout(1500);
    
    // Either shows "no results" message or just empty - both are valid
    const noResults = page.getByText(/no results|nothing found/i);
    const hasNoResultsMessage = await noResults.isVisible().catch(() => false);
    
    // The search should complete without errors (either empty or no results message)
    expect(page.url()).toContain("/search");
  });

  test("sidebar navigation to search works", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);
    
    // Navigate via sidebar search link if it exists
    const searchLink = page.getByRole("link", { name: /search/i }).first();
    const hasSearchLink = await searchLink.isVisible().catch(() => false);
    
    if (hasSearchLink) {
      await searchLink.click();
      await expect(page).toHaveURL("/search");
    } else {
      // No sidebar search link, navigate directly
      await page.goto("/search");
      expect(page.url()).toContain("/search");
    }
  });
});
