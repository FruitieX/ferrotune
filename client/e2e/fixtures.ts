import { test as base, expect, Page } from "@playwright/test";
import { execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Server info for a worker's dedicated Ferrotune instance.
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
 * Spawn a dedicated Ferrotune server for a worker.
 */
async function spawnServer(workerIndex: number): Promise<ServerInfo> {
  const binary = findBinary();
  const projectRoot = path.resolve(__dirname, "../..");

  // Use unique port per worker (base 15000 + workerIndex * 10 to avoid collisions)
  const port = 15000 + workerIndex * 10;

  // Create temp directory for this worker
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `ferrotune-e2e-worker-${workerIndex}-`),
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
name = "Ferrotune E2E Test Worker ${workerIndex}"
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

  // Start the server
  const serverProcess = spawn(binary, ["--config", configPath, "serve"], {
    stdio: "pipe",
    detached: false,
  });

  let serverError = "";

  serverProcess.stderr?.on("data", (data) => {
    serverError += data.toString();
    if (process.env.DEBUG) {
      console.error(`[ferrotune-${workerIndex}] ${data}`);
    }
  });

  serverProcess.stdout?.on("data", (data) => {
    if (process.env.DEBUG) {
      console.log(`[ferrotune-${workerIndex}] ${data}`);
    }
  });

  serverProcess.on("error", (err) => {
    console.error(`Worker ${workerIndex} failed to start server:`, err);
  });

  // Wait for server to be ready
  const pingUrl = `http://127.0.0.1:${port}/rest/ping?u=${username}&p=${password}&v=1.16.1&c=test&f=json`;
  const ready = await waitForServer(pingUrl);

  if (!ready) {
    console.error(
      `Worker ${workerIndex} server failed to start. Errors:`,
      serverError,
    );
    serverProcess.kill();
    throw new Error(
      `Ferrotune server for worker ${workerIndex} failed to start within timeout`,
    );
  }

  // Mark setup as complete
  await fetch(`http://127.0.0.1:${port}/ferrotune/setup/complete`, {
    method: "POST",
  });

  return {
    url: `http://127.0.0.1:${port}`,
    username,
    password,
    tempDir,
    process: serverProcess,
  };
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
    async ({}, use, workerInfo) => {
      // Skip spawning if using external server
      if (process.env.FERROTUNE_EXTERNAL_SERVER === "true") {
        const serverInfo: ServerInfo = {
          url: process.env.FERROTUNE_TEST_URL || "http://localhost:4040",
          username: process.env.FERROTUNE_TEST_USER || "admin",
          password: process.env.FERROTUNE_TEST_PASS || "admin",
          tempDir: "",
          process: null as unknown as ChildProcess,
        };
        await use(serverInfo);
        return;
      }

      const serverInfo = await spawnServer(workerInfo.workerIndex);

      await use(serverInfo);

      // Teardown: stop server and clean up
      serverInfo.process.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        serverInfo.process.kill("SIGKILL");
      } catch {
        // Already dead
      }
      fs.rmSync(serverInfo.tempDir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],

  /**
   * Page that is already authenticated to the Ferrotune server.
   * Authentication is done programmatically by setting localStorage.
   */
  authenticatedPage: async ({ page, server }, use) => {
    // Navigate to the app first (to set localStorage on the correct origin)
    await page.goto("/");

    // Inject auth state directly into localStorage
    await page.evaluate(
      ({ serverUrl, username, password }) => {
        const connection = {
          serverUrl,
          username,
          password,
        };
        localStorage.setItem(
          "ferrotune-connection",
          JSON.stringify(connection),
        );
      },
      {
        serverUrl: server.url,
        username: server.username,
        password: server.password,
      },
    );

    // Reload to apply the auth state
    await page.reload();

    // Wait for home page to load, confirming authentication worked
    await expect(page.locator("h1:has-text('Home')").first()).toBeVisible({
      timeout: 15000,
    });

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
  await page.goto(path);
  await waitForPageReady(page);
}

/**
 * Helper to wait for library content to load (handles virtualization).
 */
export async function waitForLibraryContent(page: Page, timeout = 15000) {
  // Wait for either media cards (grid) or list rows to appear
  await Promise.race([
    page.waitForSelector('[data-testid="media-card"]', { timeout }),
    page.waitForSelector('[data-testid="media-row"]', { timeout }),
    page.waitForSelector('[data-testid="song-row"]', { timeout }),
    page.waitForSelector('[data-testid="artist-row"]', { timeout }),
  ]);
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
 * Helper to play the first song from the Test Album.
 */
export async function playFirstSong(page: Page) {
  await page.goto("/library");
  await page.waitForLoadState("domcontentloaded");

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

  const testAlbum = page
    .locator("a")
    .filter({ hasText: /^Test Album/ })
    .first();
  await testAlbum.click();

  await page.waitForURL(/\/library\/albums\//, { timeout: 10000 });
  await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });

  const firstTrack = page.locator('[data-testid="song-row"]').first();
  await firstTrack.dblclick();
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
  await page.waitForTimeout(500);

  // Wait for login form
  await page.waitForSelector("#username", { state: "visible", timeout: 10000 });
  await page.waitForTimeout(500);

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

  await page.waitForTimeout(200);

  // Click login
  const connectButton = page.getByRole("button", { name: /connect/i });
  await expect(connectButton).toBeEnabled({ timeout: 5000 });
  await connectButton.click();

  // Wait for redirect to home
  await page.waitForURL("/", { timeout: 20000 });
  await page.waitForSelector("h1:has-text('Home')", { timeout: 10000 });
}
