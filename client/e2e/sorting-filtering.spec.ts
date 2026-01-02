/**
 * Sorting and filtering tests - List controls and view modes
 */

import { test, expect, waitForPageReady } from "./fixtures";

test.describe("Sorting and Filtering", () => {
  test("can filter songs by name", async ({ authenticatedPage: page }) => {
    await page.goto("/library/songs");
    await waitForPageReady(page);

    const listViewButton = page.getByRole("button", { name: /list view/i });
    await listViewButton.click();
    await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

    const filterInput = page.getByRole("textbox", { name: /filter/i });
    await filterInput.fill("First");
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

    const sortButton = page.getByRole("button", { name: /sort options/i });
    await sortButton.click();

    const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(dropdown).toBeVisible();

    await dropdown.getByRole("menuitem", { name: /name/i }).click();
    await page.waitForTimeout(300);

    // Verify songs are sorted
    const firstSongText = await page
      .locator('[data-testid="song-row"]')
      .first()
      .textContent();
    expect(firstSongText).toMatch(/First|Third/);
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
});
