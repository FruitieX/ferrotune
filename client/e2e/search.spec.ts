/**
 * Search tests - Search functionality
 */

import { test, expect, resetState, type ServerInfo } from "./fixtures";

function basicAuth(server: ServerInfo): string {
  return `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`;
}

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
    await expect(searchInput).toBeEditable();

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

  test("tab counts are server totals and the Songs tab lists every match", async ({
    authenticatedPage: page,
    server,
  }) => {
    const response = await page.request.get(
      `${server.url}/api/search?query=Song&artistCount=0&albumCount=0&songCount=0`,
      { headers: { Authorization: basicAuth(server) } },
    );
    const total: number = (await response.json()).searchResult.songTotal;
    expect(total).toBeGreaterThan(0);

    await page.goto("/search?q=Song");
    const songsTab = page.getByRole("tab", { name: `Songs (${total})` });
    await expect(songsTab).toBeVisible();
    await songsTab.click();
    await expect(
      page.getByRole("tabpanel").getByTestId("song-row"),
    ).toHaveCount(total);
  });

  test("finds genres and smart playlists by name", async ({
    authenticatedPage: page,
    server,
  }) => {
    const created = await page.request.post(
      `${server.url}/api/smart-playlists`,
      {
        headers: { Authorization: basicAuth(server) },
        data: {
          name: "Rocking Smart Mix",
          isPublic: false,
          rules: { logic: "and", conditions: [] },
        },
      },
    );
    expect(created.ok()).toBe(true);

    await page.goto("/search?q=rock");
    await expect(page.getByRole("tab", { name: "Genres (1)" })).toBeVisible();
    await page.getByRole("tab", { name: "Playlists (1)" }).click();
    await expect(
      page
        .getByRole("tabpanel")
        .getByRole("link", { name: /Rocking Smart Mix/ })
        .first(),
    ).toHaveAttribute("href", /\/playlists\/smart\?id=/);
  });
});
