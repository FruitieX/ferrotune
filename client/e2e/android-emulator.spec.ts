import { _android as android, expect } from "@playwright/test";
import type { AndroidDevice, Locator, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  test,
  loginForSession,
  playFirstSong,
  type ServerInfo,
  waitForPlayerReady,
} from "./fixtures";
import {
  gotoAppPath,
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

interface SessionExportSummary {
  currentIndex: number;
  durationMs: number;
  playlistSize: number;
  seekable: boolean;
  placeholder: boolean;
  transcoding: boolean;
  dynamic: boolean;
  live: boolean;
  positionMs: number;
  bufferedMs: number;
  canReadCurrentItem: boolean;
  canSeekCurrent: boolean;
}

interface TimelineSummary {
  currentIndex: number;
  durationMs: number;
  seekable: boolean;
  dynamic: boolean;
  live: boolean;
  placeholder: boolean;
}

interface PlatformMediaSessionSummary {
  playbackState: number;
  positionMs: number;
  bufferedPositionMs: number;
  speed: number;
}

interface MediaButtonSummary {
  starred: boolean;
  shuffled: boolean;
  repeatMode: string;
}

function extractLatestSessionExport(logs: string): SessionExportSummary | null {
  const pattern =
    /session export: current=(\d+) durationMs=(\d+) playlistSize=(\d+) seekable=(true|false) placeholder=(true|false) transcoding=(true|false) dynamic=(true|false) live=(true|false) positionMs=(-?\d+) bufferedMs=(-?\d+) canReadCurrentItem=(true|false) canSeekCurrent=(true|false)/g;
  let latestMatch: RegExpExecArray | null = null;

  for (const match of logs.matchAll(pattern)) {
    latestMatch = match;
  }

  if (!latestMatch) {
    return null;
  }

  return {
    currentIndex: Number.parseInt(latestMatch[1] ?? "0", 10),
    durationMs: Number.parseInt(latestMatch[2] ?? "0", 10),
    playlistSize: Number.parseInt(latestMatch[3] ?? "0", 10),
    seekable: latestMatch[4] === "true",
    placeholder: latestMatch[5] === "true",
    transcoding: latestMatch[6] === "true",
    dynamic: latestMatch[7] === "true",
    live: latestMatch[8] === "true",
    positionMs: Number.parseInt(latestMatch[9] ?? "0", 10),
    bufferedMs: Number.parseInt(latestMatch[10] ?? "0", 10),
    canReadCurrentItem: latestMatch[11] === "true",
    canSeekCurrent: latestMatch[12] === "true",
  };
}

function extractLatestTimelineSummary(logs: string): TimelineSummary | null {
  const pattern =
    /onTimelineChanged: windowCount=\d+, reason=\w+, current=(-?\d+), durationMs=(-?\d+), seekable=(true|false), dynamic=(true|false), live=(true|false), placeholder=(true|false)/g;
  let latestMatch: RegExpExecArray | null = null;

  for (const match of logs.matchAll(pattern)) {
    latestMatch = match;
  }

  if (!latestMatch) {
    return null;
  }

  return {
    currentIndex: Number.parseInt(latestMatch[1] ?? "0", 10),
    durationMs: Number.parseInt(latestMatch[2] ?? "0", 10),
    seekable: latestMatch[3] === "true",
    dynamic: latestMatch[4] === "true",
    live: latestMatch[5] === "true",
    placeholder: latestMatch[6] === "true",
  };
}

function extractLatestPlatformMediaSession(
  dumpsys: string,
): PlatformMediaSessionSummary | null {
  let latestSummary: PlatformMediaSessionSummary | null = null;
  let searchStart = 0;

  while (true) {
    const packageIndex = dumpsys.indexOf(APP_PACKAGE, searchStart);
    if (packageIndex === -1) {
      break;
    }

    const sessionBlock = dumpsys.slice(packageIndex, packageIndex + 5000);
    const playbackStateMatch = sessionBlock.match(
      /PlaybackState\s*\{state=([^,]+), position=(-?\d+), buffered position=(-?\d+), speed=([-\d.]+)/,
    );

    if (playbackStateMatch) {
      const playbackStateText = playbackStateMatch[1] ?? "";
      const playbackStateNumberMatch = playbackStateText.match(/\d+/);

      if (playbackStateNumberMatch) {
        latestSummary = {
          playbackState: Number.parseInt(playbackStateNumberMatch[0], 10),
          positionMs: Number.parseInt(playbackStateMatch[2] ?? "0", 10),
          bufferedPositionMs: Number.parseInt(playbackStateMatch[3] ?? "0", 10),
          speed: Number.parseFloat(playbackStateMatch[4] ?? "0"),
        };
      }
    }

    searchStart = packageIndex + APP_PACKAGE.length;
  }

  return latestSummary;
}

function extractLatestMediaButtonSummary(
  logs: string,
): MediaButtonSummary | null {
  const pattern =
    /media button preferences: starred=(true|false) shuffled=(true|false) repeat=([^\s]+)/g;
  let latestMatch: RegExpExecArray | null = null;

  for (const match of logs.matchAll(pattern)) {
    latestMatch = match;
  }

  if (!latestMatch) {
    return null;
  }

  return {
    starred: latestMatch[1] === "true",
    shuffled: latestMatch[2] === "true",
    repeatMode: latestMatch[3] ?? "off",
  };
}

async function readLatestSessionExport(
  device: AndroidDevice,
): Promise<SessionExportSummary | null> {
  const logs = (await device.shell("logcat -d -s PlaybackService:V")).toString(
    "utf-8",
  );

  return extractLatestSessionExport(logs);
}

async function readLatestTimelineSummary(
  device: AndroidDevice,
): Promise<TimelineSummary | null> {
  const logs = (await device.shell("logcat -d -s PlaybackService:V")).toString(
    "utf-8",
  );

  return extractLatestTimelineSummary(logs);
}

async function readLatestPlatformMediaSession(
  device: AndroidDevice,
): Promise<PlatformMediaSessionSummary | null> {
  const dumpsys = (await device.shell("dumpsys media_session")).toString(
    "utf-8",
  );

  return extractLatestPlatformMediaSession(dumpsys);
}

async function readLatestMediaButtonSummary(
  device: AndroidDevice,
): Promise<MediaButtonSummary | null> {
  const logs = (await device.shell("logcat -d -s PlaybackService:V")).toString(
    "utf-8",
  );

  return extractLatestMediaButtonSummary(logs);
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

function basicAuthHeader(server: ServerInfo): string {
  return `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`;
}

async function setServerPreference(
  server: ServerInfo,
  key: string,
  value: unknown,
): Promise<void> {
  const response = await fetch(
    `${server.url}/api/preferences/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        Authorization: basicAuthHeader(server),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to set preference ${key}: ${response.status} ${await response.text()}`,
    );
  }
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
  const login = await loginForSession(server.url, {
    username: server.username,
    password: server.password,
  });
  await setStoredConnection(page, {
    serverUrl: toAndroidEmulatorUrl(server.url),
    username: login.user.username,
    userId: login.user.id,
    email: login.user.email ?? null,
    isAdmin: login.user.isAdmin,
    sessionToken: login.sessionToken,
    sessionExpiresAt: login.sessionExpiresAt,
    urlToken: login.urlToken,
    urlTokenExpiresAt: login.urlTokenExpiresAt,
  });
  await page.reload();
  await waitForAuthenticatedHome(page, 30000);

  const resetResponse = await fetch(`${server.url}/api/testing/reset`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(server),
    },
  });

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

async function resumeAndroidApp(device: AndroidDevice): Promise<Page> {
  await device.shell(`am start -W -n ${APP_ACTIVITY}`);

  const webView = await device.webView(
    { pkg: APP_PACKAGE },
    { timeout: 60000 },
  );

  const page = await webView.page();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  return page;
}

async function ensureSongsListView(page: Page) {
  await gotoAppPath(page, "/library/songs");

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

  await expect(
    page.locator('[data-testid="song-row"], [data-testid="media-row"]').first(),
  ).toBeVisible({ timeout: 10000 });
}

async function ensureTranscodingEnabled(page: Page) {
  await gotoAppPath(page, "/settings");

  const transcodingRow = page
    .locator("div.flex.items-center.justify-between")
    .filter({ hasText: "Audio Transcoding" })
    .first();

  const transcodingSwitch = transcodingRow.getByRole("switch");
  await expect(transcodingSwitch).toBeVisible({ timeout: 10000 });

  if ((await transcodingSwitch.getAttribute("aria-checked")) !== "true") {
    await transcodingSwitch.click();
  }

  await expect(transcodingSwitch).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Transcode Bitrate")).toBeVisible({
    timeout: 10000,
  });
}

async function openSongActionMenu(
  page: Page,
  songTitle: string,
): Promise<Locator> {
  const songRow = page
    .locator('[data-testid="song-row"], [data-testid="media-row"]')
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

async function clickAddToFavoritesAction(menu: Locator) {
  const drawerAction = menu.getByRole("button", {
    name: /add to favorites/i,
  });
  if (await drawerAction.isVisible({ timeout: 1000 }).catch(() => false)) {
    await drawerAction.click();
    return;
  }

  await menu.getByRole("menuitem", { name: /add to favorites/i }).click();
}

async function getDisplayedCurrentTime(page: Page): Promise<number> {
  const timeText = await page
    .locator('[data-testid="player-bar"]')
    .locator("span.tabular-nums")
    .first()
    .textContent();

  if (!timeText) {
    return 0;
  }

  const parts = timeText.trim().split(":");
  if (parts.length !== 2) {
    return 0;
  }

  return (
    Number.parseInt(parts[0] ?? "0", 10) * 60 +
    Number.parseInt(parts[1] ?? "0", 10)
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
        `Debug APK not found at ${DEBUG_APK_PATH}. Run moon run client:test-android-emulator or moon run client:tauri-android-deploy-debug first.`,
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

  test("removing an earlier queue item keeps playback position on Android", async ({
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

      await playerBar.getByRole("button", { name: /next/i }).click();
      await expect(playerBar).toContainText("Second Song", {
        timeout: 15000,
      });

      await expect
        .poll(async () => getDisplayedCurrentTime(page!), {
          timeout: 20000,
          message:
            "Expected Android playback time to advance before queue removal",
        })
        .toBeGreaterThan(5);

      const timeBeforeRemove = await getDisplayedCurrentTime(page);

      const queuePanel = await openQueuePanel(page);
      const firstQueueItem = queuePanel
        .locator('[data-testid="queue-item"]')
        .filter({ hasText: "First Song" })
        .first();

      await expect(firstQueueItem).toBeVisible({ timeout: 10000 });
      await firstQueueItem.click({ button: "right" });

      const drawer = page.locator("[data-vaul-drawer]");
      const removeItem = (await drawer
        .isVisible({ timeout: 3000 })
        .catch(() => false))
        ? drawer.getByRole("button", { name: /remove from queue/i })
        : page
            .locator('[data-slot="context-menu-content"]')
            .getByRole("menuitem", { name: /remove from queue/i });

      await expect(removeItem).toBeVisible({ timeout: 5000 });
      await removeItem.click();

      await expect(playerBar).toContainText("Second Song", {
        timeout: 15000,
      });
      await expect(
        queuePanel
          .locator('[data-testid="queue-item"]')
          .filter({ hasText: "First Song" }),
      ).toHaveCount(0);

      const timeAfterRemove = await getDisplayedCurrentTime(page);
      expect(timeAfterRemove).toBeGreaterThanOrEqual(timeBeforeRemove - 1);

      await expect
        .poll(async () => getDisplayedCurrentTime(page!), {
          timeout: 15000,
          message:
            "Expected Android playback time to keep advancing after removing an earlier queue item",
        })
        .toBeGreaterThanOrEqual(Math.max(1, timeBeforeRemove - 1));

      const logs = (
        await device.shell("logcat -d -s NativeAudioPlugin:V PlaybackService:V")
      ).toString("utf-8");

      expect(countOccurrences(logs, "startPlayback() command received")).toBe(
        1,
      );
      expect(logs).not.toContain("current track removed, doing full reload");
    } catch (error) {
      if (page) {
        await page
          .screenshot({
            path: testInfo.outputPath("android-queue-remove-failure.png"),
          })
          .catch(() => undefined);
      }

      await device
        .screenshot({
          path: testInfo.outputPath("android-queue-remove-device-failure.png"),
        })
        .catch(() => undefined);

      throw error;
    } finally {
      await device.close().catch(() => undefined);
    }
  });

  test("app favorite and shuffle controls update Android media buttons", async ({
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
        `Debug APK not found at ${DEBUG_APK_PATH}. Run moon run client:test-android-emulator or moon run client:tauri-android-deploy-debug first.`,
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
      const songMenu = await openSongActionMenu(page, "First Song");
      await clickAddToFavoritesAction(songMenu);

      await expect
        .poll(
          async () => (await readLatestMediaButtonSummary(device))?.starred,
          {
            timeout: 15000,
            message:
              "Expected Android media favorite button to reflect app favorite changes",
          },
        )
        .toBe(true);

      await playerBar.getByRole("button", { name: /more options/i }).click();
      await page.getByRole("button", { name: /^shuffle/i }).click();

      await expect
        .poll(
          async () => (await readLatestMediaButtonSummary(device))?.shuffled,
          {
            timeout: 15000,
            message:
              "Expected Android media shuffle button to reflect app shuffle changes",
          },
        )
        .toBe(true);
    } catch (error) {
      if (page) {
        await page
          .screenshot({
            path: testInfo.outputPath("android-media-buttons-failure.png"),
          })
          .catch(() => undefined);
      }

      await device
        .screenshot({
          path: testInfo.outputPath("android-media-buttons-device-failure.png"),
        })
        .catch(() => undefined);

      throw error;
    } finally {
      await device.close().catch(() => undefined);
    }
  });

  test("transcoded session export stays determinate on Android", async ({
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
        `Debug APK not found at ${DEBUG_APK_PATH}. Run moon run client:test-android-emulator or moon run client:tauri-android-deploy-debug first.`,
      );
    }

    const device = pickDevice(connectedDevices);
    let page: import("@playwright/test").Page | undefined;

    try {
      page = await prepareAndroidApp(device, server);
      await setServerPreference(server, "transcodingEnabled", true);
      await page.reload();
      await waitForAuthenticatedHome(page, 30000);
      await ensureTranscodingEnabled(page);

      await playFirstSong(page);
      await waitForPlayerReady(page, 15000);
      const playerBar = page.getByTestId("player-bar");
      await expect(playerBar).toBeVisible({
        timeout: 15000,
      });

      await expect
        .poll(async () => (await readLatestSessionExport(device)) !== null, {
          timeout: 15000,
          message:
            "Expected PlaybackService to export session metadata for the current Android notification state",
        })
        .toBe(true);

      const sessionExport = await readLatestSessionExport(device);
      if (!sessionExport) {
        throw new Error(
          "PlaybackService did not emit a session export summary",
        );
      }

      expect(sessionExport.durationMs).toBeGreaterThan(0);
      expect(sessionExport.playlistSize).toBeGreaterThan(2);
      expect(sessionExport.seekable).toBe(true);
      expect(sessionExport.placeholder).toBe(false);
      expect(sessionExport.transcoding).toBe(true);
      expect(sessionExport.dynamic).toBe(false);
      expect(sessionExport.live).toBe(false);
      expect(sessionExport.canReadCurrentItem).toBe(true);
      expect(sessionExport.canSeekCurrent).toBe(true);
      expect(sessionExport.positionMs).toBeGreaterThanOrEqual(0);

      await expect
        .poll(
          async () => {
            const latestTimelineSummary =
              await readLatestTimelineSummary(device);

            return (
              latestTimelineSummary !== null &&
              latestTimelineSummary.durationMs > 0 &&
              latestTimelineSummary.seekable &&
              !latestTimelineSummary.dynamic &&
              !latestTimelineSummary.live &&
              !latestTimelineSummary.placeholder
            );
          },
          {
            timeout: 15000,
            message:
              "Expected transcoded ExoPlayer timeline to be finite and seekable",
          },
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            const platformSession =
              await readLatestPlatformMediaSession(device);

            return (
              platformSession !== null &&
              platformSession.playbackState === 3 &&
              platformSession.positionMs >= 0 &&
              platformSession.bufferedPositionMs >= 0 &&
              platformSession.speed > 0
            );
          },
          {
            timeout: 15000,
            message:
              "Expected phone platform media session to expose determinate playback progress",
          },
        )
        .toBe(true);

      await playerBar.getByRole("button", { name: /next/i }).click();
      await expect(playerBar).toContainText("Second Song", {
        timeout: 15000,
      });

      await expect
        .poll(
          async () => {
            const latestSessionExport = await readLatestSessionExport(device);

            return (
              latestSessionExport !== null &&
              latestSessionExport.currentIndex !== sessionExport.currentIndex &&
              latestSessionExport.durationMs > 0 &&
              latestSessionExport.seekable &&
              !latestSessionExport.placeholder &&
              latestSessionExport.transcoding &&
              !latestSessionExport.dynamic &&
              !latestSessionExport.live &&
              latestSessionExport.canReadCurrentItem
            );
          },
          {
            timeout: 15000,
            message:
              "Expected transcoded session export to remain determinate after track transition",
          },
        )
        .toBe(true);
    } catch (error) {
      if (page) {
        await page
          .screenshot({
            path: testInfo.outputPath(
              "android-transcoding-session-failure.png",
            ),
          })
          .catch(() => undefined);
      }

      await device
        .screenshot({
          path: testInfo.outputPath(
            "android-transcoding-session-device-failure.png",
          ),
        })
        .catch(() => undefined);

      throw error;
    } finally {
      await device.close().catch(() => undefined);
    }
  });

  test("background transcoded playback advances on Android", async ({
    server,
  }, testInfo) => {
    test.setTimeout(240_000);

    const connectedDevices = await android.devices();
    test.skip(
      connectedDevices.length === 0,
      "No Android emulator or device connected to ADB.",
    );

    if (!fs.existsSync(DEBUG_APK_PATH)) {
      throw new Error(
        `Debug APK not found at ${DEBUG_APK_PATH}. Run moon run client:test-android-emulator or moon run client:tauri-android-deploy-debug first.`,
      );
    }

    const device = pickDevice(connectedDevices);
    let page: import("@playwright/test").Page | undefined;

    try {
      page = await prepareAndroidApp(device, server);
      await setServerPreference(server, "transcodingEnabled", true);
      await page.reload();
      await waitForAuthenticatedHome(page, 30000);
      await ensureTranscodingEnabled(page);

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
              await device.shell(
                "logcat -d -s PlaybackService:V NativeAudioPlugin:V",
              )
            ).toString("utf-8");

            return logs.includes("transcodingEnabled=true");
          },
          {
            timeout: 15000,
            message:
              "Expected PlaybackService to receive transcodingEnabled=true before backgrounding",
          },
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            const logs = (
              await device.shell("logcat -d -s PlaybackService:V")
            ).toString("utf-8");

            return countOccurrences(logs, "onMediaItemTransition:");
          },
          {
            timeout: 15000,
            message:
              "Expected PlaybackService to emit an initial media-item transition after playback starts",
          },
        )
        .toBeGreaterThan(0);

      const initialTransitionLogs = (
        await device.shell("logcat -d -s PlaybackService:V")
      ).toString("utf-8");
      const initialTransitionCount = countOccurrences(
        initialTransitionLogs,
        "onMediaItemTransition:",
      );

      await device.shell("input keyevent 3");

      await expect
        .poll(
          async () => {
            const logs = (
              await device.shell("logcat -d -s PlaybackService:V")
            ).toString("utf-8");

            return countOccurrences(logs, "onMediaItemTransition:");
          },
          {
            timeout: 120000,
            message:
              "Expected background transcoded playback to emit another native media-item transition",
          },
        )
        .toBeGreaterThan(initialTransitionCount);

      page = await resumeAndroidApp(device);

      const resumedPlayerBar = page.getByTestId("player-bar");
      await expect(resumedPlayerBar).toBeVisible({ timeout: 30000 });
      await expect(resumedPlayerBar).not.toContainText("First Song", {
        timeout: 15000,
      });

      const logs = (
        await device.shell("logcat -d -s PlaybackService:V NativeAudioPlugin:V")
      ).toString("utf-8");

      expect(logs).not.toContain(
        "Network retry: reloaded transcoded stream at offset 0s",
      );
    } catch (error) {
      if (page) {
        await page
          .screenshot({
            path: testInfo.outputPath(
              "android-background-transcoded-advance-failure.png",
            ),
          })
          .catch(() => undefined);
      }

      await device
        .screenshot({
          path: testInfo.outputPath(
            "android-background-transcoded-advance-device-failure.png",
          ),
        })
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
        `Debug APK not found at ${DEBUG_APK_PATH}. Run moon run client:test-android-emulator or moon run client:tauri-android-deploy-debug first.`,
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

      const logs = (
        await device.shell("logcat -d -s NativeAudioPlugin:V PlaybackService:V")
      ).toString("utf-8");

      expect(countOccurrences(logs, "startPlayback() command received")).toBe(
        1,
      );
      expect(logs).toContain("softInvalidateQueue: totalCount");
      expect(logs).not.toContain("current track removed, doing full reload");
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

  test("shuffled play next preserves playback and updates queue on Android", async ({
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
        `Debug APK not found at ${DEBUG_APK_PATH}. Run moon run client:test-android-emulator or moon run client:tauri-android-deploy-debug first.`,
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

      await playerBar.getByRole("button", { name: /shuffle/i }).click();
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

      const logs = (
        await device.shell("logcat -d -s NativeAudioPlugin:V PlaybackService:V")
      ).toString("utf-8");

      expect(countOccurrences(logs, "startPlayback() command received")).toBe(
        1,
      );
      expect(logs).toContain("softInvalidateQueue: totalCount");
      expect(logs).not.toContain("current track removed, doing full reload");
    } catch (error) {
      if (page) {
        await page
          .screenshot({
            path: testInfo.outputPath("android-shuffled-play-next-failure.png"),
          })
          .catch(() => undefined);
      }

      await device
        .screenshot({
          path: testInfo.outputPath(
            "android-shuffled-play-next-device-failure.png",
          ),
        })
        .catch(() => undefined);

      throw error;
    } finally {
      await device.close().catch(() => undefined);
    }
  });
});
