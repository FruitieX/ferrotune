import { test, expect, testConfig, login, skipSetupIfNeeded } from "./fixtures";

test.describe("Authentication", () => {
  // Clear localStorage before each test to ensure independence
  test.beforeEach(async ({ page }) => {
    // Navigate to login page
    await page.goto("/login");

    // Clear all storage to start fresh
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Reload and wait for any redirects
    await page.reload();
    await page.waitForTimeout(500);

    // Skip setup if we got redirected there
    await skipSetupIfNeeded(page, testConfig.serverUrl);
  });

  test("shows login page when not authenticated", async ({ page }) => {
    // Navigate to login if not already there
    if (!page.url().includes("/login")) {
      await page.goto("/login");
    }

    // Wait for login form to fully load
    await page.waitForSelector("#username", {
      state: "visible",
      timeout: 15000,
    });

    // Password tab is default, so username/password inputs should be visible
    await expect(page.locator("#username")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();

    // Server URL is now hidden in Advanced Settings
    await expect(page.locator("#server-url")).not.toBeVisible();

    // Click Advanced Settings to reveal server URL
    await page.getByRole("button", { name: /advanced settings/i }).click();
    await expect(page.locator("#server-url")).toBeVisible();
  });

  test("can login with valid credentials", async ({ page }) => {
    await login(page);

    // Should be on home page
    await expect(page).toHaveURL("/");

    // Should show home page content
    await expect(
      page.getByText(/recently added|random|welcome/i),
    ).toBeVisible();
  });

  test("shows error with invalid credentials", async ({ page }) => {
    await page.goto("/login");

    // Wait for the form to be fully loaded (after setup status check)
    await page.waitForSelector("#username", {
      state: "visible",
      timeout: 15000,
    });
    await page.waitForTimeout(500);

    // Fill in invalid credentials with explicit clicks to ensure focus
    const usernameInput = page.locator("#username");
    await usernameInput.click();
    await usernameInput.fill("wronguser");

    const passwordInput = page.locator("#password");
    await passwordInput.click();
    await passwordInput.fill("wrongpass");

    // Open advanced settings to set server URL
    await page.getByRole("button", { name: /advanced settings/i }).click();
    await page.waitForSelector("#server-url", {
      state: "visible",
      timeout: 5000,
    });

    const serverUrlInput = page.locator("#server-url");
    await serverUrlInput.click();
    await serverUrlInput.fill(testConfig.serverUrl);

    // Verify fields have values before clicking connect
    await expect(usernameInput).toHaveValue("wronguser");
    await expect(passwordInput).toHaveValue("wrongpass");
    await expect(serverUrlInput).toHaveValue(testConfig.serverUrl);

    // Wait for button to become enabled
    const connectButton = page.getByRole("button", { name: /connect/i });
    await expect(connectButton).toBeEnabled({ timeout: 5000 });
    await connectButton.click();

    // Should show error message (inline in the form)
    // Look for text containing error-related words in the error container
    await expect(
      page.getByText(
        /authentication failed|unable to connect|error|invalid|unauthorized/i,
      ),
    ).toBeVisible({ timeout: 10000 });

    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test("can login with API key", async ({ page }) => {
    // Skip if no API key configured for testing
    const apiKey = process.env.FERROTUNE_TEST_API_KEY;
    if (!apiKey) {
      test.skip();
      return;
    }

    await page.goto("/login");

    // Switch to API Key tab (Password is now default)
    await page.getByRole("tab", { name: /api key/i }).click();

    // Fill in API key
    await page.locator("#api-key").fill(apiKey);

    // Open advanced settings to set server URL
    await page.getByRole("button", { name: /advanced settings/i }).click();
    await page.locator("#server-url").fill(testConfig.serverUrl);

    // Submit
    await page.getByRole("button", { name: /connect/i }).click();

    // Should redirect to home
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });

  test("persists login across page reload", async ({ page }) => {
    // Login using helper
    await login(page);

    // Reload page
    await page.reload();

    // Should still be on home (not redirected to login)
    await expect(page).toHaveURL("/");
    await expect(
      page.getByText(/recently added|random|welcome/i),
    ).toBeVisible();
  });

  test("can logout from profile", async ({ authenticatedPage: page }) => {
    // Go to profile page (where sign out is located)
    await page.goto("/profile");

    // Wait for profile to load - look for "Sign Out" card heading
    await expect(
      page.getByText("Your account and listening activity"),
    ).toBeVisible();

    // Click sign out button to open confirmation dialog
    await page
      .getByRole("button", { name: /sign out/i })
      .first()
      .click();

    // Wait for dialog and click confirm
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /sign out/i })
      .click();

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
