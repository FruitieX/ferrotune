import { _android as android, expect } from "@playwright/test";
import type { AndroidDevice, Locator, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  test,
  playFirstSong,
  type ServerInfo,
  waitForPlayerReady,
} from "./fixtures";
import {
  setStoredConnection,
  toAndroidEmulatorUrl,
  waitForAuthenticatedHome,
} from "./app-helpers";
import { openQueuePanel } from "./queue-helpers";

const APP_PACKAGE = "com.ferrotune.music";
const APP_ACTIVITY = `${APP_PACKAGE}/.MainActivity`;
const DEBUG_APK_PATH = path.resolve(
  __dirname,
  "../src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk",
);

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function pickDevice(devices: AndroidDevice[]): AndroidDevice {
  const requestedSerial = process.env.ANDROID_SERIAL;

  if (requestedSerial) {
    const requestedDevice = devices.find(
      (device) => device.serial() === requestedSerial,
    );

    if (!requestedDevice) {
      throw new Error(
        `Android device ${requestedSerial} is not connected to ADB.`,
      );
    }

    return requestedDevice;
  }

  return (
    devices.find((device) => device.serial().startsWith("emulator-")) ??
    devices[0]
  );
}

async function prepareAndroidApp(
  device: AndroidDevice,
  server: ServerInfo,
): Promise<Page> {
  device.setDefaultTimeout(30000);
  await device.installApk(DEBUG_APK_PATH);
  await device.shell(`pm clear ${APP_PACKAGE}`);
  await device.shell("logcat -c");
  await device.shell(`am force-stop ${APP_PACKAGE}`);
  await device.shell(`am start -W -n ${APP_ACTIVITY}`);

  const webView = await device.webView(
    { pkg: APP_PACKAGE },
    { timeout: 60000 },
  );
  const page = await webView.page();

  await page.waitForLoadState("domcontentloaded");
  await setStoredConnection(page, {
    serverUrl: toAndroidEmulatorUrl(server.url),
    username: server.username,
    password: server.password,
  });
  await page.reload();
  await waitForAuthenticatedHome(page, 30000);

  const authParams = `u=${server.username}&p=${server.password}&v=1.16.1&c=e2e-test`;
  const resetResponse = await fetch(
    `${server.url}/ferrotune/testing/reset?${authParams}`,
    {
      method: "POST",
    },
  );

  if (!resetResponse.ok) {
    throw new Error(
      `Failed to reset Android smoke test server state: ${resetResponse.status} ${await resetResponse.text()}`,
    );
  }

  await page.reload();
  await waitForAuthenticatedHome(page, 30000);

  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }",
  });

  return page;
}

async function ensureSongsListView(page: Page) {
  await page.goto("/library/songs");

  const mobileViewOptionsButton = page.getByRole("button", {
    name: /view options/i,
  });

  if (
    await mobileViewOptionsButton
      .isVisible({ timeout: 3000 })
      .catch(() => false)
  ) {
    await mobileViewOptionsButton.click();
    await page.getByRole("button", { name: /^list$/i }).click();
  } else {
    const listViewButton = page.getByRole("button", { name: /list view/i });
    if (await listViewButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await listViewButton.click();
    }
  }

  await page.waitForSelector('[data-testid="song-row"]', { timeout: 10000 });
}

async function openSongActionMenu(
  page: Page,
  songTitle: string,
): Promise<Locator> {
  const songRow = page
    .locator('[data-testid="song-row"]')
    .filter({ hasText: songTitle })
    .first();

  await expect(songRow).toBeVisible({ timeout: 10000 });
  await songRow.click({ button: "right" });

  const drawer = page.locator("[data-vaul-drawer]");
  if (await drawer.isVisible({ timeout: 3000 }).catch(() => false)) {
    return drawer;
  }

  const contextMenu = page.locator('[data-slot="context-menu-content"]');
  await expect(contextMenu).toBeVisible({ timeout: 5000 });
  return contextMenu;
}

async function clickPlayNextAction(menu: Locator) {
  const drawerAction = menu.getByRole("button", { name: /play next/i });
  if (await drawerAction.isVisible({ timeout: 1000 }).catch(() => false)) {
    await drawerAction.click();
    return;
  }

  await menu.getByRole("menuitem", { name: /play next/i }).click();
}

test.describe.serial("Android Emulator Smoke", () => {
  test("queue item play button advances playback on Android", async ({
    server,
  }, testInfo) => {
    test.setTimeout(180_000);

    const connectedDevices = await android.devices();
    test.skip(
      connectedDevices.length === 0,
      "No Android emulator or device connected to ADB.",
    );

    if (!fs.existsSync(DEBUG_APK_PATH)) {
      throw new Error(
        `Debug APK not found at ${DEBUG_APK_PATH}. Run moon run client:tauri-android-deploy-debug first.`,
      );
    }

    const device = pickDevice(connectedDevices);
    let page: import("@playwright/test").Page | undefined;

    try {
      page = await prepareAndroidApp(device, server);

      await playFirstSong(page);
      await waitForPlayerReady(page, 15000);

      const playerBar = page.getByTestId("player-bar");
      await expect(playerBar).toContainText("First Song", {
        timeout: 15000,
      });

      await expect
        .poll(
          async () => {
            const logs = (
              await device.shell("logcat -d -s NativeAudioPlugin:V")
            ).toString("utf-8");

            return countOccurrences(logs, "startPlayback() command received");
          },
          {
            timeout: 15000,
            message:
              "Expected a single native startPlayback command when starting a new queue",
          },
        )
        .toBe(1);

      const queuePanel = await openQueuePanel(page);
      const thirdQueueItem = queuePanel
        .locator('[data-testid="queue-item"]')
        .filter({ hasText: "Third Song" })
        .first();

      await expect(thirdQueueItem).toBeVisible({ timeout: 10000 });
      await thirdQueueItem
        .getByRole("button", { name: "Play Third Song" })
        .click();

      await expect(playerBar).toContainText("Third Song", {
        timeout: 15000,
      });

      await expect
        .poll(
          async () =>
            (
              await device.shell(
                "logcat -d -s NativeAudioPlugin:V PlaybackService:V",
              )
            ).toString("utf-8"),
          {
            timeout: 15000,
            message: "Expected native playAtIndex logs after queue item tap",
          },
        )
        .toContain("playAtIndex() command received: index=2");

      await expect
        .poll(
          async () =>
            (
              await device.shell(
                "logcat -d -s NativeAudioPlugin:V PlaybackService:V",
              )
            ).toString("utf-8"),
          {
            timeout: 15000,
            message:
              "Expected PlaybackService playAtIndex logs after queue item tap",
          },
        )
        .toContain("playAtIndex(2): serverTotal=");
    } catch (error) {
      if (page) {
        await page
          .screenshot({
            path: testInfo.outputPath("android-webview-failure.png"),
          })
          .catch(() => undefined);
      }

      await device
        .screenshot({ path: testInfo.outputPath("android-device-failure.png") })
        .catch(() => undefined);

      throw error;
    } finally {
      await device.close().catch(() => undefined);
    }
  });

  test("play next preserves playback and updates queue on Android", async ({
    server,
  }, testInfo) => {
    test.setTimeout(180_000);

    const connectedDevices = await android.devices();
    test.skip(
      connectedDevices.length === 0,
      "No Android emulator or device connected to ADB.",
    );

    if (!fs.existsSync(DEBUG_APK_PATH)) {
      throw new Error(
        `Debug APK not found at ${DEBUG_APK_PATH}. Run moon run client:tauri-android-deploy-debug first.`,
      );
    }

    const device = pickDevice(connectedDevices);
    let page: import("@playwright/test").Page | undefined;

    try {
      page = await prepareAndroidApp(device, server);

      await playFirstSong(page);
      await waitForPlayerReady(page, 15000);

      const playerBar = page.getByTestId("player-bar");
      await expect(playerBar).toContainText("First Song", {
        timeout: 15000,
      });

      await ensureSongsListView(page);
      await clickPlayNextAction(
        await openSongActionMenu(page, "FLAC Track One"),
      );
      await clickPlayNextAction(
        await openSongActionMenu(page, "FLAC Track Two"),
      );

      await expect(playerBar).toContainText("First Song", {
        timeout: 15000,
      });

      const queuePanel = await openQueuePanel(page);
      const queueItems = queuePanel.locator('[data-testid="queue-item"]');

      await expect(queueItems.nth(0)).toContainText("First Song");
      await expect(queueItems.nth(1)).toContainText("FLAC Track Two");
      await expect(queueItems.nth(2)).toContainText("FLAC Track One");
      await expect(queueItems.nth(3)).toContainText("Second Song");
      await expect(queueItems.nth(4)).toContainText("Third Song");

      await expect
        .poll(
          async () =>
            (
              await device.shell(
                "logcat -d -s NativeAudioPlugin:V PlaybackService:V",
              )
            ).toString("utf-8"),
          {
            timeout: 15000,
            message:
              "Expected Android play-next to invalidate the native queue without restarting playback",
          },
        )
        .toContain("invalidateQueue: refetching");

      const logs = (
        await device.shell("logcat -d -s NativeAudioPlugin:V PlaybackService:V")
      ).toString("utf-8");

      expect(countOccurrences(logs, "startPlayback() command received")).toBe(
        1,
      );
      expect(logs).not.toContain("softInvalidateQueue:");
    } catch (error) {
      if (page) {
        await page
          .screenshot({
            path: testInfo.outputPath("android-play-next-failure.png"),
          })
          .catch(() => undefined);
      }

      await device
        .screenshot({
          path: testInfo.outputPath("android-play-next-device-failure.png"),
        })
        .catch(() => undefined);

      throw error;
    } finally {
      await device.close().catch(() => undefined);
    }
  });
});
