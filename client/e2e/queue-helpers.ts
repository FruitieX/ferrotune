import { expect, type Page } from "@playwright/test";

export async function waitForQueuePanel(page: Page) {
  const queueHeading = page.getByRole("heading", {
    name: "Queue",
    exact: true,
  });
  await expect(queueHeading).toBeVisible({ timeout: 10000 });

  const sidebar = page.locator("aside").filter({
    has: page.getByRole("heading", { name: "Queue" }),
  });

  if (await sidebar.isVisible().catch(() => false)) {
    return sidebar;
  }

  return page.locator('[role="dialog"]').filter({
    has: page.getByRole("heading", { name: "Queue" }),
  });
}

export async function openQueuePanel(page: Page) {
  const queueButton = page
    .locator("footer")
    .getByRole("button", { name: /queue/i })
    .first();

  await queueButton.click();

  return waitForQueuePanel(page);
}
