/**
 * Sorting and filtering tests - List controls and view modes
 */

import { test, expect, waitForPageReady, resetState } from "./fixtures";
import type { Page } from "@playwright/test";

async function openAlbumDetails(page: Page) {
  await page.goto("/library/albums");
  await waitForPageReady(page);

  const testAlbum = page
    .locator('[data-testid="media-card"]')
    .filter({ hasText: "Test Album" })
    .first();
  await expect(testAlbum).toBeVisible({ timeout: 10000 });
  await testAlbum.click();

  await expect(page).toHaveURL(/\/library\/albums\/details/);
}

async function openArtistDetails(page: Page) {
  await page.goto("/library/artists");
  await waitForPageReady(page);

  const testArtist = page
    .locator('[data-testid="media-card"]')
    .filter({ hasText: "Test Artist" })
    .first();
  await expect(testArtist).toBeVisible({ timeout: 10000 });
  await testArtist.click();

  await expect(page).toHaveURL(/\/library\/artists\/details/);
}

test.describe("Sorting and Filtering", () => {
  // Reset all server state before each test for isolation
  test.beforeEach(async ({ authenticatedPage: page, server }) => {
    await resetState(page, server);
  });

  test("can filter songs by name", async ({ authenticatedPage: page }) => {
    await page.goto("/library/songs");
    await waitForPageReady(page);

    const listViewButton = page.getByRole("button", { name: /list view/i });
    await listViewButton.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const filterInput = page.getByRole("textbox", { name: /filter/i });
    await filterInput.fill("First Song");
    await page.waitForTimeout(500);

    const songRows = page.locator('[data-testid="song-row"]');
    await expect(songRows).toHaveCount(1);
    await expect(songRows.first()).toContainText("First Song");

    // Clear filter shows all
    await filterInput.clear();
    await page.waitForTimeout(500);
    const count = await songRows.count();
    expect(count).toBeGreaterThan(1);
  });

  test("can change sort order", async ({ authenticatedPage: page }) => {
    await page.goto("/library/songs");
    await waitForPageReady(page);

    const listViewButton = page.getByRole("button", { name: /list view/i });
    await listViewButton.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    // Helper to extract song titles from the visible rows
    async function getSongTitles(): Promise<string[]> {
      const rows = page.locator('[data-testid="song-row"]');
      const count = await rows.count();
      const titles: string[] = [];
      for (let i = 0; i < Math.min(count, 5); i++) {
        // The title is in the first span with font-medium class inside the row
        const titleSpan = rows.nth(i).locator("span.font-medium").first();
        const title = await titleSpan.textContent();
        if (title) titles.push(title);
      }
      return titles;
    }

    // Click sort dropdown and select "Title"
    const sortButton = page.getByRole("button", { name: /sort options/i });
    await sortButton.click();

    const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(dropdown).toBeVisible();
    await dropdown.getByRole("menuitem", { name: /title/i }).click();
    await page.waitForTimeout(500);

    // Get titles after sorting by title
    const titlesAfterNameSort = await getSongTitles();
    expect(titlesAfterNameSort.length).toBeGreaterThan(1);

    // Verify titles are actually sorted (either A-Z or Z-A based on current toggle state)
    const sortedAZ = [...titlesAfterNameSort].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    const sortedZA = [...titlesAfterNameSort].sort((a, b) =>
      b.toLowerCase().localeCompare(a.toLowerCase()),
    );

    const isSortedAZ = titlesAfterNameSort.every(
      (t, i) => t.toLowerCase() === sortedAZ[i].toLowerCase(),
    );
    const isSortedZA = titlesAfterNameSort.every(
      (t, i) => t.toLowerCase() === sortedZA[i].toLowerCase(),
    );

    // Should be sorted in one direction or the other
    expect(isSortedAZ || isSortedZA).toBe(true);

    // Now test sort direction toggle - click the direction button
    const directionButton = page.getByRole("button", {
      name: /ascending|descending/i,
    });
    if (await directionButton.isVisible()) {
      await directionButton.click();
      await page.waitForTimeout(500);

      const titlesAfterToggle = await getSongTitles();

      // After toggle, order should be reversed
      const wasAZ = isSortedAZ;
      const titlesSortedAZ = [...titlesAfterToggle].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
      );
      const titlesSortedZA = [...titlesAfterToggle].sort((a, b) =>
        b.toLowerCase().localeCompare(a.toLowerCase()),
      );
      const newSortedAZ = titlesAfterToggle.every(
        (t, i) => t.toLowerCase() === titlesSortedAZ[i].toLowerCase(),
      );
      const newSortedZA = titlesAfterToggle.every(
        (t, i) => t.toLowerCase() === titlesSortedZA[i].toLowerCase(),
      );

      // Should now be sorted in the opposite direction
      if (wasAZ) {
        expect(newSortedZA).toBe(true);
      } else {
        expect(newSortedAZ).toBe(true);
      }
    }
  });

  test("can toggle between grid and list view", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/songs");
    await waitForPageReady(page);

    // Switch to list view
    const listButton = page.getByRole("button", { name: /list view/i });
    await listButton.click();
    await page.waitForTimeout(300);

    const songRows = page.locator('[data-testid="song-row"]');
    await expect(songRows.first()).toBeVisible({ timeout: 3000 });

    // Switch to grid view
    const gridButton = page.getByRole("button", { name: /grid view/i });
    await gridButton.click();
    await page.waitForTimeout(300);

    const mediaCards = page.locator('[data-testid="media-card"]');
    await expect(mediaCards.first()).toBeVisible({ timeout: 3000 });
  });

  test("favorites defaults to newest favorited sorting", async ({
    authenticatedPage: page,
  }) => {
    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/ferrotune/search" &&
        url.searchParams.get("starredOnly") === "true" &&
        url.searchParams.get("songSort") === "starred" &&
        url.searchParams.get("songSortDir") === "desc"
      );
    });

    await page.goto("/favorites");
    await searchResponse;
  });

  test("history defaults to newest last played sorting", async ({
    authenticatedPage: page,
  }) => {
    const historyResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/ferrotune/history" &&
        url.searchParams.get("sort") === "lastPlayed" &&
        url.searchParams.get("sortDir") === "desc"
      );
    });

    await page.goto("/history");
    await historyResponse;
  });

  test("album and artist detail views can sort by last played", async ({
    authenticatedPage: page,
  }) => {
    await openAlbumDetails(page);

    await page.getByRole("button", { name: /sort options/i }).click();
    await expect(
      page.getByRole("menuitem", { name: /last played/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await openArtistDetails(page);

    await page.getByRole("button", { name: /sort options/i }).click();
    await expect(
      page.getByRole("menuitem", { name: /last played/i }),
    ).toBeVisible();
  });
});
