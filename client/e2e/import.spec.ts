/**
 * Import tests - Test importing play counts and favorites from CSV and JSON files
 */

import { test, expect } from "./fixtures";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Helper to create a temp file with given content
function createTempFile(content: string, extension: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ferrotune-import-"));
  const tempFile = path.join(tempDir, `test${extension}`);
  fs.writeFileSync(tempFile, content);
  return tempFile;
}

// Clean up temp file after test
function cleanupTempFile(filePath: string) {
  try {
    fs.unlinkSync(filePath);
    fs.rmdirSync(path.dirname(filePath));
  } catch {
    // Ignore cleanup errors
  }
}

test.describe("Import Play Counts", () => {
  test("import play counts from CSV without timestamps (aggregated)", async ({
    authenticatedPage: page,
  }) => {
    // Create CSV with aggregated play counts (multiple plays per entry)
    const csvContent = `title,artist,album,play_count
First Song,Test Artist,Test Album,5
Second Song,Test Artist,Test Album,3
FLAC Track One,Another Artist,Another Album,10
`;
    const tempFile = createTempFile(csvContent, ".csv");

    try {
      // Navigate to import page
      await page.goto("/import");
      await page.waitForLoadState("domcontentloaded");

      // Click on Import Play Counts card
      const playCountsCard = page.locator("text=Import Play Counts").first();
      await expect(playCountsCard).toBeVisible({ timeout: 10000 });
      await playCountsCard.click();

      // Wait for dialog to open - use the dialog heading specifically
      await expect(
        page.getByRole("heading", { name: "Import Play Counts" }),
      ).toBeVisible({ timeout: 5000 });

      // Upload the CSV file
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(tempFile);

      // Wait for parsing to complete - should show loaded tracks
      await expect(page.getByText(/3.*tracks loaded/)).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByText(/18.*total plays/)).toBeVisible();

      // Should NOT show timestamp indicator (no timestamps in this file)
      await expect(
        page.locator("text=Timestamps will be preserved"),
      ).not.toBeVisible();

      // Click Start Matching
      await page.getByRole("button", { name: /start matching/i }).click();

      // Wait for matching to complete - look for the match summary badge
      await expect(page.getByText(/\d+ matched/)).toBeVisible({
        timeout: 15000,
      });

      // Fill in a description
      await page.getByPlaceholder(/e\.g\./i).fill("E2E Test CSV Import");

      // Click import button
      const importButton = page.getByRole("button", {
        name: /import.*plays.*songs/i,
      });
      await expect(importButton).toBeEnabled();
      await importButton.click();

      // Wait for success toast
      const toast = page.locator("[data-sonner-toast]");
      await expect(toast.filter({ hasText: /imported/i })).toBeVisible({
        timeout: 10000,
      });

      // For aggregated imports (no timestamps), play counts are updated but nothing
      // is added to history. We verify success by checking the toast and ensuring
      // the dialog closed properly.
      await expect(
        page.getByRole("heading", { name: "Import Play Counts" }),
      ).not.toBeVisible({ timeout: 5000 });

      // Verify the import page is still accessible (we should see the card title)
      await expect(
        page.locator('[data-slot="card-title"]', {
          hasText: "Import Play Counts",
        }),
      ).toBeVisible();
    } finally {
      cleanupTempFile(tempFile);
    }
  });

  test("import play counts from CSV with timestamps (history)", async ({
    authenticatedPage: page,
  }) => {
    // Create CSV with individual play events and timestamps
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const csvContent = `title,artist,album,timestamp,duration
First Song,Test Artist,Test Album,${twoHoursAgo.toISOString()},180
First Song,Test Artist,Test Album,${oneHourAgo.toISOString()},180
Second Song,Test Artist,Test Album,${now.toISOString()},240
`;
    const tempFile = createTempFile(csvContent, ".csv");

    try {
      await page.goto("/import");
      await page.waitForLoadState("domcontentloaded");

      const playCountsCard = page.locator("text=Import Play Counts").first();
      await playCountsCard.click();

      await expect(
        page.getByRole("heading", { name: "Import Play Counts" }),
      ).toBeVisible({ timeout: 5000 });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(tempFile);

      // Should show unique tracks aggregated from play events
      await expect(page.getByText(/2.*unique tracks/)).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByText(/3.*play events/)).toBeVisible();

      // Should show timestamp indicator
      await expect(
        page.getByText(/timestamps will be preserved/i),
      ).toBeVisible();

      // Click Start Matching
      await page.getByRole("button", { name: /start matching/i }).click();

      // Wait for matching to complete
      await expect(page.getByText(/\d+ matched/)).toBeVisible({
        timeout: 15000,
      });

      // Fill in description
      await page
        .getByPlaceholder(/e\.g\./i)
        .fill("E2E Test CSV History Import");

      // Should show scrobbles count in import button
      const importButton = page.getByRole("button", {
        name: /import.*scrobbles/i,
      });
      await expect(importButton).toBeEnabled();
      await importButton.click();

      // Wait for success toast mentioning scrobbles and sessions
      const toast = page.locator("[data-sonner-toast]");
      await expect(
        toast.filter({ hasText: /scrobbles.*sessions|sessions.*scrobbles/i }),
      ).toBeVisible({ timeout: 10000 });

      // Verify by checking history
      await page.goto("/history");
      await page.waitForLoadState("domcontentloaded");
      await expect(
        page.getByText("First Song").or(page.getByText("Second Song")).first(),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      cleanupTempFile(tempFile);
    }
  });

  test("import play counts from JSON without timestamps (aggregated)", async ({
    authenticatedPage: page,
  }) => {
    // Create JSON with aggregated play counts
    const jsonContent = JSON.stringify([
      {
        title: "First Song",
        artist: "Test Artist",
        album: "Test Album",
        play_count: 7,
      },
      {
        title: "Third Song",
        artist: "Test Artist",
        album: "Test Album",
        play_count: 4,
      },
    ]);
    const tempFile = createTempFile(jsonContent, ".json");

    try {
      await page.goto("/import");
      await page.waitForLoadState("domcontentloaded");

      const playCountsCard = page.locator("text=Import Play Counts").first();
      await playCountsCard.click();

      await expect(
        page.getByRole("heading", { name: "Import Play Counts" }),
      ).toBeVisible({ timeout: 5000 });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(tempFile);

      // Should show loaded tracks
      await expect(page.getByText(/2.*tracks loaded/)).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByText(/11.*total plays/)).toBeVisible();

      // Should NOT show timestamp indicator
      await expect(
        page.locator("text=Timestamps will be preserved"),
      ).not.toBeVisible();

      // Click Start Matching
      await page.getByRole("button", { name: /start matching/i }).click();

      await expect(page.getByText(/\d+ matched/)).toBeVisible({
        timeout: 15000,
      });

      await page
        .getByPlaceholder(/e\.g\./i)
        .fill("E2E Test JSON Aggregated Import");

      const importButton = page.getByRole("button", {
        name: /import.*plays.*songs/i,
      });
      await expect(importButton).toBeEnabled();
      await importButton.click();

      const toast = page.locator("[data-sonner-toast]");
      await expect(toast.filter({ hasText: /imported/i })).toBeVisible({
        timeout: 10000,
      });

      // For aggregated imports (no timestamps), play counts are updated but nothing
      // is added to history. We verify success by checking the toast and ensuring
      // the dialog closed properly.
      await expect(
        page.getByRole("heading", { name: "Import Play Counts" }),
      ).not.toBeVisible({ timeout: 5000 });

      // Verify the import page is still accessible (we should see the card title)
      await expect(
        page.locator('[data-slot="card-title"]', {
          hasText: "Import Play Counts",
        }),
      ).toBeVisible();
    } finally {
      cleanupTempFile(tempFile);
    }
  });

  test("import play counts from JSON with timestamps (streaming history)", async ({
    authenticatedPage: page,
  }) => {
    // Create JSON in Spotify Extended Streaming History format
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const jsonContent = JSON.stringify([
      {
        ts: twoHoursAgo.toISOString(),
        ms_played: 180000,
        master_metadata_track_name: "First Song",
        master_metadata_album_artist_name: "Test Artist",
        master_metadata_album_album_name: "Test Album",
        reason_end: "trackdone",
      },
      {
        ts: oneHourAgo.toISOString(),
        ms_played: 120000,
        master_metadata_track_name: "Second Song",
        master_metadata_album_artist_name: "Test Artist",
        master_metadata_album_album_name: "Test Album",
        reason_end: "trackdone",
      },
      {
        ts: now.toISOString(),
        ms_played: 200000,
        master_metadata_track_name: "First Song",
        master_metadata_album_artist_name: "Test Artist",
        master_metadata_album_album_name: "Test Album",
        reason_end: "trackdone",
      },
    ]);
    const tempFile = createTempFile(jsonContent, ".json");

    try {
      await page.goto("/import");
      await page.waitForLoadState("domcontentloaded");

      const playCountsCard = page.locator("text=Import Play Counts").first();
      await playCountsCard.click();

      await expect(
        page.getByRole("heading", { name: "Import Play Counts" }),
      ).toBeVisible({ timeout: 5000 });

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(tempFile);

      // Should show unique tracks and play events
      await expect(page.getByText(/2.*unique tracks/)).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByText(/3.*play events/)).toBeVisible();

      // Should show timestamp indicator
      await expect(
        page.getByText(/timestamps will be preserved/i),
      ).toBeVisible();

      // Should show total listening time
      await expect(page.getByText(/listening time/i)).toBeVisible();

      // Click Start Matching
      await page.getByRole("button", { name: /start matching/i }).click();

      await expect(page.getByText(/\d+ matched/)).toBeVisible({
        timeout: 15000,
      });

      await page
        .getByPlaceholder(/e\.g\./i)
        .fill("E2E Test JSON History Import");

      // Should show scrobbles count
      const importButton = page.getByRole("button", {
        name: /import.*scrobbles/i,
      });
      await expect(importButton).toBeEnabled();
      await importButton.click();

      // Wait for success toast mentioning scrobbles and sessions
      const toast = page.locator("[data-sonner-toast]");
      await expect(
        toast.filter({ hasText: /scrobbles.*sessions|sessions.*scrobbles/i }),
      ).toBeVisible({ timeout: 10000 });

      await page.goto("/history");
      await page.waitForLoadState("domcontentloaded");
      await expect(
        page.getByText("First Song").or(page.getByText("Second Song")).first(),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      cleanupTempFile(tempFile);
    }
  });
});

test.describe("Import Favorites", () => {
  test("import favorites from CSV", async ({ authenticatedPage: page }) => {
    // Use songs from test data that we know exist
    const csvContent = `title,artist,album
First Song,Test Artist,Test Album
Second Song,Test Artist,Test Album
`;
    const tempFile = createTempFile(csvContent, ".csv");

    try {
      await page.goto("/import");
      await page.waitForLoadState("domcontentloaded");

      // Click on Import Favorites card
      const favoritesCard = page.locator("text=Import Favorites").first();
      await expect(favoritesCard).toBeVisible({ timeout: 10000 });
      await favoritesCard.click();

      // Wait for dialog to open - use heading specifically
      await expect(
        page.getByRole("heading", { name: "Import Favorites" }),
      ).toBeVisible({ timeout: 5000 });

      // Should default to Songs tab
      await expect(
        page.getByRole("tab", { name: /songs/i, selected: true }),
      ).toBeVisible();

      // Upload the CSV file
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(tempFile);

      // Wait for parsing to complete
      await expect(page.getByText(/2.*songs loaded/)).toBeVisible({
        timeout: 5000,
      });

      // Click Start Matching
      await page.getByRole("button", { name: /start matching/i }).click();

      // Wait for matching to complete - look for the match summary badge
      await expect(page.getByText(/\d+ matched/)).toBeVisible({
        timeout: 15000,
      });

      // Click add to favorites button
      const addButton = page.getByRole("button", {
        name: /add.*to favorites/i,
      });
      await expect(addButton).toBeEnabled();
      await addButton.click();

      // Wait for success toast
      const toast = page.locator("[data-sonner-toast]");
      await expect(toast.filter({ hasText: /added.*favorites/i })).toBeVisible({
        timeout: 10000,
      });

      // Verify by going to favorites page
      await page.goto("/favorites");
      await page.waitForLoadState("domcontentloaded");

      // Should see our favorited songs
      // Wait for content to load - the songs tab should be active by default
      await expect(
        page.getByRole("tab", { name: /songs/i, selected: true }),
      ).toBeVisible({ timeout: 10000 });

      // Check that at least one of our songs appears in favorites
      await expect(
        page.getByText("First Song").or(page.getByText("Second Song")).first(),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      cleanupTempFile(tempFile);
    }
  });
});
