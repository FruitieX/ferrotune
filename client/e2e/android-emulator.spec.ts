import { _android as android, expect } from "@playwright/test";
import type { AndroidDevice } from "@playwright/test";
import fs from "fs";
import path from "path";
import { test, playFirstSong, waitForPlayerReady } from "./fixtures";
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
      page = await webView.page();

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
        { method: "POST" },
      );

      if (!resetResponse.ok) {
        throw new Error(
          `Failed to reset Android smoke test server state: ${resetResponse.status} ${await resetResponse.text()}`,
        );
      }

      await page.reload();
      await waitForAuthenticatedHome(page, 30000);

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
});
