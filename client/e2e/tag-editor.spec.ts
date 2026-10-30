/**
 * Tag editor tests - editing a song's file tags from the details dialog
 */

import type { Locator, Page } from "@playwright/test";
import { isolatedTest as test, expect } from "./fixtures";

async function openTagEditor(page: Page) {
  await page.goto("/library/songs");

  const listViewButton = page.getByRole("button", { name: /list view/i });
  await expect(listViewButton).toBeVisible({ timeout: 10000 });
  await listViewButton.click();

  const songRow = page.locator('[data-testid="song-row"]').first();
  await expect(songRow).toBeVisible({ timeout: 10000 });
  await songRow.click({ button: "right" });
  const contextMenu = page.locator(
    '[data-slot="context-menu-content"][data-state="open"]',
  );
  await contextMenu.getByRole("menuitem", { name: /view details/i }).click();

  await page.getByRole("button", { name: /view \/ edit tags/i }).click();
  const editor = page.getByRole("dialog", { name: /edit tags/i });
  await expect(editor.getByTestId("tag-row").first()).toBeVisible({
    timeout: 10000,
  });
  return editor;
}

async function saveTags(page: Page, editor: Locator) {
  await expect(editor.getByText(/pending/)).toBeVisible();
  await editor.getByRole("button", { name: /save changes/i }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: /save changes/i }).click();
  // The editor resets its pending changes once the server accepted them.
  await expect(confirm).toBeHidden();
  await expect(editor.getByText("No changes", { exact: true })).toBeVisible();
}

test.describe("Tag editor", () => {
  test("adds multi-valued custom keys and keeps them across edits", async ({
    authenticatedPage: page,
  }) => {
    const editor = await openTagEditor(page);
    const customRows = editor.locator('[data-tag-key="FERROTUNE_E2E"]');

    // Add a custom key with two values
    for (const value of ["first", "second"]) {
      await editor.getByLabel("New tag key").fill("FERROTUNE_E2E");
      await editor.getByLabel("New tag value").fill(value);
      await editor.getByRole("button", { name: "Add tag" }).click();
    }
    await saveTags(page, editor);
    await expect(customRows).toHaveCount(2);
    await expect(customRows.nth(0)).toContainText("first");
    await expect(customRows.nth(1)).toContainText("second");

    // Editing a standard field keeps the custom key
    await editor
      .locator('[data-tag-key="TITLE"] [data-testid="tag-value"]')
      .click();
    const titleInput = editor.locator('[data-tag-key="TITLE"] input');
    await titleInput.fill("E2E Edited Title");
    await titleInput.press("Enter");
    await saveTags(page, editor);
    await expect(editor.locator('[data-tag-key="TITLE"]')).toContainText(
      "E2E Edited Title",
    );
    await expect(customRows).toHaveCount(2);

    // Deleting one value keeps the other
    await customRows.nth(0).getByRole("button", { name: "Delete tag" }).click();
    await saveTags(page, editor);
    await expect(customRows).toHaveCount(1);
    await expect(customRows.first()).toContainText("second");
  });
});
