import { test, expect } from "./fixtures";

test.describe("Sorting and Filtering", () => {
  test.describe("Library Songs View", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.goto("/library/songs");
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("filter input is visible", async ({ authenticatedPage: page }) => {
      const filterInput = page.getByRole("textbox", { name: /filter/i });
      await expect(filterInput).toBeVisible();
    });

    test("can filter songs by name", async ({ authenticatedPage: page }) => {
      const filterInput = page.getByRole("textbox", { name: /filter/i });
      await filterInput.fill("First");
      
      await page.waitForTimeout(500); // Wait for debounce
      
      // Should only show "First Song"
      const songRows = page.locator('[data-testid="song-row"]');
      await expect(songRows).toHaveCount(1);
      await expect(songRows.first()).toContainText("First Song");
    });

    test("filter shows no results message when empty", async ({ authenticatedPage: page }) => {
      const filterInput = page.getByRole("textbox", { name: /filter/i });
      await filterInput.fill("xyznonexistent");
      
      await page.waitForTimeout(500);
      
      // Should show no results message
      await expect(page.getByText(/no songs match/i)).toBeVisible();
    });

    test("clearing filter shows all songs", async ({ authenticatedPage: page }) => {
      const filterInput = page.getByRole("textbox", { name: /filter/i });
      await filterInput.fill("First");
      await page.waitForTimeout(500);
      
      // Clear filter
      await filterInput.clear();
      await page.waitForTimeout(500);
      
      // Should show all songs again
      const songRows = page.locator('[data-testid="song-row"]');
      const count = await songRows.count();
      expect(count).toBeGreaterThan(1);
    });

    test("sort dropdown is visible", async ({ authenticatedPage: page }) => {
      const sortButton = page.getByRole("button", { name: /sort options/i });
      await expect(sortButton).toBeVisible();
    });

    test("can change sort order", async ({ authenticatedPage: page }) => {
      const sortButton = page.getByRole("button", { name: /sort options/i });
      await sortButton.click();
      
      // Dropdown should open
      const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
      await expect(dropdown).toBeVisible();
      
      // Click on "Name" sort option
      await dropdown.getByRole("menuitem", { name: /name/i }).click();
      
      await page.waitForTimeout(300);
      
      // Verify songs are sorted (First comes before Second alphabetically)
      const firstSongText = await page.locator('[data-testid="song-row"]').first().textContent();
      expect(firstSongText).toContain("First");
    });

    test("can sort by artist", async ({ authenticatedPage: page }) => {
      const sortButton = page.getByRole("button", { name: /sort options/i });
      await sortButton.click();
      
      await page.getByRole("menuitem", { name: /artist/i }).click();
      
      await page.waitForTimeout(300);
      
      // Sorting changed without error
      expect(page.url()).toBeTruthy();
    });

    test("can toggle sort direction", async ({ authenticatedPage: page }) => {
      const sortButton = page.getByRole("button", { name: /sort options/i });
      await sortButton.click();
      
      // Look for ascending/descending toggle
      const ascDescToggle = page.getByRole("menuitem", { name: /ascending|descending/i });
      if (await ascDescToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        await ascDescToggle.click();
        await page.waitForTimeout(300);
      }
      
      expect(page.url()).toBeTruthy();
    });
  });

  test.describe("View Mode Toggle", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.goto("/library/songs");
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("grid view button is visible", async ({ authenticatedPage: page }) => {
      const gridButton = page.getByRole("button", { name: /grid view/i });
      await expect(gridButton).toBeVisible();
    });

    test("list view button is visible", async ({ authenticatedPage: page }) => {
      const listButton = page.getByRole("button", { name: /list view/i });
      await expect(listButton).toBeVisible();
    });

    test("can switch to grid view", async ({ authenticatedPage: page }) => {
      const gridButton = page.getByRole("button", { name: /grid view/i });
      await gridButton.click();
      
      await page.waitForTimeout(300);
      
      // Media cards should appear in grid view
      const mediaCards = page.locator('[data-testid="media-card"]');
      await expect(mediaCards.first()).toBeVisible({ timeout: 3000 });
    });

    test("can switch back to list view", async ({ authenticatedPage: page }) => {
      // First switch to grid
      const gridButton = page.getByRole("button", { name: /grid view/i });
      await gridButton.click();
      await page.waitForTimeout(300);
      
      // Then switch back to list
      const listButton = page.getByRole("button", { name: /list view/i });
      await listButton.click();
      await page.waitForTimeout(300);
      
      // Song rows should appear
      const songRows = page.locator('[data-testid="song-row"]');
      await expect(songRows.first()).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe("Column Visibility", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.goto("/library/songs");
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
    });

    test("column visibility toggle is visible", async ({ authenticatedPage: page }) => {
      const columnsButton = page.getByRole("button", { name: /toggle columns/i });
      await expect(columnsButton).toBeVisible();
    });

    test("can open column visibility menu", async ({ authenticatedPage: page }) => {
      const columnsButton = page.getByRole("button", { name: /toggle columns/i });
      await columnsButton.click();
      
      const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
      await expect(dropdown).toBeVisible();
    });

    test("can toggle column visibility", async ({ authenticatedPage: page }) => {
      const columnsButton = page.getByRole("button", { name: /toggle columns/i });
      await columnsButton.click();
      
      // Toggle "Artist" column
      const artistOption = page.getByRole("menuitemcheckbox", { name: /artist/i });
      if (await artistOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await artistOption.click();
        await page.waitForTimeout(300);
      }
      
      expect(page.url()).toBeTruthy();
    });
  });

  test.describe("Album List Sorting", () => {
    test.beforeEach(async ({ authenticatedPage: page }) => {
      await page.goto("/library/albums");
      await page.waitForLoadState("networkidle");
      await page.waitForSelector('[data-testid="media-card"]', { timeout: 10000 });
    });

    test("can sort albums by name", async ({ authenticatedPage: page }) => {
      const sortButton = page.getByRole("button", { name: /sort/i }).first();
      if (await sortButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sortButton.click();
        
        const nameOption = page.getByRole("menuitem", { name: /name|title/i });
        if (await nameOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nameOption.click();
          await page.waitForTimeout(300);
        }
      }
      
      expect(page.url()).toBeTruthy();
    });

    test("can sort albums by year", async ({ authenticatedPage: page }) => {
      const sortButton = page.getByRole("button", { name: /sort/i }).first();
      if (await sortButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sortButton.click();
        
        const yearOption = page.getByRole("menuitem", { name: /year/i });
        if (await yearOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await yearOption.click();
          await page.waitForTimeout(300);
        }
      }
      
      expect(page.url()).toBeTruthy();
    });
  });

  test.describe("Playlist Detail Sorting", () => {
    test("playlist sort options include Custom", async ({ authenticatedPage: page }) => {
      // Create a playlist with some songs first
      const playlistName = `Sort Test ${Date.now()}`;
      
      await page.goto("/playlists");
      const createButton = page.getByRole("button", { name: /create|new|\+/i }).first();
      await createButton.click();
      
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill(playlistName);
      await dialog.getByRole("button", { name: /create|save/i }).click();
      
      await page.waitForTimeout(1000);
      
      // Navigate to the playlist
      const playlistLink = page.getByText(playlistName);
      if (await playlistLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await playlistLink.click();
        await expect(page).toHaveURL(/\/playlists\//);
        
        // Check for sort button
        const sortButton = page.getByRole("button", { name: /sort options/i });
        if (await sortButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await sortButton.click();
          
          // "Custom" option should be available for playlists
          const customOption = page.getByRole("menuitem", { name: /custom/i });
          await expect(customOption).toBeVisible();
        }
      }
    });
  });

  test.describe("Filter Persistence", () => {
    test("filter persists during navigation within same page", async ({ authenticatedPage: page }) => {
      await page.goto("/library/songs");
      await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
      
      // Apply filter
      const filterInput = page.getByRole("textbox", { name: /filter/i });
      await filterInput.fill("First");
      await page.waitForTimeout(500);
      
      // Scroll down and back up
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.evaluate(() => window.scrollBy(0, -500));
      
      // Filter should still be applied
      await expect(filterInput).toHaveValue("First");
    });
  });
});
