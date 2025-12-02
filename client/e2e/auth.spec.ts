import { test, expect, testConfig, login } from "./fixtures";

test.describe("Authentication", () => {
  test("shows login page when not authenticated", async ({ page }) => {
    await page.goto("/");
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
    
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
    await expect(page.getByText(/recently added|random|welcome/i)).toBeVisible();
  });

  test("shows error with invalid credentials", async ({ page }) => {
    await page.goto("/login");
    
    // Password tab is now default, no need to switch
    // Fill in invalid credentials
    await page.locator("#username").fill("wronguser");
    await page.locator("#password").fill("wrongpass");
    
    // Open advanced settings to set server URL
    await page.getByRole("button", { name: /advanced settings/i }).click();
    await page.locator("#server-url").fill(testConfig.serverUrl);
    
    // Submit
    await page.getByRole("button", { name: /connect/i }).click();
    
    // Should show error toast or message
    await expect(
      page.getByText(/failed|error|invalid|unauthorized/i)
    ).toBeVisible({ timeout: 5000 });
    
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
    await expect(page.getByText(/recently added|random|welcome/i)).toBeVisible();
  });

  test("can logout from settings", async ({ authenticatedPage: page }) => {
    // Go to settings
    await page.goto("/settings");
    
    // Wait for settings to load
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
    
    // Click sign out button to open confirmation dialog
    await page.getByRole("button", { name: /sign out/i }).first().click();
    
    // Wait for dialog and click confirm
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: /sign out/i }).click();
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
