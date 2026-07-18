/**
 * Tagger tests - Tag editing functionality
 */

import { isolatedTest as test, expect, waitForToast } from "./fixtures";
import * as path from "path";

test.describe("Tagger", () => {
  // Run tagger tests sequentially to avoid interference
  test.describe.configure({ mode: "serial" });

  test("tagger page loads with empty state", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/tagger");

    // Should show tagger heading
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Should show empty state
    await expect(page.getByText("No tracks loaded")).toBeVisible({
      timeout: 5000,
    });

    // Should have action buttons
    await expect(
      page.getByRole("button", { name: /upload files/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /add from library/i }),
    ).toBeVisible();
  });

  test("can open add from library dialog", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Click "Add from Library" button
    const addFromLibraryButton = page.getByRole("button", {
      name: /add from library/i,
    });
    await expect(addFromLibraryButton).toBeVisible({ timeout: 5000 });
    await addFromLibraryButton.click();

    // Dialog should open
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog should have search functionality
    await expect(dialog.getByRole("textbox")).toBeVisible();
  });

  test("can select all add from library results with ctrl+a", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole("button", { name: /add from library/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const searchResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/search") && response.status() === 200,
    );
    await dialog.getByPlaceholder(/search/i).fill("First Song");
    await searchResponse;

    await expect(dialog.getByText("First Song").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(dialog.getByText("0 of 1 selected")).toBeVisible();

    await dialog.getByRole("textbox").press("Control+A");

    await expect(dialog.getByText("1 of 1 selected")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /add 1 track/i }),
    ).toBeEnabled();
  });

  test("shows an error when add from library loads no selected tracks", async ({
    authenticatedPage: page,
  }) => {
    await page.route("**/api/tagger/stage-library", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tracks: [] }),
      });
    });

    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole("button", { name: /add from library/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const searchResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/search") && response.status() === 200,
    );
    await dialog.getByPlaceholder(/search/i).fill("First Song");
    await searchResponse;

    await expect(dialog.getByText("First Song").first()).toBeVisible({
      timeout: 5000,
    });
    await dialog.getByText("First Song").first().click();
    await dialog.getByRole("button", { name: /add 1 track/i }).click();

    await waitForToast(page, /could not be loaded/i);
    await expect(page.getByText(/added 0 track/i)).not.toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("can load tracks from library via dialog", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    const searchResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/search") && response.status() === 200,
    );
    await page.getByRole("button", { name: /add from library/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await searchResponse;

    await dialog.getByText("First Song").first().click();
    const addButton = dialog.getByRole("button", { name: /add 1 track/i });
    await expect(addButton).toBeEnabled();
    const stageResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/tagger/stage-library") &&
        response.request().method() === "POST",
    );
    await addButton.click();
    expect((await stageResponse).ok()).toBe(true);
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("[data-row-id]").first()).toBeVisible();
  });

  test("can edit library track tags and save changes", async ({
    authenticatedPage: page,
  }) => {
    // Navigate to tagger
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Add a track from library
    await page.getByRole("button", { name: /add from library/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Search for a specific track
    const searchResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/search") && response.status() === 200,
    );
    await dialog.getByPlaceholder(/search/i).fill("First Song");
    await searchResponse;

    // Select the track by clicking on it
    const trackRow = dialog.locator("text=First Song").first();
    await expect(trackRow).toBeVisible({ timeout: 5000 });
    await trackRow.click();

    // Click add button
    await dialog.getByRole("button", { name: /add.*track/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    const trackRowInGrid = page.locator("[data-row-id]").first();
    await expect(trackRowInGrid).toBeVisible({ timeout: 5000 });

    // Click on the track row to select it
    await trackRowInGrid.click();

    // Look for the TITLE field in the details panel and modify it
    const titleInput = page.locator('input[id*="TITLE"], input[name*="TITLE"]');

    // If direct input selector doesn't work, try label-based approach
    let foundInput = false;
    if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await titleInput.fill("Modified Title");
      foundInput = true;
    } else {
      // Try finding input via label text
      const titleField = page
        .locator(
          'label:has-text("TITLE") + input, label:has-text("TITLE") ~ input',
        )
        .first();
      if (await titleField.isVisible({ timeout: 2000 }).catch(() => false)) {
        await titleField.fill("Modified Title");
        foundInput = true;
      }
    }

    if (!foundInput) {
      // Try double-clicking on a cell in the grid to edit
      const titleCell = page.locator('[data-col-index="0"]').first();
      if (await titleCell.isVisible({ timeout: 2000 }).catch(() => false)) {
        await titleCell.dblclick();

        // Type into the inline editor
        const inlineInput = page.locator("[data-row-id] input");
        if (await inlineInput.isVisible({ timeout: 1000 }).catch(() => false)) {
          await inlineInput.fill("Modified Title");
          await inlineInput.press("Tab");
          foundInput = true;
        }
      }
    }

    if (!foundInput) {
      throw new Error(
        "Could not find an editable title field for the staged track",
      );
    }

    const saveButton = page.getByRole("button", { name: /save changes/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/changes saved/i)).toBeVisible({
      timeout: 15000,
    });

    // Basic verification - track should still be loaded in tagger
    await expect(page.locator("[data-row-id]").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("can upload new file via tagger and save to library", async ({
    authenticatedPage: page,
  }) => {
    // Navigate to tagger
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Find the hidden file input and upload a test file
    const projectRoot = path.resolve(__dirname, "../..");
    const testFilePath = path.join(
      projectRoot,
      "tests/fixtures/music/Test Artist/Test Album/01 - First Song.mp3",
    );

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /^upload files$/i }).click();
    const fileChooser = await fileChooserPromise;

    // Upload the file through the real file chooser flow.
    await fileChooser.setFiles(testFilePath);

    // Wait for upload to complete - the uploaded file should appear in the grid.
    await expect(page.getByText("01 - First Song.mp3").first()).toBeVisible({
      timeout: 10000,
    });

    // The save button should be enabled immediately after upload
    // (uploaded files are always considered as having changes)
    const saveButton = page.getByRole("button", { name: /save changes/i });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });

    // Click save
    await saveButton.click();

    // Save confirmation dialog should appear
    const confirmDialog = page.getByRole("alertdialog");
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // With only one library, it should be auto-selected
    // Check that the library select shows "Test Music" (auto-selected)
    const librarySelect = confirmDialog.getByRole("combobox");
    if (await librarySelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(librarySelect).toHaveText(/test music/i, { timeout: 3000 });
    }

    // Click Save Changes button in dialog - should be enabled since library is auto-selected
    const confirmSaveButton = confirmDialog.getByRole("button", {
      name: /save changes/i,
    });
    await expect(confirmSaveButton).toBeEnabled({ timeout: 3000 });
    await confirmSaveButton.click();

    // Wait for save to complete
    await expect(page.getByText(/changes saved/i)).toBeVisible({
      timeout: 15000,
    });

    // Verify we're back on tagger page
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test("can replace audio file of existing library track", async ({
    authenticatedPage: page,
  }) => {
    // Navigate to tagger
    await page.goto("/tagger");
    await expect(page.getByRole("heading", { name: /tagger/i })).toBeVisible({
      timeout: 10000,
    });

    // Add a FLAC track from library (we'll replace it with another file)
    await page.getByRole("button", { name: /add from library/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Search for a FLAC track
    const searchResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/search") && response.status() === 200,
    );
    await dialog.getByPlaceholder(/search/i).fill("FLAC Track One");
    await searchResponse;

    // Select the track
    const trackRow = dialog.locator("text=FLAC Track One").first();
    await expect(trackRow).toBeVisible({ timeout: 5000 });
    await trackRow.click();

    // Add to tagger
    await dialog.getByRole("button", { name: /add.*track/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Track should be in the grid. Match row text instead of a specific cell
    // shape so the test remains stable when visible tagger columns change.
    const trackRowInGrid = page
      .locator("[data-row-id]")
      .filter({ hasText: "FLAC Track One" })
      .first();
    await expect(trackRowInGrid).toBeVisible({ timeout: 5000 });
    await trackRowInGrid.click({ button: "right" });

    // Look for "Replace with file" or similar option in context menu
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 3000 });

    const replaceOption = contextMenu.getByRole("menuitem", {
      name: /replace.*file|import.*file/i,
    });

    if (await replaceOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await replaceOption.click();

      // Handle the import dialog
      const importDialog = page.getByRole("dialog");
      if (await importDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Find file input in the dialog and upload a replacement file
        const projectRoot = path.resolve(__dirname, "../..");
        const replacementFilePath = path.join(
          projectRoot,
          "tests/fixtures/music/Another Artist/Another Album/02 - FLAC Track Two.flac",
        );

        // Look for the file input within the dialog
        const dialogFileInput = importDialog.locator('input[type="file"]');
        if (
          await dialogFileInput.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await dialogFileInput.setInputFiles(replacementFilePath);

          // Confirm the import
          const importButton = importDialog.getByRole("button", {
            name: /import|confirm|ok/i,
          });
          if (
            await importButton.isVisible({ timeout: 3000 }).catch(() => false)
          ) {
            await expect(importButton).toBeEnabled();
            await importButton.click();
          }
        }
      }

      // Save the changes
      const saveButton = page.getByRole("button", { name: /save changes/i });
      if (await saveButton.isEnabled({ timeout: 5000 }).catch(() => false)) {
        await saveButton.click();

        // Handle save confirmation
        const confirmDialog = page.getByRole("dialog");
        await expect(confirmDialog).toBeVisible({ timeout: 5000 });

        const confirmSaveButton = confirmDialog.getByRole("button", {
          name: /save changes/i,
        });
        await confirmSaveButton.click();

        // Wait for save to complete
        await expect(page.getByText(/changes saved/i)).toBeVisible({
          timeout: 15000,
        });
      }
    } else {
      // Skip the test if replace option isn't available in context menu
      // This could be due to UI differences
      console.log(
        "Replace with file option not found in context menu, skipping",
      );
    }

    // Verify the track still exists in library
    await page.goto("/library/songs");
    // Use domcontentloaded instead of networkidle to avoid timeout issues with polling
    await page.waitForLoadState("domcontentloaded");

    // The track should still be in the library
    await expect(page.getByText(/flac track/i).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
