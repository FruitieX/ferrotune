import { test as base, expect, Page } from "@playwright/test";
import { execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as os from "os";
import {
  gotoAppPath,
  setStoredConnection,
  waitForAuthenticatedHome,
} from "./app-helpers";

/**
 * Server info for a dedicated Ferrotune test instance.
 */
export interface ServerInfo {
  url: string;
  username: string;
  password: string;
  tempDir: string;
  process: ChildProcess;
}

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

/** Find the ferrotune binary */
function findBinary(): string {
  const projectRoot = path.resolve(__dirname, "../..");

  // Try debug build first
  const debugBinary = path.join(projectRoot, "target/debug/ferrotune");
  if (fs.existsSync(debugBinary)) {
    return debugBinary;
  }

  // Try release build
  const releaseBinary = path.join(projectRoot, "target/release/ferrotune");
  if (fs.existsSync(releaseBinary)) {
    return releaseBinary;
  }

  throw new Error(
    "Ferrotune binary not found. Run 'cargo build' in the project root first.",
  );
}

/** Copy directory recursively */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function sanitizeInstanceName(instanceName: string): string {
  return instanceName.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate an available port for E2E"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function getExternalServerInfo(): ServerInfo {
  return {
    url: process.env.FERROTUNE_TEST_URL || "http://localhost:4040",
    username: process.env.FERROTUNE_TEST_USER || "admin",
    password: process.env.FERROTUNE_TEST_PASS || "admin",
    tempDir: "",
    process: null as unknown as ChildProcess,
  };
}

async function cleanupServer(serverInfo: ServerInfo): Promise<void> {
  if (!serverInfo.tempDir) {
    return;
  }

  serverInfo.process.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    serverInfo.process.kill("SIGKILL");
  } catch {
    // Already dead
  }

  fs.rmSync(serverInfo.tempDir, { recursive: true, force: true });
}

let isolatedServerCounter = 0;

function nextIsolatedServerName(): string {
  isolatedServerCounter += 1;
  return `test-${process.pid}-${isolatedServerCounter}`;
}

/** Wait for server to be ready */
async function waitForServer(
  url: string,
  timeout: number = 30000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Spawn a dedicated Ferrotune server for a test worker or isolated test.
 */
async function spawnServer(instanceName: string): Promise<ServerInfo> {
  const binary = findBinary();
  const projectRoot = path.resolve(__dirname, "../..");
  const port = await getAvailablePort();
  const sanitizedInstanceName = sanitizeInstanceName(instanceName);

  // Create a unique temp directory for this test instance.
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `ferrotune-e2e-${sanitizedInstanceName}-`),
  );
  const dbPath = path.join(tempDir, "ferrotune.db");
  const configPath = path.join(tempDir, "config.toml");
  const cacheDir = path.join(tempDir, "cache");
  const musicDir = path.join(tempDir, "music");

  fs.mkdirSync(cacheDir, { recursive: true });

  // Copy test fixtures
  const fixturesMusic = path.join(projectRoot, "tests/fixtures/music");
  copyDirSync(fixturesMusic, musicDir);

  const username = "testadmin";
  const password = "testpass";

  const config = `
[server]
host = "127.0.0.1"
port = ${port}
name = "Ferrotune E2E ${instanceName}"
admin_user = "${username}"
admin_password = "${password}"

[database]
path = "${dbPath}"

[music]
readonly_tags = false

[[music.folders]]
name = "Test Music"
path = "${musicDir}"

[cache]
path = "${cacheDir}"
max_cover_size = 512
`;

  fs.writeFileSync(configPath, config);

  // Scan the library first
  execSync(`"${binary}" --config "${configPath}" scan`, {
    stdio: "pipe",
    encoding: "utf-8",
  });

  // Start the server with FERROTUNE_TESTING enabled for test isolation
  const serverProcess = spawn(binary, ["--config", configPath, "serve"], {
    stdio: "pipe",
    detached: false,
    env: {
      ...process.env,
      FERROTUNE_TESTING: "true",
    },
  });

  let serverError = "";

  serverProcess.stderr?.on("data", (data) => {
    serverError += data.toString();
    if (process.env.DEBUG) {
      console.error(`[ferrotune-${instanceName}] ${data}`);
    }
  });

  serverProcess.stdout?.on("data", (data) => {
    if (process.env.DEBUG) {
      console.log(`[ferrotune-${instanceName}] ${data}`);
    }
  });

  serverProcess.on("error", (err) => {
    console.error(`Instance ${instanceName} failed to start server:`, err);
  });

  // Wait for server to be ready
  const pingUrl = `http://127.0.0.1:${port}/rest/ping?u=${username}&p=${password}&v=1.16.1&c=test&f=json`;
  const ready = await waitForServer(pingUrl);

  if (!ready) {
    console.error(
      `Instance ${instanceName} server failed to start. Errors:`,
      serverError,
    );
    serverProcess.kill();
    throw new Error(
      `Ferrotune server for ${instanceName} failed to start within timeout`,
    );
  }

  // Mark setup as complete
  await fetch(
    `http://127.0.0.1:${port}/ferrotune/setup/complete?u=${username}&p=${password}&v=1.16.1&c=test&f=json`,
    {
      method: "POST",
    },
  );

  return {
    url: `http://127.0.0.1:${port}`,
    username,
    password,
    tempDir,
    process: serverProcess,
  };
}

async function setupAuthenticatedPage(page: Page, server: ServerInfo) {
  // Navigate to the app first so localStorage is available on the correct origin.
  await page.goto("/");

  await resetState(page, server);

  await setStoredConnection(page, {
    serverUrl: server.url,
    username: server.username,
    password: server.password,
  });

  // Navigate back into the app explicitly so we don't get stuck reloading /login.
  await gotoAppPath(page, "/");
  await waitForAuthenticatedHome(page);
}

/**
 * Extended test fixture with per-worker server and authentication.
 */
export const test = base.extend<
  {
    authenticatedPage: Page;
  },
  {
    server: ServerInfo;
  }
>({
  /**
   * Worker-scoped fixture: spawns a dedicated Ferrotune server for this worker.
   * This ensures complete isolation between parallel test workers.
   */
  server: [
    async ({ browserName: _browserName }, use, workerInfo) => {
      // Skip spawning if using external server
      if (process.env.FERROTUNE_EXTERNAL_SERVER === "true") {
        const serverInfo = getExternalServerInfo();
        await use(serverInfo);
        return;
      }

      const serverInfo = await spawnServer(`worker-${workerInfo.workerIndex}`);

      await use(serverInfo);
      await cleanupServer(serverInfo);
    },
    { scope: "worker" },
  ],

  /**
   * Page that is already authenticated to the Ferrotune server.
   * Authentication is done programmatically by setting localStorage.
   */
  authenticatedPage: async ({ page, server }, use) => {
    await setupAuthenticatedPage(page, server);

    // eslint-disable-next-line react-hooks/rules-of-hooks -- This is Playwright's fixture `use`, not React's hook
    await use(page);
  },
});

export const isolatedTest = base.extend<{
  authenticatedPage: Page;
  server: ServerInfo;
}>({
  server: async ({ browserName: _browserName }, runFixture) => {
    if (process.env.FERROTUNE_EXTERNAL_SERVER === "true") {
      const serverInfo = getExternalServerInfo();
      await runFixture(serverInfo);
      return;
    }

    const serverInfo = await spawnServer(nextIsolatedServerName());

    await runFixture(serverInfo);
    await cleanupServer(serverInfo);
  },

  authenticatedPage: async ({ page, server }, use) => {
    await setupAuthenticatedPage(page, server);

    // eslint-disable-next-line react-hooks/rules-of-hooks -- This is Playwright's fixture `use`, not React's hook
    await use(page);
  },
});

export { expect };

/**
 * Helper to wait for page to be ready after navigation.
 */
export async function waitForPageReady(page: Page, timeout = 5000) {
  await page.waitForLoadState("domcontentloaded", { timeout });
  await page.waitForLoadState("load", { timeout });
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
  await page.waitForResponse(
    (response) =>
      response.url().includes("search") && response.status() === 200,
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
  await gotoAppPath(page, path);
  await waitForPageReady(page);
}

/**
 * Helper to wait for library content to load (handles virtualization).
 */
export async function waitForLibraryContent(page: Page, timeout = 15000) {
  const content = page
    .locator(
      '[data-testid="media-card"], [data-testid="media-row"], [data-testid="song-row"], [data-testid="artist-row"]',
    )
    .first();
  await expect(content).toBeVisible({ timeout });
}

/**
 * Helper to wait for the player to be ready for playback.
 */
export async function waitForPlayerReady(page: Page, timeout = 5000) {
  const playerBar = page.locator(
    '[data-testid="player-bar"], footer, .player-bar',
  );
  await expect(playerBar).toBeVisible({ timeout });
  const playPauseButton = playerBar
    .getByRole("button", { name: /play|pause/i })
    .first();
  await expect(playPauseButton).toBeEnabled({ timeout });
}

/**
 * Helper to play a song from the Test Album by zero-based track index.
 */
export async function playTestAlbumSong(page: Page, trackIndex: number) {
  await gotoAppPath(page, "/library");
  await page.waitForLoadState("domcontentloaded");

  const gridCard = page.locator('[data-testid="media-card"]').first();
  const listAlbumLink = page
    .locator("a")
    .filter({ hasText: /^Test Album/ })
    .first();

  const hasGrid = await gridCard
    .isVisible({ timeout: 10000 })
    .catch(() => false);
  if (!hasGrid) {
    await expect(listAlbumLink).toBeVisible({ timeout: 10000 });
  }

  const testAlbum = page
    .locator("a")
    .filter({ hasText: /^Test Album/ })
    .first();
  await testAlbum.click();

  await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
  await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

  const track = page.locator('[data-testid="song-row"]').nth(trackIndex);
  await track.dblclick();
}

/**
 * Helper to play the first song from the Test Album.
 */
export async function playFirstSong(page: Page) {
  await playTestAlbumSong(page, 0);
}

/**
 * Helper to get queue items count.
 */
export async function getQueueItemsCount(page: Page): Promise<number> {
  const queueButton = page.getByRole("button", { name: /queue/i }).first();
  if (await queueButton.isVisible()) {
    await queueButton.click();
  }
  const queueItems = page.locator('[data-testid="queue-item"]');
  return await queueItems.count();
}

/**
 * Helper function to log in with username/password (for auth.spec.ts tests).
 */
export async function login(
  page: Page,
  options: {
    serverUrl: string;
    username: string;
    password: string;
  },
) {
  const { serverUrl, username, password } = options;

  // Clear any existing auth state
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await page.goto("/login");

  // Wait for login form
  await page.waitForSelector("#username", { state: "visible", timeout: 10000 });

  // Fill credentials
  const usernameInput = page.locator("#username");
  await usernameInput.click();
  await usernameInput.fill(username);

  const passwordInput = page.locator("#password");
  await passwordInput.click();
  await passwordInput.fill(password);

  // Open advanced settings and set server URL
  const advancedButton = page.getByRole("button", {
    name: /advanced settings/i,
  });
  await advancedButton.click();

  await page.waitForSelector("#server-url", {
    state: "visible",
    timeout: 5000,
  });
  const serverUrlInput = page.locator("#server-url");
  await serverUrlInput.click();
  await serverUrlInput.fill(serverUrl);

  // Click login
  const connectButton = page.getByRole("button", { name: /connect/i });
  await expect(connectButton).toBeEnabled({ timeout: 5000 });
  await connectButton.click();

  // Wait for redirect to home
  await page.waitForURL("/", { timeout: 20000 });
  await page.waitForSelector("h1:has-text('Home')", { timeout: 10000 });
}

/**
 * Helper to reset all server state for test isolation.
 *
 * This calls the /ferrotune/testing/reset endpoint which clears:
 * - Play queues and preferences
 * - Starred items and ratings
 * - Playlists and smart playlists
 * - Scrobbles and listening history
 * - Tagger sessions
 *
 * Requires the server to be started with FERROTUNE_TESTING=true.
 */
export async function resetServerState(
  page: Page,
  server: ServerInfo,
): Promise<void> {
  const authParams = `u=${server.username}&p=${server.password}&v=1.16.1&c=e2e-test`;
  const response = await page.request.post(
    `${server.url}/ferrotune/testing/reset?${authParams}`,
  );

  if (!response.ok()) {
    const body = await response.text();
    console.warn(`Failed to reset server state: ${response.status()} ${body}`);
  }
}

/**
 * Helper to clear browser state (localStorage, sessionStorage).
 */
export async function clearBrowserState(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Clear storage but keep auth state
    const connection = localStorage.getItem("ferrotune-connection");
    localStorage.clear();
    sessionStorage.clear();
    // Restore connection so page stays authenticated
    if (connection) {
      localStorage.setItem("ferrotune-connection", connection);
    }
  });
}

/**
 * Helper to reset all state for test isolation.
 */
export async function resetState(
  page: Page,
  server: ServerInfo,
): Promise<void> {
  await clearBrowserState(page);
  await resetServerState(page, server);
}
