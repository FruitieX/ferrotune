import { expect, type Page } from "@playwright/test";

export interface StoredConnection {
  serverUrl: string;
  username: string;
  userId: number;
  email?: string | null;
  isAdmin: boolean;
  sessionToken: string;
  sessionExpiresAt: string;
  urlToken?: string;
  urlTokenExpiresAt?: string;
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

export async function setServerPreference(
  page: Page,
  key: string,
  value: unknown,
): Promise<void> {
  await page.evaluate(
    async ({ preferenceKey, nextValue }) => {
      const connection = JSON.parse(
        localStorage.getItem("ferrotune-connection") || "null",
      );

      if (!connection?.serverUrl || !connection.sessionToken) {
        throw new Error("Missing authenticated connection in localStorage");
      }

      const response = await fetch(
        `${connection.serverUrl.replace(/\/$/, "")}/api/preferences/${encodeURIComponent(preferenceKey)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${connection.sessionToken}`,
          },
          body: JSON.stringify({ value: nextValue }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to update '${preferenceKey}' preference: ${response.status}`,
        );
      }
    },
    { preferenceKey: key, nextValue: value },
  );
}

export async function waitForServerPreference(
  page: Page,
  key: string,
  value: unknown,
): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(
        ({ preferenceKey, expectedValue }) => {
          type ServerStorageStateForTest = {
            __ferrotuneServerStorageState?: {
              loadedAccounts: Set<string>;
              valueCacheByAccount: Map<string, Map<string, unknown>>;
            };
          };

          const connection = JSON.parse(
            localStorage.getItem("ferrotune-connection") || "null",
          );
          const account = connection?.userId
            ? `${connection.userId}@${connection.serverUrl || "local"}`
            : connection?.username
              ? `${connection.username}@${connection.serverUrl || "local"}`
              : (connection?.serverUrl ?? "__no_account__");

          const storageState = (window as Window & ServerStorageStateForTest)
            .__ferrotuneServerStorageState;
          if (!storageState?.loadedAccounts.has(account)) {
            return false;
          }

          const valueCache = storageState.valueCacheByAccount.get(account);

          return (
            !!valueCache &&
            Object.is(valueCache.get(preferenceKey), expectedValue)
          );
        },
        { preferenceKey: key, expectedValue: value },
      ),
    )
    .toBe(true);
}

export function toAndroidEmulatorUrl(serverUrl: string): string {
  const url = new URL(serverUrl);

  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    url.hostname = "10.0.2.2";
  }

  return url.href.replace(/\/$/, "");
}

/**
 * Pause playback and wait until the player bar shows the Play control.
 *
 * A track that auto-advances while the Pause click is dispatched replaces the
 * player-bar controls mid-click, which swallows the click and leaves playback
 * running. The test fixtures are only a few seconds long, so this happens
 * regularly; retry until the paused state is observed instead of trusting a
 * single click.
 */
export async function pausePlayback(page: Page): Promise<void> {
  const playerBar = page.getByTestId("player-bar");
  const playButton = playerBar.getByRole("button", { name: /^Play$/ }).first();
  const pauseButton = playerBar
    .getByRole("button", { name: /^Pause$/ })
    .first();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await playButton.isVisible().catch(() => false)) {
      return;
    }

    if (await pauseButton.isVisible().catch(() => false)) {
      await pauseButton.click().catch(() => undefined);
    }

    try {
      await expect(playButton).toBeVisible({ timeout: 3000 });
      return;
    } catch {
      // The track likely auto-advanced mid-click; click the new Pause control.
    }
  }

  await expect(playButton).toBeVisible({ timeout: 15000 });
}
