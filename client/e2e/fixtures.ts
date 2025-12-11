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
    return (
      envConfig.FERROTUNE_TEST_URL ||
      process.env.FERROTUNE_TEST_URL ||
      "http://localhost:4040"
    );
  },
  get username() {
    const envConfig = loadTestConfig();
    return (
      envConfig.FERROTUNE_TEST_USER ||
      process.env.FERROTUNE_TEST_USER ||
      "admin"
    );
  },
  get password() {
    const envConfig = loadTestConfig();
    return (
      envConfig.FERROTUNE_TEST_PASS ||
      process.env.FERROTUNE_TEST_PASS ||
      "admin"
    );
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
    {
      name: "Test Album",
      artist: "Test Artist",
      year: 2024,
      genre: "Rock",
      tracks: 3,
    },
    {
      name: "Another Album",
      artist: "Another Artist",
      year: 2023,
      genre: "Electronic",
      tracks: 2,
    },
    {
      name: "Compilation Album",
      artist: "Various Artists",
      year: 2022,
      genre: "Pop",
      tracks: 2,
    },
  ],
  tracks: [
    { title: "First Song", artist: "Test Artist", album: "Test Album" },
    { title: "Second Song", artist: "Test Artist", album: "Test Album" },
    { title: "Third Song", artist: "Test Artist", album: "Test Album" },
    {
      title: "FLAC Track One",
      artist: "Another Artist",
      album: "Another Album",
    },
    {
      title: "FLAC Track Two",
      artist: "Another Artist",
      album: "Another Album",
    },
    {
      title: "Compilation Track",
      artist: "Guest Artist",
      album: "Compilation Album",
    },
    {
      title: "Another Compilation",
      artist: "Different Artist",
      album: "Compilation Album",
    },
  ],
  genres: ["Rock", "Electronic", "Pop"],
};

/**
 * Helper function to skip setup wizard if it appears.
 * This is needed because tests start with a fresh database.
 */
export async function skipSetupIfNeeded(page: Page, _serverUrl: string) {
  // Check if we're on the setup page
  const currentUrl = page.url();
  if (currentUrl.includes("/setup")) {
    console.log("[skipSetupIfNeeded] Setup page detected, skipping setup...");

    // Click "Skip Setup" button if visible
    const skipButton = page.getByRole("button", { name: /skip setup/i });
    if (await skipButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipButton.click();

      // Wait for "complete" step to show
      await page.waitForSelector("text=Setup Complete", { timeout: 10000 });

      // Click "Start Listening" to finish
      const startButton = page.getByRole("button", {
        name: /start listening/i,
      });
      await startButton.click();

      // Wait for redirect to login
      await page.waitForURL(/\/(login)?$/, { timeout: 10000 });
      console.log("[skipSetupIfNeeded] Setup skipped successfully");
    }
  }
}

/**
 * Helper function to log in with username/password.
 * Can be used in beforeEach or called directly.
 */
export async function login(
  page: Page,
  options?: {
    serverUrl?: string;
    username?: string;
    password?: string;
  },
) {
  const serverUrl = options?.serverUrl ?? testConfig.serverUrl;
  const username = options?.username ?? testConfig.username;
  const password = options?.password ?? testConfig.password;

  console.log(
    `[login] Logging in with serverUrl=${serverUrl}, username=${username}, password=${password ? "***" : "empty"}`,
  );

  // Clear any existing auth state first by going to login and clearing storage
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Navigate directly to login page (don't reload - go fresh)
  await page.goto("/login");

  // Wait a moment for any redirects to settle
  await page.waitForTimeout(500);

  // Check if we got redirected to setup page
  await skipSetupIfNeeded(page, serverUrl);

  // If we're not on login page, navigate there
  if (!page.url().includes("/login")) {
    await page.goto("/login");
  }

  // Wait for login form to be visible - the page may show "Loading..." briefly
  // while checking setup status. Wait longer and retry navigation if needed.
  try {
    await page.waitForSelector("#username", {
      state: "visible",
      timeout: 10000,
    });
  } catch {
    // If still not visible, the page might be stuck - try navigating again
    console.log("[login] Login form not visible, retrying navigation...");
    await page.goto("/login");
    await page.waitForSelector("#username", {
      state: "visible",
      timeout: 10000,
    });
  }

  // Wait for any animations to complete and form to be interactive
  await page.waitForTimeout(500);

  // Fill in username and password with explicit clicks to ensure focus
  const usernameInput = page.locator("#username");
  await usernameInput.click();
  await usernameInput.fill(username);

  const passwordInput = page.locator("#password");
  await passwordInput.click();
  await passwordInput.fill(password);

  // Open advanced settings to set server URL (it's hidden by default)
  const advancedButton = page.getByRole("button", {
    name: /advanced settings/i,
  });
  await advancedButton.click();

  // Wait for server URL input to appear and fill it
  await page.waitForSelector("#server-url", {
    state: "visible",
    timeout: 5000,
  });
  const serverUrlInput = page.locator("#server-url");
  await serverUrlInput.click();
  await serverUrlInput.fill(serverUrl);

  // Verify fields have values before clicking connect
  await expect(usernameInput).toHaveValue(username);
  await expect(passwordInput).toHaveValue(password);
  await expect(serverUrlInput).toHaveValue(serverUrl);

  // Wait a moment for form to settle and button to become enabled
  await page.waitForTimeout(200);

  // Click login button - wait for it to be enabled first
  const connectButton = page.getByRole("button", { name: /connect/i });
  await expect(connectButton).toBeEnabled({ timeout: 5000 });
  await connectButton.click();

  // Wait for redirect to home page
  // The home page may briefly redirect back to login during hydration,
  // so we wait for the URL to stabilize on "/"
  await page.waitForURL("/", { timeout: 20000 });

  // Wait for home page content to actually render (confirms we're logged in)
  // This ensures the auth state has fully propagated
  await page.waitForSelector("h1:has-text('Home')", { timeout: 10000 });
}

/**
 * Extended test fixture with authentication helper.
 */
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  /**
   * Page that is already authenticated to the Ferrotune server.
   * Authentication is done once in auth.setup.ts and reused via storage state.
   */
  authenticatedPage: async ({ page }, use) => {
    // Verify we're logged in by checking that we're not on login page
    // If storage state is loaded correctly, we should already be authenticated
    await page.goto("/");

    // Wait for home page to load, confirming authentication worked
    await expect(page.locator("h1:has-text('Home')")).toBeVisible({
      timeout: 10000,
    });

    // eslint-disable-next-line react-hooks/rules-of-hooks -- This is Playwright's use() function, not React's
    await use(page);
  },
});

export { expect };

/**
 * Helper to wait for page to be ready after navigation.
 * Instead of networkidle, waits for domcontentloaded and a brief settle time.
 */
export async function waitForPageReady(page: Page, timeout = 5000) {
  await page.waitForLoadState("domcontentloaded", { timeout });
  // Brief settle time for React hydration
  await page.waitForTimeout(100);
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
export async function clickPlayAndVerify(
  page: Page,
  playButton: ReturnType<Page["locator"]>,
) {
  await playButton.click();

  // Wait for player bar to show current track
  const playerBar = page.locator("[class*='player']").first();
  await expect(playerBar).toBeVisible({ timeout: 5000 });
}

/**
 * Helper to get the current track info from player bar.
 */
export async function getCurrentTrack(page: Page) {
  const playerBar = page
    .locator("div")
    .filter({ hasText: /now playing/i })
    .first();
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
    (response) =>
      response.url().includes("search3") && response.status() === 200,
    { timeout: 10000 },
  );
}

/**
 * Helper to navigate to library section.
 */
export async function goToLibrary(
  page: Page,
  section?: "albums" | "artists" | "songs" | "genres",
) {
  const path = section ? `/library/${section}` : "/library/albums";
  await page.goto(path);

  await waitForPageReady(page);
}

/**
 * Helper to wait for the player to be ready for playback.
 */
export async function waitForPlayerReady(page: Page, timeout = 5000) {
  // Wait for player bar to show a track
  const playerBar = page.locator(
    '[data-testid="player-bar"], footer, .player-bar',
  );
  await expect(playerBar).toBeVisible({ timeout });

  // Wait for play/pause button to be interactive
  const playPauseButton = playerBar
    .getByRole("button", { name: /play|pause/i })
    .first();
  await expect(playPauseButton).toBeEnabled({ timeout });
}

/**
 * Helper to play the first song from the Test Album.
 * This specifically targets "Test Album" which contains "First Song", "Second Song", "Third Song"
 */
export async function playFirstSong(page: Page) {
  // Navigate to library (albums tab is default)
  await page.goto("/library");
  await page.waitForLoadState("domcontentloaded");

  // Wait for albums to load - handle both grid and list views
  // In grid view: [data-testid="media-card"]
  // In list view: link with album name
  const albumLoaded = await Promise.race([
    page
      .waitForSelector('[data-testid="media-card"]', { timeout: 10000 })
      .then(() => "grid"),
    page
      .waitForSelector('a:has-text("Test Album")', { timeout: 10000 })
      .then(() => "list"),
  ]).catch(() => null);

  if (!albumLoaded) {
    throw new Error("Could not find albums in library");
  }

  // Click specifically on "Test Album" (works in both views)
  const testAlbum = page
    .locator("a")
    .filter({ hasText: /^Test Album/ })
    .first();
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
