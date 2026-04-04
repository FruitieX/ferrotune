import { expect, type Page } from "@playwright/test";

export interface StoredConnection {
  serverUrl: string;
  username: string;
  password: string;
}

export async function setStoredConnection(
  page: Page,
  connection: StoredConnection,
): Promise<void> {
  await page.evaluate((storedConnection) => {
    localStorage.setItem(
      "ferrotune-connection",
      JSON.stringify(storedConnection),
    );
  }, connection);
}

export async function waitForAuthenticatedHome(
  page: Page,
  timeout = 15000,
): Promise<void> {
  await expect(page).not.toHaveURL(/\/login/, { timeout });

  await Promise.any([
    page.locator("h1:has-text('Home')").first().waitFor({
      state: "visible",
      timeout,
    }),
    page
      .getByRole("link", { name: /library/i })
      .first()
      .waitFor({
        state: "visible",
        timeout,
      }),
    page.getByRole("button", { name: /queue/i }).first().waitFor({
      state: "visible",
      timeout,
    }),
  ]);
}

export async function gotoAppPath(page: Page, path: string): Promise<void> {
  const currentUrl = page.url();
  const targetUrl =
    currentUrl && currentUrl !== "about:blank"
      ? new URL(path, currentUrl).toString()
      : path;

  await page.goto(targetUrl);
}

export function toAndroidEmulatorUrl(serverUrl: string): string {
  const url = new URL(serverUrl);

  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    url.hostname = "10.0.2.2";
  }

  return url.href.replace(/\/$/, "");
}
