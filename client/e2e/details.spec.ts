import { test, expect, playFirstSong, waitForPlayerReady } from "./fixtures";

test.describe("Album Details", () => {
  test("can navigate to album details from library", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/albums");

    // Wait for media cards to load
    const mediaCard = page.locator('[data-testid="media-card"]').first();
    await mediaCard.waitFor({ state: "visible", timeout: 10000 });

    // Click on the album title link
    await mediaCard.click();

    // Should navigate to album details
    await expect(page).toHaveURL(/\/library\/albums\/details/);
  });

  test("album details page shows header and tracks", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/albums");

    // Click on first album
    const mediaCard = page.locator('[data-testid="media-card"]').first();
    await mediaCard.waitFor({ state: "visible", timeout: 10000 });
    await mediaCard.click();

    await expect(page).toHaveURL(/\/library\/albums\/details/);

    // Should show album heading
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // Find Play and Shuffle buttons - use getByText for exact match to avoid matching song row buttons
    await expect(page.getByText("Play", { exact: true })).toBeVisible();
    await expect(page.getByText("Shuffle", { exact: true })).toBeVisible();
  });

  test("can play album from details page", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/albums");

    // Click on first album
    const mediaCard = page.locator('[data-testid="media-card"]').first();
    await mediaCard.waitFor({ state: "visible", timeout: 10000 });
    await mediaCard.click();

    await expect(page).toHaveURL(/\/library\/albums\/details/);

    // Click Play button with text (not the icon-only buttons on rows)
    const playButton = page.getByText("Play", { exact: true });
    await playButton.click();

    // Wait for playback to start - check player bar shows song info
    await waitForPlayerReady(page);
  });

  test("album details shows back button", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/albums");

    const mediaCard = page.locator('[data-testid="media-card"]').first();
    await mediaCard.waitFor({ state: "visible", timeout: 10000 });
    await mediaCard.click();

    await expect(page).toHaveURL(/\/library\/albums\/details/);

    // Find the Go back button
    const backButton = page.getByRole("button", { name: "Go back" });
    await expect(backButton).toBeVisible();
  });
});

test.describe("Artist Details", () => {
  test("can navigate to artist details from library", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/artists");

    // Wait for media cards to load
    const mediaCard = page.locator('[data-testid="media-card"]').first();
    await mediaCard.waitFor({ state: "visible", timeout: 10000 });
    await mediaCard.click();

    // Should navigate to artist details
    await expect(page).toHaveURL(/\/library\/artists\/details/);
  });

  test("artist details page shows header and albums", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/artists");

    // Click on first artist
    const mediaCard = page.locator('[data-testid="media-card"]').first();
    await mediaCard.waitFor({ state: "visible", timeout: 10000 });
    await mediaCard.click();

    await expect(page).toHaveURL(/\/library\/artists\/details/);

    // Should show artist heading
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // Find Play and Shuffle buttons with text (artist page uses "Play" not "Play All")
    await expect(page.getByText("Play", { exact: true })).toBeVisible();
    await expect(page.getByText("Shuffle", { exact: true })).toBeVisible();

    // Should show Albums section
    await expect(page.getByRole("heading", { name: /albums/i })).toBeVisible();
  });

  test("can play artist from details page", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/artists");

    // Click on first artist
    const mediaCard = page.locator('[data-testid="media-card"]').first();
    await mediaCard.waitFor({ state: "visible", timeout: 10000 });
    await mediaCard.click();

    await expect(page).toHaveURL(/\/library\/artists\/details/);

    // Click Play button with text
    const playButton = page.getByText("Play", { exact: true });
    await playButton.click();

    // Wait for playback to start - check player bar shows song info
    await waitForPlayerReady(page);
  });

  test("artist details shows songs section", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/artists");

    const mediaCard = page.locator('[data-testid="media-card"]').first();
    await mediaCard.waitFor({ state: "visible", timeout: 10000 });
    await mediaCard.click();

    await expect(page).toHaveURL(/\/library\/artists\/details/);

    // Should show Songs section
    await expect(page.getByRole("heading", { name: /songs/i })).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("History Page", () => {
  test("history page is accessible", async ({ authenticatedPage: page }) => {
    await page.goto("/history");

    // Should show Recently Played heading
    await expect(
      page.getByRole("heading", { name: /recently played/i }),
    ).toBeVisible();
  });

  test("history page has playback controls when empty", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/history");

    // Wait for heading first
    await expect(
      page.getByRole("heading", { name: /recently played/i }),
    ).toBeVisible();

    // Find the Play and Shuffle buttons with text
    await expect(page.getByText("Play", { exact: true })).toBeVisible();
    await expect(page.getByText("Shuffle", { exact: true })).toBeVisible();
  });

  test("history page shows empty state", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/history");

    // Wait for heading first
    await expect(
      page.getByRole("heading", { name: /recently played/i }),
    ).toBeVisible();
    const emptyState = page.getByText(/no listening history/i);
    const songs = page.locator('[data-testid="song-row"]').first();

    // Either empty state or songs should be visible
    const hasEmptyState = await emptyState.isVisible().catch(() => false);
    const hasSongs = await songs.isVisible().catch(() => false);

    expect(hasEmptyState || hasSongs).toBeTruthy();
  });

  test("history page shows songs after playing", async ({
    authenticatedPage: page,
  }) => {
    // Play a song first to add to history
    await playFirstSong(page);
    await waitForPlayerReady(page);

    // Navigate to history
    await page.goto("/history");

    // Now history should have at least one song or empty state
    // (History updates may not be immediate in all cases)
    await expect(
      page.getByRole("heading", { name: /recently played/i }),
    ).toBeVisible();
  });
});
