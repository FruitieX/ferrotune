import { test as base, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Load test config from .env.test file created by global-setup.
 * This is needed because env vars don't propagate to Playwright worker processes.
 * We read the file on each access to ensure we get fresh values after global-setup runs.
 */
function loadTestConfig(): Record<string, string> {
  const envTestPath = path.join(__dirname, ".env.test");
  
  if (fs.existsSync(envTestPath)) {
    const content = fs.readFileSync(envTestPath, "utf-8");
    const lines = content.split("\n");
    const config: Record<string, string> = {};
    
    for (const line of lines) {
      const [key, value] = line.split("=");
      if (key && value) {
        config[key.trim()] = value.trim();
      }
    }
    
    return config;
  }
  
  return {};
}

/**
 * Test configuration for connecting to Ferrotune server.
 * 
 * When running with global-setup, these values are set automatically.
 * For external servers, set environment variables:
 * - FERROTUNE_TEST_URL: Server URL (default: http://localhost:4040)
 * - FERROTUNE_TEST_USER: Username (default: admin)
 * - FERROTUNE_TEST_PASS: Password (default: admin)
 */
export const testConfig = {
  get serverUrl() {
    const envConfig = loadTestConfig();
    return envConfig.FERROTUNE_TEST_URL || process.env.FERROTUNE_TEST_URL || "http://localhost:4040";
  },
  get username() {
    const envConfig = loadTestConfig();
    return envConfig.FERROTUNE_TEST_USER || process.env.FERROTUNE_TEST_USER || "admin";
  },
  get password() {
    const envConfig = loadTestConfig();
    return envConfig.FERROTUNE_TEST_PASS || process.env.FERROTUNE_TEST_PASS || "admin";
  },
};

/**
 * Known test data from the fixtures.
 * These are the exact values from generate-test-fixtures.sh
 */
export const testData = {
  artists: [
    { name: "Test Artist", albums: 1, tracks: 3 },
    { name: "Another Artist", albums: 1, tracks: 2 },
    { name: "Various Artists", albums: 1, tracks: 2 },
  ],
  albums: [
    { name: "Test Album", artist: "Test Artist", year: 2024, genre: "Rock", tracks: 3 },
    { name: "Another Album", artist: "Another Artist", year: 2023, genre: "Electronic", tracks: 2 },
    { name: "Compilation Album", artist: "Various Artists", year: 2022, genre: "Pop", tracks: 2 },
  ],
  tracks: [
    { title: "First Song", artist: "Test Artist", album: "Test Album" },
    { title: "Second Song", artist: "Test Artist", album: "Test Album" },
    { title: "Third Song", artist: "Test Artist", album: "Test Album" },
    { title: "FLAC Track One", artist: "Another Artist", album: "Another Album" },
    { title: "FLAC Track Two", artist: "Another Artist", album: "Another Album" },
    { title: "Compilation Track", artist: "Guest Artist", album: "Compilation Album" },
    { title: "Another Compilation", artist: "Different Artist", album: "Compilation Album" },
  ],
  genres: ["Rock", "Electronic", "Pop"],
};

/**
 * Helper function to log in with username/password.
 * Can be used in beforeEach or called directly.
 */
export async function login(page: Page, options?: {
  serverUrl?: string;
  username?: string;
  password?: string;
}) {
  const serverUrl = options?.serverUrl ?? testConfig.serverUrl;
  const username = options?.username ?? testConfig.username;
  const password = options?.password ?? testConfig.password;

  console.log(`[login] Logging in with serverUrl=${serverUrl}, username=${username}, password=${password ? '***' : 'empty'}`);

  // Go to login page
  await page.goto("/login");
  
  // Wait for login form to be ready - username is always visible (password tab is default)
  await page.waitForSelector("#username", { state: "visible", timeout: 10000 });
  
  // Fill in username and password
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  
  // Open advanced settings to set server URL (it's hidden by default)
  const advancedButton = page.getByRole("button", { name: /advanced settings/i });
  await advancedButton.click();
  
  // Wait for server URL input to appear and fill it
  await page.waitForSelector("#server-url", { state: "visible", timeout: 5000 });
  await page.locator("#server-url").fill(serverUrl);
  
  // Click login button
  await page.getByRole("button", { name: /connect/i }).click();
  
  // Wait for redirect to home page
  await page.waitForURL("/", { timeout: 15000 });
}

/**
 * Extended test fixture with authentication helper.
 */
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  /**
   * Page that is already authenticated to the Ferrotune server.
   */
  authenticatedPage: async ({ page }, use) => {
    await login(page);
    
    // Verify we're logged in by checking for sidebar or home content
    await expect(page.locator("body")).not.toContainText("Login");
    
    await use(page);
  },
});

export { expect };

/**
 * Helper to wait for network idle (useful after navigation).
 */
export async function waitForNetworkIdle(page: Page, timeout = 5000) {
  await page.waitForLoadState("networkidle", { timeout });
}

/**
 * Helper to wait for a toast notification.
 */
export async function waitForToast(page: Page, text: string | RegExp) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: text });
  await expect(toast).toBeVisible({ timeout: 5000 });
  return toast;
}

/**
 * Helper to click a play button and verify playback started.
 */
export async function clickPlayAndVerify(page: Page, playButton: ReturnType<Page["locator"]>) {
  await playButton.click();
  
  // Wait for player bar to show current track
  const playerBar = page.locator("[class*='player']").first();
  await expect(playerBar).toBeVisible({ timeout: 5000 });
}

/**
 * Helper to get the current track info from player bar.
 */
export async function getCurrentTrack(page: Page) {
  const playerBar = page.locator("div").filter({ hasText: /now playing/i }).first();
  const title = await playerBar.locator("a").first().textContent();
  const artist = await playerBar.locator("a").nth(1).textContent();
  return { title, artist };
}

/**
 * Helper to search for content.
 */
export async function searchFor(page: Page, query: string) {
  await page.goto("/search");
  await page.getByPlaceholder(/search/i).fill(query);
  
  // Wait for search results to load
  await page.waitForResponse(
    (response) => response.url().includes("search3") && response.status() === 200,
    { timeout: 10000 }
  );
}

/**
 * Helper to navigate to library section.
 */
export async function goToLibrary(page: Page, section?: "albums" | "artists" | "songs" | "genres") {
  const path = section ? `/library/${section}` : "/library/albums";
  await page.goto(path);
  
  await waitForNetworkIdle(page);
}

/**
 * Helper to wait for the player to be ready for playback.
 */
export async function waitForPlayerReady(page: Page, timeout = 5000) {
  // Wait for player bar to show a track
  const playerBar = page.locator('[data-testid="player-bar"], footer, .player-bar');
  await expect(playerBar).toBeVisible({ timeout });
  
  // Wait for play/pause button to be interactive
  const playPauseButton = playerBar.getByRole("button", { name: /play|pause/i }).first();
  await expect(playPauseButton).toBeEnabled({ timeout });
}

/**
 * Helper to play the first song from the Test Album.
 * This specifically targets "Test Album" which contains "First Song", "Second Song", "Third Song"
 */
export async function playFirstSong(page: Page) {
  // Navigate to library (albums tab is default)
  await page.goto("/library");
  await page.waitForLoadState("networkidle");
  
  // Wait for albums to load - handle both grid and list views
  // In grid view: [data-testid="media-card"]
  // In list view: link with album name
  const albumLoaded = await Promise.race([
    page.waitForSelector('[data-testid="media-card"]', { timeout: 10000 }).then(() => 'grid'),
    page.waitForSelector('a:has-text("Test Album")', { timeout: 10000 }).then(() => 'list'),
  ]).catch(() => null);
  
  if (!albumLoaded) {
    throw new Error('Could not find albums in library');
  }
  
  // Click specifically on "Test Album" (works in both views)
  const testAlbum = page.locator('a').filter({ hasText: /^Test Album/ }).first();
  await testAlbum.click();
  
  // Wait for navigation to album detail page
  await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
  
  // Wait for tracks to load
  await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
  
  // Double-click first track to play
  const firstTrack = page.locator('[data-testid="song-row"]').first();
  await firstTrack.dblclick();
}

/**
 * Helper to get queue items count.
 */
export async function getQueueItemsCount(page: Page): Promise<number> {
  // Open queue panel if not open
  const queueButton = page.getByRole("button", { name: /queue/i }).first();
  if (await queueButton.isVisible()) {
    await queueButton.click();
  }
  
  // Count items in queue
  const queueItems = page.locator('[data-testid="queue-item"]');
  const count = await queueItems.count();
  
  return count;
}
