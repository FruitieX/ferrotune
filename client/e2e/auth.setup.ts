import { test as setup, expect } from "@playwright/test";
import { login } from "./fixtures";

const authFile = "e2e/.auth/user.json";

/**
 * Setup project that authenticates once and saves the state.
 * This state is then reused across all tests, avoiding repeated logins.
 */
setup("authenticate", async ({ page }) => {
  await login(page);

  // Verify we're logged in by checking for home page content
  await expect(page.locator("h1:has-text('Home')")).toBeVisible({
    timeout: 10000,
  });

  // Save signed-in state to reuse in tests
  await page.context().storageState({ path: authFile });
});
