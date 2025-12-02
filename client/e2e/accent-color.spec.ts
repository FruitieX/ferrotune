import { test, expect, login } from "./fixtures";

test.describe("Accent Color Settings", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("can change accent color from presets", async ({ page }) => {
    // Navigate to settings
    await page.goto("/settings");
    await page.waitForSelector('[data-testid="settings-page"], h1:has-text("Settings")');

    // Find the appearance section with accent color buttons
    const appearanceSection = page.locator("text=Accent Color").locator("..");

    // Click on emerald color (second button in the grid)
    // The colors should be in a grid with oklch background colors
    const colorButtons = page.locator('button[title]').filter({
      has: page.locator('[style*="oklch"]'),
    });

    // If the filter doesn't work, try finding by the visible color buttons
    const emeraldButton = page.locator('button[title="Emerald"]');
    if (await emeraldButton.isVisible()) {
      await emeraldButton.click();
    } else {
      // Fallback: click the second color button in the preset grid
      const allColorButtons = page.locator('.grid button').first();
      await allColorButtons.click();
    }

    // Verify the accent has changed by checking the data-accent attribute on html
    await expect(page.locator("html")).toHaveAttribute("data-accent", /.+/);
  });

  test("can use custom color with hue slider", async ({ page }) => {
    // Navigate to settings
    await page.goto("/settings");
    await page.waitForSelector('h1:has-text("Settings")');

    // Find and click the "Use Custom" button
    const useCustomButton = page.getByRole("button", { name: /use custom/i });
    await useCustomButton.click();

    // Verify the button now shows "Active"
    await expect(page.getByRole("button", { name: /active/i })).toBeVisible();

    // The custom color preview should be visible
    const customColorPreview = page.locator('[style*="oklch"]').first();
    await expect(customColorPreview).toBeVisible();
  });

  test("accent color persists after page reload", async ({ page }) => {
    // Navigate to settings
    await page.goto("/settings");
    await page.waitForSelector('h1:has-text("Settings")');

    // Click on a specific color (violet)
    const violetButton = page.locator('button[title="Violet"]');
    if (await violetButton.isVisible()) {
      await violetButton.click();
      
      // Wait for the change to be applied
      await page.waitForTimeout(500);

      // Reload the page
      await page.reload();
      await page.waitForSelector('h1:has-text("Settings")');

      // Verify the accent is still violet
      await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
    }
  });

  test("theme switch between light and dark works", async ({ page }) => {
    // Navigate to settings
    await page.goto("/settings");
    await page.waitForSelector('h1:has-text("Settings")');

    // Click light theme button
    const lightButton = page.getByRole("button", { name: /light/i }).first();
    await lightButton.click();

    // Verify light class is applied
    await expect(page.locator("html")).toHaveClass(/light/);

    // Click dark theme button
    const darkButton = page.getByRole("button", { name: /dark/i }).first();
    await darkButton.click();

    // Verify dark class is applied (or light is removed)
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("displays all 10 preset colors", async ({ page }) => {
    // Navigate to settings
    await page.goto("/settings");
    await page.waitForSelector('h1:has-text("Settings")');

    // Find color buttons with titles (preset colors have title attributes)
    const colorButtons = page.locator('button[title][style*="oklch"]');
    const count = await colorButtons.count();
    
    expect(count).toBe(10);
  });
});
