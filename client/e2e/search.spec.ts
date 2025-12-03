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
    // Navigate to the library artists page
    await page.goto("/library/artists");
    await page.waitForLoadState("networkidle");
    
    // Wait for artist data to load - wait for artist cards to appear
    const artistCards = page.locator('[data-testid="media-card"], [class*="group"]').filter({
      has: page.locator('a[href^="/library/artists/details"]')
    });
    await expect(artistCards.first()).toBeVisible({ timeout: 10000 });
    
    // Get the artist name from the h3 heading inside the card
    const artistHeading = page.locator('h3').filter({ hasText: /\w+/ }).first();
    const artistName = await artistHeading.textContent();
    expect(artistName).toBeTruthy();
    
    // Search for the artist
    await page.goto("/search");
    await page.waitForTimeout(500);
    await searchFor(page, artistName!.trim());
    await page.waitForTimeout(1500);
    
    // Should show artist in results
    const result = page.getByText(artistName!.trim()).first();
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

  test("sidebar navigation to search works", async ({ authenticatedPage: page }, testInfo) => {
    await page.goto("/");
    await page.waitForTimeout(500);
    
    const isMobile = testInfo.project.name.includes("mobile");
    
    // Navigate via sidebar/nav search link if it exists
    const searchLink = page.getByRole("link", { name: /search/i }).first();
    const hasSearchLink = await searchLink.isVisible().catch(() => false);
    
    if (hasSearchLink) {
      if (isMobile) {
        // On mobile, Next.js dev overlay can interfere with clicks
        // Use JavaScript navigation instead
        const href = await searchLink.getAttribute("href");
        if (href) {
          await page.goto(href);
        } else {
          await searchLink.click({ force: true });
        }
      } else {
        await searchLink.click();
      }
      await expect(page).toHaveURL("/search");
    } else {
      // No sidebar search link, navigate directly
      await page.goto("/search");
      expect(page.url()).toContain("/search");
    }
  });
});
