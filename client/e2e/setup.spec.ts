/**
 * Initial setup tests.
 */

import { test, expect } from "@playwright/test";
import { cleanupServer, spawnUnseededServer } from "./fixtures";

test.describe("Initial setup", () => {
  test("completing setup with an empty library does not refetch-loop", async ({
    page,
  }, testInfo) => {
    const server = await spawnUnseededServer(
      `setup-empty-${testInfo.workerIndex}-${testInfo.retry}`,
    );
    const requestCounts = {
      features: 0,
      scanDetails: 0,
    };

    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname === "/api/features") {
        requestCounts.features += 1;
      }
      if (pathname === "/api/scan/details") {
        requestCounts.scanDetails += 1;
      }
    });

    await page.route(
      "http://localhost:13000/api/setup/status",
      async (route) => {
        const response = await fetch(`${server.url}/api/setup/status`);
        await route.fulfill({
          status: response.status,
          headers: { "content-type": "application/json" },
          body: await response.text(),
        });
      },
    );

    try {
      await page.goto("/setup");
      await page.getByRole("button", { name: /get started/i }).click();

      await page.locator("#server").fill(server.url);
      await page.locator("#username").fill(server.username);
      await page.locator("#password").fill(server.password);
      await page.getByRole("button", { name: /^continue$/i }).click();

      await expect(page.getByText("Add Music Folders")).toBeVisible();

      await page.locator("#folderName").fill("Empty Music");
      await page.getByPlaceholder("/path/to/music").fill(server.musicDir);
      await page.getByRole("button", { name: /^continue$/i }).click();
      await expect(page.getByText("Scan Your Library")).toBeVisible();

      await page.getByRole("button", { name: /^continue$/i }).click();
      await expect(page.getByText("Setup Complete!")).toBeVisible();

      await page.getByRole("button", { name: /start listening/i }).click();
      await expect(page).toHaveURL("/");
      await expect(
        page.getByText(/welcome|recently added|random/i).first(),
      ).toBeVisible();

      expect(requestCounts.features).toBeLessThanOrEqual(3);
      expect(requestCounts.scanDetails).toBeLessThanOrEqual(3);
    } finally {
      await cleanupServer(server);
    }
  });
});
