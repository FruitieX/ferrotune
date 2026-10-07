/**
 * Recycle bin tests - runs on its own server because emptying the bin
 * deletes files from the fixture library.
 */

import { isolatedTest as test, expect, type ServerInfo } from "./fixtures";

function basicAuth(server: ServerInfo): string {
  return `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`;
}

test.describe("Recycle bin", () => {
  test("lists marked songs and Empty All deletes every one", async ({
    authenticatedPage: page,
    server,
  }) => {
    const headers = { Authorization: basicAuth(server) };
    const allowed = await page.request.fetch(`${server.url}/api/config`, {
      method: "PUT",
      headers,
      data: { allowFileDeletion: true },
    });
    expect(allowed.ok()).toBe(true);
    const search = await page.request.get(
      `${server.url}/api/search?query=Song&artistCount=0&albumCount=0&songCount=3`,
      { headers },
    );
    const songs: { id: string; title: string }[] = (await search.json())
      .searchResult.song;
    const marked = await page.request.post(
      `${server.url}/api/recycle-bin/mark`,
      { headers, data: { songIds: songs.map((song) => song.id) } },
    );
    expect(marked.ok()).toBe(true);

    await page.goto("/admin/recycle-bin");
    for (const song of songs) {
      await expect(page.getByText(song.title, { exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Empty All" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: /empty|delete/i }).click();
    await expect(page.getByText(/Permanently deleted 3 songs/)).toBeVisible();

    const after = await page.request.get(`${server.url}/api/recycle-bin`, {
      headers,
    });
    expect((await after.json()).totalCount).toBe(0);
  });
});
