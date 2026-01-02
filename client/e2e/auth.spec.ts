/**
 * Authentication tests - Core login/logout functionality
 */

import { test, expect, login } from "./fixtures";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
  });

  test("can login with valid credentials", async ({ page, server }) => {
    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    await expect(page).toHaveURL("/");
    await expect(
      page.getByText(/recently added|random|welcome/i),
    ).toBeVisible();
  });

  test("shows error with invalid credentials", async ({ page, server }) => {
    await page.goto("/login");
    await page.waitForSelector("#username", {
      state: "visible",
      timeout: 15000,
    });

    await page.locator("#username").fill("wronguser");
    await page.locator("#password").fill("wrongpass");

    await page.getByRole("button", { name: /advanced settings/i }).click();
    await page.locator("#server-url").fill(server.url);

    await page.getByRole("button", { name: /connect/i }).click();

    await expect(
      page.getByText(
        /authentication failed|unable to connect|error|invalid|unauthorized/i,
      ),
    ).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("session persists after page reload", async ({ page, server }) => {
    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    await page.reload();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByText(/recently added|random|welcome/i),
    ).toBeVisible();
  });
});
