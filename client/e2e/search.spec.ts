/**
 * Search tests - Search functionality
 */

import { test, expect, resetState } from "./fixtures";

test.describe("Search", () => {
  // Reset all server state before each test for isolation
  test.beforeEach(async ({ authenticatedPage: page, server }) => {
    await resetState(page, server);
  });

  test("search finds results and updates URL", async ({
    authenticatedPage: page,
  }) => {
    // Use a known artist name from the test fixtures
    const searchQuery = "Test Artist";

    // Search for the artist
    await page.goto("/search");
    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Wait for React hydration to settle (input re-mounts during Suspense resolution)
    await page.waitForTimeout(1000);

    // Fill the search query (more resilient to DOM re-attachment than click+type)
    await searchInput.fill(searchQuery);

    // Wait for search results to appear
    const result = page.getByText(searchQuery).first();
    await expect(result).toBeVisible({ timeout: 10000 });

    // Now verify URL was updated
    await expect(page).toHaveURL(/q=/, { timeout: 5000 });
  });

  test("search query populates from URL", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/search?q=preloaded");

    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toHaveValue("preloaded");
  });
});
