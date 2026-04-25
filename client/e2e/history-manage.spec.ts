/**
 * Managed listening history tests.
 */

import { test, expect, type ServerInfo } from "./fixtures";
import type { Page } from "@playwright/test";

function authHeaders(server: ServerInfo): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`,
  };
}

async function createHistoryEntries(page: Page, server: ServerInfo) {
  const headers = authHeaders(server);
  const songsResponse = await page.request.get(
    `${server.url}/ferrotune/songs/match-list`,
    { headers },
  );
  expect(songsResponse.ok()).toBeTruthy();

  const songsBody = (await songsResponse.json()) as {
    songs: Array<{ id: string }>;
  };
  const songId = songsBody.songs[0]?.id;
  expect(songId).toBeTruthy();

  const sessionResponse = await page.request.post(
    `${server.url}/ferrotune/listening`,
    {
      headers,
      data: {
        songId,
        durationSeconds: 45,
      },
    },
  );
  expect(sessionResponse.ok()).toBeTruthy();

  const scrobbleResponse = await page.request.post(
    `${server.url}/ferrotune/scrobbles`,
    {
      headers,
      data: {
        id: songId,
        time: Date.now() - 60_000,
        submission: true,
        queueSourceType: "history-manage-e2e",
      },
    },
  );
  expect(scrobbleResponse.ok()).toBeTruthy();
}

test.describe("Managed History", () => {
  test("links from profile and deletes all matching entries", async ({
    authenticatedPage: page,
    server,
  }) => {
    await createHistoryEntries(page, server);

    await page.goto("/profile");
    await expect(
      page.getByText("Listening Activity", { exact: true }),
    ).toBeVisible({ timeout: 10000 });

    await page.locator('a[href="/history/manage"]').click();
    await expect(page).toHaveURL("/history/manage");
    await expect(
      page.getByRole("heading", { name: "Manage listening history" }),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByLabel("From")).toBeVisible();
    await expect(page.getByLabel("To")).toBeVisible();
    await expect(page.getByLabel(/min session duration/i)).toBeVisible();
    await expect(page.getByLabel(/max session duration/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Select all matching filter" }),
    ).toBeVisible();

    await expect(page.getByText("Scrobble").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Session").first()).toBeVisible();

    await page
      .getByRole("button", { name: "Select all matching filter" })
      .click();
    await expect(page.getByText("All matching filters")).toBeVisible();

    await page.getByRole("button", { name: /^delete$/i }).click();
    await expect(
      page.getByText(/entries that are not loaded in the list yet/i),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete entries" }).click();

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /deleted/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("No matching history entries")).toBeVisible({
      timeout: 10000,
    });
  });
});
