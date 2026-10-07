/**
 * Keyboard shortcut tests - player shortcuts stay out of the browser's and
 * focused widgets' way.
 */

import type { Page } from "@playwright/test";
import { test, expect, resetState, waitForLibraryContent } from "./fixtures";

function volumeThumb(page: Page) {
  return page
    .getByTestId("player-bar")
    .locator('[aria-label="Volume"] [role="slider"]');
}

async function volume(page: Page): Promise<number> {
  return Math.round(
    Number(await volumeThumb(page).getAttribute("aria-valuenow")),
  );
}

test.describe("Keyboard shortcuts", () => {
  test.beforeEach(async ({ authenticatedPage: page, server }) => {
    await resetState(page, server);
    await page.reload();
  });

  test("Ctrl+arrows change the volume, plain arrows do not", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/songs");
    await waitForLibraryContent(page);
    await expect(volumeThumb(page)).toBeVisible();
    // Start below the maximum so both directions are observable.
    await page.keyboard.press("Control+ArrowDown");
    await page.keyboard.press("Control+ArrowDown");
    const start = await volume(page);
    expect(start).toBeLessThan(100);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    expect(await volume(page)).toBe(start);

    await page.keyboard.press("Control+ArrowUp");
    await expect.poll(() => volume(page)).toBe(start + 5);
  });

  test("arrow keys inside a context menu move through the menu", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/songs");
    await page.getByRole("button", { name: /list view/i }).click();
    const row = page.getByTestId("song-row").first();
    await expect(row).toBeVisible();
    await expect(volumeThumb(page)).toBeVisible();
    const start = await volume(page);

    await row.click({ button: "right" });
    const menu = page.locator(
      '[data-slot="context-menu-content"][data-state="open"]',
    );
    await expect(menu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    expect(await volume(page)).toBe(start);
  });

  test("Space presses the focused button instead of toggling playback", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/library/songs");
    await waitForLibraryContent(page);
    const listView = page.getByRole("button", { name: /list view/i });
    await listView.focus();
    await page.keyboard.press("Space");
    // The button switched the view, so Space reached it.
    await expect(page.getByTestId("song-row").first()).toBeVisible();
  });
});
