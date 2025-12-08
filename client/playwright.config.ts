import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Ferrotune client E2E tests.
 *
 * Tests automatically start a fresh Ferrotune server with test fixtures.
 *
 * Environment variables:
 * - FERROTUNE_EXTERNAL_SERVER=true: Use an external server instead of starting one
 * - FERROTUNE_TEST_URL: Server URL when using external server (default: http://localhost:4040)
 * - FERROTUNE_TEST_USER: Username (default: testadmin)
 * - FERROTUNE_TEST_PASS: Password (default: testpass)
 * - DEBUG=true: Show server output
 */
export default defineConfig({
  testDir: "./e2e",

  /* Global setup and teardown */
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  /* Run tests sequentially - tests share a single server instance and can interfere
   * with each other when run in parallel (e.g., modifying playlists, queue state).
   * TODO: Add per-worker server isolation for parallel test support */
  fullyParallel: false,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Single worker to prevent test interference from shared server state */
  workers: 1,

  /* Global timeout per test */
  timeout: 30_000,

  /* Expect timeout */
  expect: {
    timeout: 10_000,
  },

  /* Reporter to use */
  reporter: [["html", { open: "never" }], ["list"]],

  /* Shared settings for all projects */
  use: {
    /* Base URL for the client app */
    baseURL: "http://localhost:13000",

    /* Collect trace when retrying the failed test */
    trace: "on-first-retry",

    /* Take screenshot on failure */
    screenshot: "only-on-failure",

    /* Video recording */
    video: "on-first-retry",

    /* Action timeout */
    actionTimeout: 10_000,

    /* Navigation timeout */
    navigationTimeout: 15_000,
  },

  /* Configure projects for major browsers */
  projects: [
    /* Desktop Chrome */
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    /* Mobile Chrome */
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  /* Note: Next.js dev server is started in global-setup.ts alongside the Ferrotune backend */
});
