/**
 * App update tests - stale chunks after a deploy and the update notice
 */

import type { Page } from "@playwright/test";
import { test, expect, login } from "./fixtures";

async function navigateInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test.describe("App updates", () => {
  test("a route chunk missing after a deploy offers a reload", async ({
    page,
    server,
  }) => {
    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    // A deploy replaces every hashed asset: chunks this tab has not loaded
    // yet are gone from the server.
    await page.route("**/assets/**", (route) =>
      route.fulfill({ status: 404, body: "Not Found" }),
    );
    await navigateInApp(page, "/history/manage");

    await expect(
      page.getByRole("heading", { name: "Ferrotune has been updated" }),
    ).toBeVisible();
    const reload = page.getByRole("button", { name: "Reload" }).first();
    await expect(reload).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(
      0,
    );

    await page.unroute("**/assets/**");
    await reload.click();
    await expect(
      page.getByRole("heading", { name: "Ferrotune has been updated" }),
    ).toHaveCount(0);
  });

  test("shows an update notice when the server has a newer build", async ({
    page,
    server,
  }) => {
    // Answer the app's background index.html check with a different build;
    // the page navigation itself still gets the real one.
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        const response = await route.fetch();
        if (route.request().resourceType() !== "fetch") {
          await route.fulfill({ response });
          return;
        }
        const html = (await response.text()).replace(
          /\/assets\/index-[^"]+\.js/,
          "/assets/index-newbuild.js",
        );
        await route.fulfill({ response, body: html });
      },
    );

    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });

    await expect(page.getByText("New version available")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  test("shows no update notice while the build is current", async ({
    page,
    server,
  }) => {
    const checked = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/" &&
        response.request().resourceType() === "fetch",
    );

    await login(page, {
      serverUrl: server.url,
      username: server.username,
      password: server.password,
    });
    await (await checked).finished();
    // Give the notice a moment to appear if the check (wrongly) found one.
    await page.waitForTimeout(500);

    await expect(page.getByText("New version available")).toHaveCount(0);
  });
});
