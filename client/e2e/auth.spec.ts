/**
 * Authentication tests - Core login/logout functionality
 */

import type { Page } from "@playwright/test";
import { test, expect, login } from "./fixtures";

async function persistedQueryBlobIncludes(
  page: Page,
  expectedText: string,
): Promise<boolean> {
  return page.evaluate(async (text) => {
    return await new Promise<boolean>((resolve) => {
      const openRequest = indexedDB.open("ferrotune-cache");

      openRequest.onerror = () => resolve(false);
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        const transaction = db.transaction("cache-store", "readonly");
        const store = transaction.objectStore("cache-store");
        const getRequest = store.getAll();

        getRequest.onerror = () => {
          db.close();
          resolve(false);
        };
        getRequest.onsuccess = () => {
          db.close();
          resolve(
            getRequest.result.some(
              (value) => typeof value === "string" && value.includes(text),
            ),
          );
        };
      };
    });
  }, expectedText);
}

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();

      if (!indexedDB.databases) {
        return;
      }

      const databases = await indexedDB.databases();
      await Promise.all(
        databases.map(
          ({ name }) =>
            new Promise<void>((resolve) => {
              if (!name) {
                resolve();
                return;
              }

              const deleteRequest = indexedDB.deleteDatabase(name);
              deleteRequest.onerror = () => resolve();
              deleteRequest.onsuccess = () => resolve();
              deleteRequest.onblocked = () => resolve();
            }),
        ),
      );
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
      page
        .getByText(
          /authentication failed|unable to connect|error|invalid|unauthorized/i,
        )
        .first(),
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

  test("discover keeps the cached cards visible during background refresh", async ({
    page,
    server,
  }) => {
    const cachedDiscoverTitle = `Discover Cached ${Date.now()}`;
    const freshDiscoverTitle = `Discover Fresh ${Date.now()}`;
    let homeVariant: "cached" | "fresh" = "cached";

    await page.route("**/ferrotune/home*", async (route) => {
      const response = await route.fetch();
      const homeResponse: {
        discover: { album: Array<{ name: string }> };
      } = await response.json();

      if (homeResponse.discover.album[0]) {
        homeResponse.discover.album[0].name =
          homeVariant === "cached" ? cachedDiscoverTitle : freshDiscoverTitle;
      }

      await route.fulfill({ response, json: homeResponse });
    });

    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    await expect(page.getByText(cachedDiscoverTitle).first()).toBeVisible({
      timeout: 15000,
    });

    await expect
      .poll(async () => persistedQueryBlobIncludes(page, cachedDiscoverTitle), {
        timeout: 30000,
      })
      .toBe(true);

    homeVariant = "fresh";
    const refreshedHomeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.status() === 200 &&
        response.url().includes("/ferrotune/home"),
    );

    await page.reload();
    await refreshedHomeResponse;

    await expect(page.getByText(cachedDiscoverTitle).first()).toBeVisible({
      timeout: 15000,
    });
    await expect
      .poll(async () => page.getByText(freshDiscoverTitle).count())
      .toBe(0);

    await page.getByRole("link", { name: /^library$/i }).click();
    await expect(page).toHaveURL(/\/library/);

    await page.getByRole("link", { name: /^home$/i }).click();
    await expect(page).toHaveURL("/");

    await expect(page.getByText(freshDiscoverTitle).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("switching accounts refetches sidebar data", async ({
    page,
    server,
  }) => {
    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    await page.evaluate(() => {
      const connection = JSON.parse(
        localStorage.getItem("ferrotune-connection") || "null",
      );
      if (!connection) {
        throw new Error("Missing active connection in localStorage");
      }

      localStorage.setItem(
        "ferrotune-saved-accounts",
        JSON.stringify([
          connection,
          {
            ...connection,
            serverUrl: `${connection.serverUrl}/`,
            label: "Secondary account",
          },
        ]),
      );
    });

    await page.reload();

    await page.getByRole("button", { name: /testadmin@/i }).click();

    const sidebarRefetch = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.status() === 200 &&
        response.url().includes("/ferrotune/playlist-folders"),
    );

    await page.getByRole("menuitem", { name: /secondary account/i }).click();

    await sidebarRefetch;

    await expect
      .poll(() =>
        page.evaluate(() => {
          const connection = JSON.parse(
            localStorage.getItem("ferrotune-connection") || "null",
          );
          return connection?.serverUrl || "";
        }),
      )
      .toMatch(/\/$/);
  });
});
