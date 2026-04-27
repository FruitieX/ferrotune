import { defineConfig, devices } from "@playwright/test";
import os from "os";

type PlaywrightConfig = Parameters<typeof defineConfig>[0];
type PlaywrightProject = NonNullable<PlaywrightConfig["projects"]>[number];

const projects: PlaywrightProject[] = [
  {
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1440, height: 900 },
    },
    testIgnore: [/mobile\.spec\.ts/, /android-emulator\.spec\.ts/],
  },
  {
    name: "mobile-chrome",
    use: {
      ...devices["Pixel 5"],
    },
    testMatch: /mobile\.spec\.ts/,
  },
];

if (process.env.FERROTUNE_ANDROID_E2E === "true") {
  projects.push({
    name: "android-emulator",
    testMatch: /android-emulator\.spec\.ts/,
  });
}

/**
 * Playwright configuration for Ferrotune client E2E tests.
 *
 * Tests run in parallel with each worker spawning its own Ferrotune server.
 *
 * Environment variables:
 * - FERROTUNE_EXTERNAL_SERVER=true: Use an external server instead of spawning
 * - FERROTUNE_TEST_URL: Server URL when using external server (default: http://localhost:4040)
 * - FERROTUNE_TEST_USER: Username (default: admin)
 * - FERROTUNE_TEST_PASS: Password (default: admin)
 * - DEBUG=true: Show server output
 */
export default defineConfig({
  testDir: "./e2e",

  /* Global setup and teardown (starts/stops Vite preview server) */
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  /* Run tests in parallel - each worker spawns its own server instance */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on failure - helps with flaky tests due to timing/virtualization */
  retries: process.env.CI ? 3 : 1,

  /* Use 50% of available CPUs for parallel execution (max 4 locally to prevent resource exhaustion) */
  workers: process.env.CI
    ? "100%"
    : Math.min(Math.ceil(os.cpus().length / 2), 4),

  /* Global timeout per test */
  timeout: 60_000,

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

  /* Configure projects for major browsers and optional Android emulator */
  projects,
});
