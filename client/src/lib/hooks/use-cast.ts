"use client";

import { useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  castStateAtom,
  castDeviceNameAtom,
  castSdkLoadedAtom,
} from "@/lib/store/cast";
import {
  currentSongAtom,
  queueWindowAtom,
  serverQueueStateAtom,
  type RepeatMode,
  type ServerQueueState,
} from "@/lib/store/server-queue";
import {
  playbackStateAtom,
  currentTimeAtom,
  durationAtom,
  bufferedAtom,
  volumeAtom,
  isMutedAtom,
} from "@/lib/store/player";
import {
  clientIdAtom,
  effectiveSessionIdAtom,
  isAudioOwnerAtom,
  ownerClientIdAtom,
  ownerClientNameAtom,
  remotePlaybackStateAtom,
} from "@/lib/store/session";
import { getClient } from "@/lib/api/client";
import type {
  GetQueueResponse,
  QueueSongEntry,
  QueueWindow,
  Song,
} from "@/lib/api/types";
import { getActiveAudio } from "@/lib/audio/web-audio";
import { CAST_CLIENT_NAME } from "@/lib/cast/constants";
import type { SessionEvent } from "@/lib/hooks/use-session-events";
import { isTauriMobile } from "@/lib/tauri";
import { appResumeRepaintEvent } from "@/lib/utils/app-resume-repaint";
import type {
  CastConnectionState,
  CastMediaStatus,
  CastStateSnapshot,
  LoadCastMediaQueueItemParams,
} from "tauri-plugin-native-audio-api";

const CAST_HEARTBEAT_INTERVAL_MS = 5_000;
const NATIVE_CAST_STATUS_INTERVAL_MS = 1_000;
const NATIVE_AUDIO_EVENT = "ferrotune:native-audio-event";
const NATIVE_CAST_STATE_EVENT = "cast-state-changed";
const NATIVE_CAST_MEDIA_STATUS_EVENT = "cast-media-status";

let nativeCastApi: typeof import("tauri-plugin-native-audio-api") | null = null;

interface NativeCastStatusSnapshot extends CastMediaStatus {
  receivedAtMs: number;
}

async function getNativeCastApi() {
  if (!nativeCastApi) {
    nativeCastApi = await import("tauri-plugin-native-audio-api");
  }
  return nativeCastApi;
}

function getCastClientId(clientId: string): string | null {
  return clientId ? `${CAST_CLIENT_NAME}:${clientId}` : null;
}

function toRepeatMode(mode: string): RepeatMode {
  if (mode === "all" || mode === "one") return mode;
  return "off";
}

function queueStateFromResponse(response: GetQueueResponse): ServerQueueState {
  return {
    totalCount: response.totalCount,
    currentIndex: response.currentIndex,
    positionMs: Number(response.positionMs),
    isShuffled: response.isShuffled,
    repeatMode: toRepeatMode(response.repeatMode),
    source: response.source,
  };
}

function getCurrentSongFromQueueResponse(
  response: GetQueueResponse,
): Song | null {
  return (
    getQueueEntryAtPosition(response.window, response.currentIndex)?.song ??
    null
  );
}

function getQueueEntryAtPosition(
  window: QueueWindow,
  position: number,
): QueueSongEntry | null {
  return window.songs.find((entry) => entry.position === position) ?? null;
}

function getQueueEntryForCastStatus(
  window: QueueWindow | null,
  status: CastMediaStatus,
): QueueSongEntry | null {
  if (!window) return null;

  if (status.queuePosition !== undefined) {
    const entry = getQueueEntryAtPosition(window, status.queuePosition);
    if (entry) return entry;
  }

  if (!status.songId) return null;
  return window.songs.find((entry) => entry.song.id === status.songId) ?? null;
}

function getCurrentCastSession(): cast.framework.CastSession | null {
  return cast.framework.CastContext.getInstance().getCurrentSession();
}

function getCurrentCastMedia(): chrome.cast.media.Media | null {
  return getCurrentCastSession()?.getMediaSession() ?? null;
}

function getWebCastPositionMs(): number {
  const media = getCurrentCastMedia();
  if (!media) return 0;
  return Math.max(0, Math.round(media.getEstimatedTime() * 1000));
}

function getActiveCastPositionMs(
  useNativeCast: boolean,
  nativeStatus: NativeCastStatusSnapshot | null,
): number {
  if (useNativeCast) {
    if (!nativeStatus) return 0;
    if (!nativeStatus.isPlaying) return nativeStatus.positionMs;
    const elapsedMs = Date.now() - nativeStatus.receivedAtMs;
    const durationMs =
      nativeStatus.durationMs > 0 ? nativeStatus.durationMs : Infinity;
    return Math.max(
      0,
      Math.min(durationMs, nativeStatus.positionMs + elapsedMs),
    );
  }
  return getWebCastPositionMs();
}

function isActiveCastMediaPlaying(
  useNativeCast: boolean,
  nativeStatus: NativeCastStatusSnapshot | null,
): boolean {
  if (useNativeCast) return nativeStatus?.isPlaying ?? false;
  return isCastMediaPlaying(getCurrentCastMedia());
}

function isCastMediaPlaying(media: chrome.cast.media.Media | null): boolean {
  return (
    media?.playerState === chrome.cast.media.PlayerState.PLAYING ||
    media?.playerState === chrome.cast.media.PlayerState.BUFFERING
  );
}

function isFinishedCastMedia(media: chrome.cast.media.Media): boolean {
  return (
    media.playerState === chrome.cast.media.PlayerState.IDLE &&
    media.idleReason === chrome.cast.media.IdleReason.FINISHED
  );
}

function isFinishedNativeCastMedia(status: CastMediaStatus): boolean {
  return status.playerState === "idle" && status.idleReason === "finished";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function toCastConnectionState(value: string | undefined): CastConnectionState {
  if (
    value === "available" ||
    value === "connecting" ||
    value === "connected"
  ) {
    return value;
  }
  return "unavailable";
}

function toCastMediaStatus(value: unknown): CastMediaStatus | null {
  if (!isRecord(value)) return null;
  const playerState = stringField(value, "playerState");
  const idleReason = stringField(value, "idleReason");

  return {
    positionMs: numberField(value, "positionMs"),
    durationMs: numberField(value, "durationMs"),
    isPlaying: booleanField(value, "isPlaying"),
    playerState:
      playerState === "idle" ||
      playerState === "playing" ||
      playerState === "paused" ||
      playerState === "buffering"
        ? playerState
        : "unknown",
    idleReason:
      idleReason === "finished" ||
      idleReason === "canceled" ||
      idleReason === "interrupted" ||
      idleReason === "error"
        ? idleReason
        : undefined,
    songId: stringField(value, "songId") ?? null,
    queuePosition: optionalNumberField(value, "queuePosition"),
    title: stringField(value, "title") ?? null,
    artist: stringField(value, "artist") ?? null,
    volume: optionalNumberField(value, "volume"),
    isMuted: typeof value.isMuted === "boolean" ? value.isMuted : undefined,
  };
}

function toCastStateSnapshot(value: unknown): CastStateSnapshot | null {
  if (!isRecord(value)) return null;
  return {
    state: toCastConnectionState(stringField(value, "state")),
    deviceName: stringField(value, "deviceName") ?? null,
    mediaStatus: toCastMediaStatus(value["mediaStatus"]) ?? undefined,
  };
}

function nativeAudioEventDetail(event: Event): {
  event: string;
  data: unknown;
} | null {
  if (!(event instanceof CustomEvent)) return null;
  if (!isRecord(event.detail)) return null;
  const eventName = stringField(event.detail, "event");
  if (!eventName) return null;
  return { event: eventName, data: event.detail.data };
}

function runCastMediaCommand(
  run: (
    resolve: () => void,
    reject: (error: chrome.cast.Error) => void,
  ) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    run(resolve, reject);
  });
}

/**
 * Build a stream URL with embedded auth for Chromecast to fetch directly.
 */
function buildCastStreamUrl(songId: string): string | null {
  const client = getClient();
  if (!client) return null;
  // Use the existing getStreamUrl which embeds auth in query params
  return client.getStreamUrl(songId);
}

/**
 * Build a cover art URL for Chromecast display.
 */
function buildCastCoverArtUrl(coverArtId: string | undefined): string | null {
  if (!coverArtId) return null;
  const client = getClient();
  if (!client) return null;
  return client.getCoverArtUrl(coverArtId, "large");
}

function buildNativeCastQueueItem(
  entry: QueueSongEntry,
): LoadCastMediaQueueItemParams | null {
  const song = entry.song;
  const streamUrl = buildCastStreamUrl(song.id);
  if (!streamUrl) return null;

  return {
    url: streamUrl,
    contentType: song.contentType || "audio/mpeg",
    songId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    coverArtUrl: buildCastCoverArtUrl(
      song.coverArt ?? song.albumId ?? undefined,
    ),
    durationMs: Math.max(0, Math.round((song.duration ?? 0) * 1000)),
    position: entry.position,
  };
}

function isNativeCastQueueItem(
  item: LoadCastMediaQueueItemParams | null,
): item is LoadCastMediaQueueItemParams {
  return item !== null;
}

function buildNativeCastQueueItems(
  queueWindow: QueueWindow | null,
): LoadCastMediaQueueItemParams[] | undefined {
  if (!queueWindow) return undefined;
  const items = [...queueWindow.songs]
    .sort((left, right) => left.position - right.position)
    .map(buildNativeCastQueueItem)
    .filter(isNativeCastQueueItem);

  return items.length > 0 ? items : undefined;
}

function nativeFinishedKey(status: CastMediaStatus, song: Song | null): string {
  return `${status.queuePosition ?? "unknown"}:${status.songId ?? song?.id ?? "unknown"}`;
}

/**
 * Load a song onto the Chromecast.
 */
async function loadMediaOnCast(
  song: Song,
  startTime = 0,
  useNativeCast = false,
  queueWindow: QueueWindow | null = null,
  queueState: ServerQueueState | null = null,
): Promise<boolean> {
  if (useNativeCast) {
    const streamUrl = buildCastStreamUrl(song.id);
    if (!streamUrl) return false;

    const coverArtUrl = buildCastCoverArtUrl(
      song.coverArt ?? song.albumId ?? undefined,
    );

    try {
      const api = await getNativeCastApi();
      await api.loadCastMedia({
        url: streamUrl,
        contentType: song.contentType || "audio/mpeg",
        songId: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        coverArtUrl,
        durationMs: Math.max(0, Math.round((song.duration ?? 0) * 1000)),
        startTimeMs: Math.max(0, Math.round(startTime * 1000)),
        currentIndex: queueState?.currentIndex,
        repeatMode: queueState?.repeatMode,
        queueItems: buildNativeCastQueueItems(queueWindow),
      });
      console.log("[Cast] Native media loaded successfully");
      return true;
    } catch (error) {
      console.error("[Cast] Error loading native media:", error);
      return false;
    }
  }

  const castSession = getCurrentCastSession();
  if (!castSession) return false;

  const streamUrl = buildCastStreamUrl(song.id);
  if (!streamUrl) return false;

  const mediaInfo = new chrome.cast.media.MediaInfo(
    streamUrl,
    song.contentType || "audio/mpeg",
  );
  mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;

  const metadata = new chrome.cast.media.MusicTrackMediaMetadata();
  metadata.metadataType = chrome.cast.media.MetadataType.MUSIC_TRACK;
  metadata.title = song.title;
  metadata.songName = song.title;
  metadata.artist = song.artist ?? undefined;
  if (song.album) metadata.albumName = song.album;
  if (song.track) metadata.trackNumber = song.track;
  if (song.discNumber) metadata.discNumber = song.discNumber;

  const coverArtUrl = buildCastCoverArtUrl(
    song.coverArt ?? song.albumId ?? undefined,
  );
  if (coverArtUrl) {
    metadata.images = [new chrome.cast.Image(coverArtUrl)];
  }

  mediaInfo.metadata = metadata;
  mediaInfo.customData = { songId: song.id, applicationName: "Ferrotune" };

  if (song.duration) {
    mediaInfo.duration = song.duration;
  }

  const request = new chrome.cast.media.LoadRequest(mediaInfo);
  request.currentTime = startTime;
  request.autoplay = true;

  try {
    await castSession.loadMedia(request);
    console.log("[Cast] Media loaded successfully");
    return true;
  } catch (error) {
    console.error("[Cast] Error loading media:", error);
    return false;
  }
}

async function playCastMedia(): Promise<void> {
  if (isTauriMobile()) {
    const api = await getNativeCastApi();
    await api.playCastMedia();
    return;
  }

  const media = getCurrentCastMedia();
  if (!media) return;
  await runCastMediaCommand((resolve, reject) => {
    media.play(new chrome.cast.media.PlayRequest(), resolve, reject);
  });
}

async function pauseCastMedia(): Promise<void> {
  if (isTauriMobile()) {
    const api = await getNativeCastApi();
    await api.pauseCastMedia();
    return;
  }

  const media = getCurrentCastMedia();
  if (!media) return;
  await runCastMediaCommand((resolve, reject) => {
    media.pause(new chrome.cast.media.PauseRequest(), resolve, reject);
  });
}

async function stopCastMedia(): Promise<void> {
  if (isTauriMobile()) {
    const api = await getNativeCastApi();
    await api.stopCastMedia();
    return;
  }

  const media = getCurrentCastMedia();
  if (!media) return;
  await runCastMediaCommand((resolve, reject) => {
    media.stop(new chrome.cast.media.StopRequest(), resolve, reject);
  });
}

async function seekCastMedia(positionMs: number): Promise<void> {
  if (isTauriMobile()) {
    const api = await getNativeCastApi();
    await api.seekCastMedia(positionMs);
    return;
  }

  const media = getCurrentCastMedia();
  if (!media) return;
  const request = new chrome.cast.media.SeekRequest();
  request.currentTime = Math.max(0, positionMs / 1000);
  request.resumeState = chrome.cast.media.ResumeState.PLAYBACK_START;

  await runCastMediaCommand((resolve, reject) => {
    media.seek(request, resolve, reject);
  });
}

async function setCastMediaVolume(
  volume: number | undefined,
  isMuted: boolean | undefined,
): Promise<void> {
  if (isTauriMobile()) {
    const api = await getNativeCastApi();
    await api.setCastVolume(volume ?? 1, isMuted ?? false);
    return;
  }

  const castSession = getCurrentCastSession();
  if (!castSession) return;

  const clampedVolume =
    volume === undefined ? undefined : Math.max(0, Math.min(1, volume));

  if (clampedVolume !== undefined) {
    await castSession.setVolume(clampedVolume);
  }

  if (isMuted !== undefined) {
    await castSession.setMute(isMuted);
  }
}

/**
 * Hook that initializes the Chromecast SDK and manages the Cast lifecycle.
 * Should be called once at the app root level.
 */
export function useCastInit() {
  const useNativeCast = isTauriMobile();
  const castState = useAtomValue(castStateAtom);
  const setCastState = useSetAtom(castStateAtom);
  const setCastDeviceName = useSetAtom(castDeviceNameAtom);
  const setCastSdkLoaded = useSetAtom(castSdkLoadedAtom);
  const currentSong = useAtomValue(currentSongAtom);
  const currentTime = useAtomValue(currentTimeAtom);
  const duration = useAtomValue(durationAtom);
  const queueState = useAtomValue(serverQueueStateAtom);
  const queueWindow = useAtomValue(queueWindowAtom);
  const sessionId = useAtomValue(effectiveSessionIdAtom);
  const clientId = useAtomValue(clientIdAtom);
  const castClientId = getCastClientId(clientId);
  const castDeviceName = useAtomValue(castDeviceNameAtom);
  const [isAudioOwner, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const setOwnerClientId = useSetAtom(ownerClientIdAtom);
  const setOwnerClientName = useSetAtom(ownerClientNameAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);
  const setPlaybackState = useSetAtom(playbackStateAtom);
  const setCurrentTime = useSetAtom(currentTimeAtom);
  const setDuration = useSetAtom(durationAtom);
  const setBuffered = useSetAtom(bufferedAtom);
  const [volume, setVolume] = useAtom(volumeAtom);
  const [isMuted, setIsMuted] = useAtom(isMutedAtom);
  const setServerQueueState = useSetAtom(serverQueueStateAtom);
  const setQueueWindow = useSetAtom(queueWindowAtom);

  // Refs to store latest values for event callbacks
  const currentSongRef = useRef(currentSong);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const queueStateRef = useRef(queueState);
  const queueWindowRef = useRef(queueWindow);
  const sessionIdRef = useRef(sessionId);
  const castClientIdRef = useRef(castClientId);
  const isAudioOwnerRef = useRef(isAudioOwner);
  const eventSourceRef = useRef<EventSource | null>(null);
  const mediaRef = useRef<chrome.cast.media.Media | null>(null);
  const nativeCastStatusRef = useRef<NativeCastStatusSnapshot | null>(null);
  const mediaUpdateListenerRef = useRef<((isAlive: boolean) => void) | null>(
    null,
  );
  const loadedSongIdRef = useRef<string | null>(null);
  const lastFinishedMediaSessionIdRef = useRef<number | null>(null);
  const lastFinishedNativeKeyRef = useRef<string | null>(null);
  const syncingNativeReceiverKeyRef = useRef<string | null>(null);
  const claimedCastClientIdRef = useRef<string | null>(null);
  const ignoreNextSelfTakeOverLoadRef = useRef(false);
  const sendCastHeartbeatRef = useRef<(isPlaying?: boolean) => Promise<void>>(
    async () => {},
  );
  const claimCastOwnershipRef = useRef<
    (positionMsOverride?: number) => Promise<void>
  >(async () => {});
  const claimCastAndLoadRef = useRef<() => Promise<void>>(async () => {});
  const claimCastAndAdoptRef = useRef<
    (status?: CastMediaStatus | null) => Promise<void>
  >(async () => {});
  const refreshNativeCastSnapshotRef = useRef<() => Promise<void>>(
    async () => {},
  );
  const loadCurrentCastSongRef = useRef<
    (positionMs?: number) => Promise<boolean>
  >(async () => false);
  const fetchQueueAndLoadCurrentRef = useRef<
    (positionMs?: number) => Promise<void>
  >(async () => {});
  const advanceCastQueueRef = useRef<
    (direction: "next" | "previous" | number) => Promise<void>
  >(async () => {});
  const syncNativeReceiverQueueRef = useRef<
    (status: NativeCastStatusSnapshot) => Promise<void>
  >(async () => {});
  const handleCastSessionEventRef = useRef<
    (event: SessionEvent) => Promise<void>
  >(async () => {});
  const handleCastMediaUpdateRef = useRef<
    (media: chrome.cast.media.Media) => void
  >(() => {});
  const handleNativeCastMediaStatusRef = useRef<
    (status: CastMediaStatus) => void
  >(() => {});
  const detachCastMediaListenerRef = useRef<() => void>(() => {});
  const attachCastMediaListenerRef = useRef<
    (media: chrome.cast.media.Media | null) => void
  >(() => {});

  useEffect(() => {
    currentSongRef.current = currentSong;
    currentTimeRef.current = currentTime;
    durationRef.current = duration;
    queueStateRef.current = queueState;
    queueWindowRef.current = queueWindow;
    sessionIdRef.current = sessionId;
    castClientIdRef.current = castClientId;
    isAudioOwnerRef.current = isAudioOwner;
  });

  useEffect(() => {
    detachCastMediaListenerRef.current = () => {
      const media = mediaRef.current;
      const listener = mediaUpdateListenerRef.current;
      if (media && listener) {
        media.removeUpdateListener(listener);
      }
      mediaRef.current = null;
      mediaUpdateListenerRef.current = null;
    };

    attachCastMediaListenerRef.current = (media) => {
      if (!media || mediaRef.current === media) return;
      detachCastMediaListenerRef.current();

      const listener = (isAlive: boolean) => {
        if (!isAlive && !isFinishedCastMedia(media)) return;
        handleCastMediaUpdateRef.current(media);
      };

      media.addUpdateListener(listener);
      mediaRef.current = media;
      mediaUpdateListenerRef.current = listener;
    };
  });

  useEffect(() => {
    sendCastHeartbeatRef.current = async (isPlayingOverride?: boolean) => {
      const sid = sessionIdRef.current;
      const virtualClientId = castClientIdRef.current;
      if (!sid || !virtualClientId) return;

      const client = getClient();
      if (!client) return;

      const song = currentSongRef.current;
      const state = queueStateRef.current;
      const isPlaying =
        isPlayingOverride ??
        isActiveCastMediaPlaying(useNativeCast, nativeCastStatusRef.current);
      const positionMs = getActiveCastPositionMs(
        useNativeCast,
        nativeCastStatusRef.current,
      );

      setRemotePlaybackState({
        isPlaying,
        currentIndex: state?.currentIndex ?? 0,
        positionMs,
        positionTimestamp: Date.now(),
        currentSongId: song?.id,
        currentSongTitle: song?.title,
        currentSongArtist: song?.artist,
      });
      setPlaybackState(isPlaying ? "playing" : "paused");
      setCurrentTime(positionMs / 1000);

      await client.sessionHeartbeat(sid, {
        clientId: virtualClientId,
        isPlaying,
        currentIndex: state?.currentIndex,
        positionMs,
        currentSongId: song?.id,
        currentSongTitle: song?.title,
        currentSongArtist: song?.artist,
      });
    };

    claimCastOwnershipRef.current = async (positionMsOverride?: number) => {
      const sid = sessionIdRef.current;
      const virtualClientId = castClientIdRef.current;
      if (!sid || !virtualClientId) return;

      const client = getClient();
      if (!client) return;

      const positionMs = Math.max(
        0,
        Math.round(positionMsOverride ?? currentTimeRef.current * 1000),
      );

      await client.sendSessionCommand(
        sid,
        "takeOver",
        positionMs,
        undefined,
        undefined,
        CAST_CLIENT_NAME,
        virtualClientId,
        true,
      );

      const activeAudio = getActiveAudio();
      if (activeAudio && !activeAudio.paused) {
        activeAudio.pause();
      }

      setOwnerClientId(virtualClientId);
      setOwnerClientName(CAST_CLIENT_NAME);
      setIsAudioOwner(false);
    };

    claimCastAndLoadRef.current = async () => {
      const sid = sessionIdRef.current;
      const virtualClientId = castClientIdRef.current;
      if (!sid || !virtualClientId) return;
      if (claimedCastClientIdRef.current === virtualClientId) return;

      await claimCastOwnershipRef.current();
      claimedCastClientIdRef.current = virtualClientId;
      await loadCurrentCastSongRef.current();
    };

    claimCastAndAdoptRef.current = async (status) => {
      const sid = sessionIdRef.current;
      const virtualClientId = castClientIdRef.current;
      if (!sid || !virtualClientId) return;

      if (status?.songId) {
        ignoreNextSelfTakeOverLoadRef.current = true;
        await claimCastOwnershipRef.current(status.positionMs);
        claimedCastClientIdRef.current = virtualClientId;
        loadedSongIdRef.current = status.songId;
        setPlaybackState(status.isPlaying ? "playing" : "paused");
        if (status.durationMs > 0) {
          setDuration(status.durationMs / 1000);
        }
        setCurrentTime(status.positionMs / 1000);
        await sendCastHeartbeatRef.current(status.isPlaying);
        return;
      }

      await claimCastOwnershipRef.current();
      claimedCastClientIdRef.current = virtualClientId;
      await loadCurrentCastSongRef.current();
    };

    loadCurrentCastSongRef.current = async (positionMs?: number) => {
      const song = currentSongRef.current;
      if (!song) return false;

      setPlaybackState("loading");
      setDuration(song.duration ?? durationRef.current);
      setBuffered(0);

      const startPositionMs =
        positionMs ?? Math.round(currentTimeRef.current * 1000);
      const startTime = Math.max(0, startPositionMs / 1000);
      currentTimeRef.current = startTime;
      setCurrentTime(startTime);

      const loaded = await loadMediaOnCast(
        song,
        startTime,
        useNativeCast,
        queueWindowRef.current,
        queueStateRef.current,
      );
      if (!loaded) return false;

      loadedSongIdRef.current = song.id;
      lastFinishedNativeKeyRef.current = null;
      if (!useNativeCast) {
        attachCastMediaListenerRef.current(getCurrentCastMedia());
      }
      setPlaybackState("playing");
      await sendCastHeartbeatRef.current(true);
      return true;
    };

    fetchQueueAndLoadCurrentRef.current = async (positionMs?: number) => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      const client = getClient();
      if (!client) return;

      const response = await client.getQueueCurrentWindow(20, "small", sid);
      const nextSong = getCurrentSongFromQueueResponse(response);
      const nextQueueState = queueStateFromResponse(response);

      queueStateRef.current = nextQueueState;
      queueWindowRef.current = response.window;
      setServerQueueState(nextQueueState);
      setQueueWindow(response.window);

      if (nextSong) {
        currentSongRef.current = nextSong;
        currentTimeRef.current = Math.max(0, (positionMs ?? 0) / 1000);
        await loadCurrentCastSongRef.current(positionMs ?? 0);
      }
    };

    advanceCastQueueRef.current = async (direction) => {
      const sid = sessionIdRef.current;
      const virtualClientId = castClientIdRef.current;
      const state = queueStateRef.current;
      if (!sid || !virtualClientId || !state) return;

      const client = getClient();
      if (!client) return;

      let nextIndex: number;
      let shouldReshuffle = false;

      if (typeof direction === "number") {
        nextIndex = direction;
      } else if (state.repeatMode === "one" && direction === "next") {
        nextIndex = state.currentIndex;
      } else if (direction === "next") {
        nextIndex = state.currentIndex + 1;
        const isWrapping = nextIndex >= state.totalCount;
        if (isWrapping) {
          if (state.repeatMode !== "all") {
            setRemotePlaybackState((previous) =>
              previous ? { ...previous, isPlaying: false } : previous,
            );
            await sendCastHeartbeatRef.current(false);
            setPlaybackState("ended");
            return;
          }
          nextIndex = 0;
          shouldReshuffle = state.isShuffled;
        }
      } else {
        const positionMs = getActiveCastPositionMs(
          useNativeCast,
          nativeCastStatusRef.current,
        );
        if (positionMs > 3_000) {
          await seekCastMedia(0);
          await sendCastHeartbeatRef.current(true);
          return;
        }

        nextIndex = state.currentIndex - 1;
        if (nextIndex < 0) {
          if (state.repeatMode !== "all") {
            await seekCastMedia(0);
            await sendCastHeartbeatRef.current(true);
            return;
          }
          nextIndex = state.totalCount - 1;
        }
      }

      const positionResponse = await client.updateServerQueuePosition(
        nextIndex,
        0,
        shouldReshuffle,
        sid,
        virtualClientId,
        true,
      );
      const resolvedIndex = positionResponse.newIndex ?? nextIndex;
      const response = await client.getQueueCurrentWindow(20, "small", sid);
      const nextSong =
        getQueueEntryAtPosition(response.window, resolvedIndex)?.song ??
        getCurrentSongFromQueueResponse(response);
      const nextQueueState = {
        ...queueStateFromResponse(response),
        currentIndex: resolvedIndex,
        positionMs: 0,
      };

      queueStateRef.current = nextQueueState;
      queueWindowRef.current = response.window;
      setServerQueueState(nextQueueState);
      setQueueWindow(response.window);

      if (nextSong) {
        currentSongRef.current = nextSong;
        currentTimeRef.current = 0;
        lastFinishedMediaSessionIdRef.current = null;
        lastFinishedNativeKeyRef.current = null;
        await loadCurrentCastSongRef.current(0);
      }
    };

    syncNativeReceiverQueueRef.current = async (status) => {
      const syncKey = nativeFinishedKey(status, currentSongRef.current);
      if (syncingNativeReceiverKeyRef.current === syncKey) return;
      syncingNativeReceiverKeyRef.current = syncKey;

      const sid = sessionIdRef.current;
      const virtualClientId = castClientIdRef.current;
      const state = queueStateRef.current;
      if (!sid || !virtualClientId || !state) {
        syncingNativeReceiverKeyRef.current = null;
        return;
      }

      const client = getClient();
      if (!client) {
        syncingNativeReceiverKeyRef.current = null;
        return;
      }

      let response: GetQueueResponse | null = null;
      let entry = getQueueEntryForCastStatus(queueWindowRef.current, status);

      if (!entry) {
        response = await client.getQueueCurrentWindow(20, "small", sid);
        entry = getQueueEntryForCastStatus(response.window, status);
      }

      if (!entry) {
        syncingNativeReceiverKeyRef.current = null;
        return;
      }

      await client.updateServerQueuePosition(
        entry.position,
        status.positionMs,
        false,
        sid,
        virtualClientId,
        true,
      );

      response = await client.getQueueCurrentWindow(20, "small", sid);
      const syncedEntry =
        getQueueEntryAtPosition(response.window, entry.position) ?? entry;
      const nextQueueState = {
        ...queueStateFromResponse(response),
        currentIndex: entry.position,
        positionMs: status.positionMs,
      };

      queueStateRef.current = nextQueueState;
      queueWindowRef.current = response.window;
      currentSongRef.current = syncedEntry.song;
      currentTimeRef.current = Math.max(0, status.positionMs / 1000);
      loadedSongIdRef.current = syncedEntry.song.id;
      lastFinishedNativeKeyRef.current = null;

      setServerQueueState(nextQueueState);
      setQueueWindow(response.window);
      setCurrentTime(status.positionMs / 1000);
      if (status.durationMs > 0) {
        setDuration(status.durationMs / 1000);
      } else if (syncedEntry.song.duration) {
        setDuration(syncedEntry.song.duration);
      }
      setPlaybackState(status.isPlaying ? "playing" : "paused");
      await sendCastHeartbeatRef.current(status.isPlaying);
      syncingNativeReceiverKeyRef.current = null;
    };

    handleCastSessionEventRef.current = async (event) => {
      if (event.type === "playbackCommand") {
        if (event.action === "takeOver") {
          if (event.clientId === castClientIdRef.current) {
            setOwnerClientId(event.clientId ?? null);
            setOwnerClientName(CAST_CLIENT_NAME);
            setIsAudioOwner(false);
            if (ignoreNextSelfTakeOverLoadRef.current) {
              ignoreNextSelfTakeOverLoadRef.current = false;
              if (event.positionMs !== undefined) {
                setCurrentTime(event.positionMs / 1000);
              }
              await sendCastHeartbeatRef.current();
            } else {
              await fetchQueueAndLoadCurrentRef.current(event.positionMs);
            }
          } else {
            await stopCastMedia().catch(console.error);
            if (useNativeCast) {
              const api = await getNativeCastApi();
              await api.stopCastSession();
            } else {
              getCurrentCastSession()?.endSession(true);
            }
          }
          return;
        }

        switch (event.action) {
          case "play":
            await playCastMedia();
            await sendCastHeartbeatRef.current(true);
            break;
          case "pause":
          case "stop":
            await pauseCastMedia();
            await sendCastHeartbeatRef.current(false);
            break;
          case "next":
            await advanceCastQueueRef.current("next");
            break;
          case "previous":
            await advanceCastQueueRef.current("previous");
            break;
          case "playAtIndex":
            if (event.currentIndex !== undefined) {
              await advanceCastQueueRef.current(event.currentIndex);
            }
            break;
          case "seek":
            if (event.positionMs !== undefined) {
              await seekCastMedia(event.positionMs);
              await sendCastHeartbeatRef.current(true);
            }
            break;
          case "setVolume":
            await setCastMediaVolume(event.volume, event.isMuted);
            break;
        }
        return;
      }

      if (event.type === "queueChanged") {
        await fetchQueueAndLoadCurrentRef.current(0);
        return;
      }

      if (event.type === "queueUpdated") {
        const sid = sessionIdRef.current;
        const client = getClient();
        if (!sid || !client) return;
        const response = await client.getQueueCurrentWindow(20, "small", sid);
        const nextQueueState = queueStateFromResponse(response);
        queueStateRef.current = nextQueueState;
        queueWindowRef.current = response.window;
        setServerQueueState(nextQueueState);
        setQueueWindow(response.window);
      }
    };

    handleCastMediaUpdateRef.current = (media) => {
      const positionMs = Math.max(
        0,
        Math.round(media.getEstimatedTime() * 1000),
      );
      const isPlaying = isCastMediaPlaying(media);
      const state = queueStateRef.current;
      const song = currentSongRef.current;

      setRemotePlaybackState({
        isPlaying,
        currentIndex: state?.currentIndex ?? 0,
        positionMs,
        positionTimestamp: Date.now(),
        currentSongId: song?.id,
        currentSongTitle: song?.title,
        currentSongArtist: song?.artist,
      });
      setPlaybackState(isPlaying ? "playing" : "paused");
      setCurrentTime(positionMs / 1000);

      const finished = isFinishedCastMedia(media);

      if (
        finished &&
        lastFinishedMediaSessionIdRef.current !== media.mediaSessionId
      ) {
        lastFinishedMediaSessionIdRef.current = media.mediaSessionId;
        advanceCastQueueRef.current("next").catch(console.error);
      }
    };

    handleNativeCastMediaStatusRef.current = (status) => {
      const snapshot: NativeCastStatusSnapshot = {
        ...status,
        receivedAtMs: Date.now(),
      };
      nativeCastStatusRef.current = snapshot;
      const positionMs = Math.max(0, Math.round(snapshot.positionMs));
      const isPlaying = status.isPlaying;
      const state = queueStateRef.current;
      const song = currentSongRef.current;

      if (snapshot.songId) {
        loadedSongIdRef.current = snapshot.songId;
      }

      setRemotePlaybackState({
        isPlaying,
        currentIndex: state?.currentIndex ?? 0,
        positionMs,
        positionTimestamp: Date.now(),
        currentSongId: song?.id,
        currentSongTitle: song?.title,
        currentSongArtist: song?.artist,
      });
      setPlaybackState(isPlaying ? "playing" : "paused");
      setCurrentTime(positionMs / 1000);

      if (status.durationMs > 0) {
        setDuration(status.durationMs / 1000);
      }

      if (snapshot.volume !== undefined) {
        const nextVolume = Math.max(0, Math.min(1, snapshot.volume));
        if (Math.abs(nextVolume - volume) > 0.001) {
          setVolume(nextVolume);
        }
      }

      if (snapshot.isMuted !== undefined && snapshot.isMuted !== isMuted) {
        setIsMuted(snapshot.isMuted);
      }

      const receiverQueuePositionChanged =
        snapshot.queuePosition !== undefined &&
        snapshot.queuePosition !== state?.currentIndex;
      const receiverSongChanged = Boolean(
        snapshot.songId && snapshot.songId !== song?.id,
      );
      if (
        !isFinishedNativeCastMedia(snapshot) &&
        (receiverQueuePositionChanged || receiverSongChanged)
      ) {
        syncNativeReceiverQueueRef.current(snapshot).catch((error) => {
          syncingNativeReceiverKeyRef.current = null;
          console.error(error);
        });
      }

      const finishedKey = nativeFinishedKey(snapshot, song);
      if (
        isFinishedNativeCastMedia(snapshot) &&
        lastFinishedNativeKeyRef.current !== finishedKey
      ) {
        lastFinishedNativeKeyRef.current = finishedKey;
        advanceCastQueueRef.current("next").catch(console.error);
      }
    };
  });

  useEffect(() => {
    if (useNativeCast) {
      let disposed = false;

      const applyNativeSnapshot = (snapshot: CastStateSnapshot) => {
        if (disposed) return;
        setCastSdkLoaded(true);
        setCastState(snapshot.state);
        setCastDeviceName(snapshot.deviceName ?? null);

        if (snapshot.mediaStatus) {
          handleNativeCastMediaStatusRef.current(snapshot.mediaStatus);
        }

        if (snapshot.state === "unavailable") {
          loadedSongIdRef.current = null;
          claimedCastClientIdRef.current = null;
        } else if (snapshot.state === "available") {
          loadedSongIdRef.current = null;
          claimedCastClientIdRef.current = null;
        } else if (snapshot.state === "connected") {
          const prepareCastSession = snapshot.mediaStatus?.songId
            ? claimCastAndAdoptRef.current(snapshot.mediaStatus)
            : claimCastAndLoadRef.current();
          prepareCastSession.catch((error) => {
            console.error("[Cast] Failed to transfer playback:", error);
          });
        }
      };

      const handleNativeAudioEvent = (event: Event) => {
        const detail = nativeAudioEventDetail(event);
        if (!detail) return;

        if (detail.event === NATIVE_CAST_STATE_EVENT) {
          const snapshot = toCastStateSnapshot(detail.data);
          if (snapshot) applyNativeSnapshot(snapshot);
          return;
        }

        if (detail.event === NATIVE_CAST_MEDIA_STATUS_EVENT) {
          const status = toCastMediaStatus(detail.data);
          if (status) handleNativeCastMediaStatusRef.current(status);
        }
      };

      refreshNativeCastSnapshotRef.current = async () => {
        const api = await getNativeCastApi();
        const snapshot = await api.getCastState();
        applyNativeSnapshot(snapshot);
      };

      const handleNativeResume = () => {
        refreshNativeCastSnapshotRef.current().catch((error) => {
          console.warn("[Cast] Failed to refresh native Cast state:", error);
        });
      };

      window.addEventListener(NATIVE_AUDIO_EVENT, handleNativeAudioEvent);
      window.addEventListener(appResumeRepaintEvent, handleNativeResume);
      getNativeCastApi()
        .then((api) => api.getCastState())
        .then(applyNativeSnapshot)
        .catch((error) => {
          console.warn("[Cast] Native Cast unavailable:", error);
          applyNativeSnapshot({ state: "unavailable", deviceName: null });
        });

      return () => {
        disposed = true;
        window.removeEventListener(NATIVE_AUDIO_EVENT, handleNativeAudioEvent);
        window.removeEventListener(appResumeRepaintEvent, handleNativeResume);
        refreshNativeCastSnapshotRef.current = async () => {};
      };
    }

    // Set up the callback before the SDK script loads
    let context: cast.framework.CastContext | null = null;
    let handleCastStateChange:
      | ((event: cast.framework.CastStateEventData) => void)
      | null = null;
    let handleSessionStateChange:
      | ((event: cast.framework.SessionStateEventData) => void)
      | null = null;

    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (!isAvailable) {
        setCastState("unavailable");
        return;
      }

      setCastSdkLoaded(true);

      // Initialize the Cast context with the default media receiver
      context = cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId:
          import.meta.env.VITE_CHROMECAST_RECEIVER_APP_ID ??
          chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });

      // Listen for Cast state changes
      handleCastStateChange = (event) => {
        switch (event.castState) {
          case cast.framework.CastState.NO_DEVICES_AVAILABLE:
            setCastState("unavailable");
            setCastDeviceName(null);
            detachCastMediaListenerRef.current();
            claimedCastClientIdRef.current = null;
            break;
          case cast.framework.CastState.NOT_CONNECTED:
            setCastState("available");
            setCastDeviceName(null);
            detachCastMediaListenerRef.current();
            loadedSongIdRef.current = null;
            claimedCastClientIdRef.current = null;
            break;
          case cast.framework.CastState.CONNECTING:
            setCastState("connecting");
            break;
          case cast.framework.CastState.CONNECTED: {
            setCastState("connected");
            const activeContext = context;
            if (!activeContext) return;
            const session = activeContext.getCurrentSession();
            const device = session?.getCastDevice();
            setCastDeviceName(device?.friendlyName ?? null);

            claimCastAndLoadRef.current().catch((error) => {
              console.error("[Cast] Failed to transfer playback:", error);
            });
            break;
          }
        }
      };

      handleSessionStateChange = (event) => {
        if (
          event.sessionState === cast.framework.SessionState.SESSION_ENDED ||
          event.sessionState === cast.framework.SessionState.NO_SESSION
        ) {
          detachCastMediaListenerRef.current();
          loadedSongIdRef.current = null;
          claimedCastClientIdRef.current = null;
        }
      };

      context.addEventListener(
        cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        handleCastStateChange,
      );

      context.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        handleSessionStateChange,
      );

      // Set initial state
      const currentState = context.getCastState();
      if (currentState === cast.framework.CastState.NO_DEVICES_AVAILABLE) {
        setCastState("unavailable");
      } else {
        setCastState("available");
      }
    };

    // Load the Cast SDK script
    const script = document.createElement("script");
    script.src =
      "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
    script.async = true;
    document.head.appendChild(script);

    return () => {
      window.__onGCastApiAvailable = () => {};
      if (context && handleCastStateChange) {
        context.removeEventListener(
          cast.framework.CastContextEventType.CAST_STATE_CHANGED,
          handleCastStateChange,
        );
      }
      if (context && handleSessionStateChange) {
        context.removeEventListener(
          cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          handleSessionStateChange,
        );
      }
      detachCastMediaListenerRef.current();
    };
  }, [setCastState, setCastDeviceName, setCastSdkLoaded, useNativeCast]);

  useEffect(() => {
    if (!useNativeCast || castState !== "connected") return;

    const refreshStatus = () => {
      getNativeCastApi()
        .then((api) => api.getCastMediaStatus())
        .then((status) => handleNativeCastMediaStatusRef.current(status))
        .catch(() => {});
    };

    refreshStatus();
    const interval = setInterval(refreshStatus, NATIVE_CAST_STATUS_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [castState, useNativeCast]);

  useEffect(() => {
    if (castState !== "connected" || !sessionId || !castClientId) return;

    const prepareCastSession =
      useNativeCast && nativeCastStatusRef.current?.songId
        ? claimCastAndAdoptRef.current(nativeCastStatusRef.current)
        : claimCastAndLoadRef.current();

    prepareCastSession.catch((error) => {
      console.error("[Cast] Failed to prepare cast session:", error);
    });
  }, [castState, sessionId, castClientId, useNativeCast]);

  useEffect(() => {
    if (castState !== "connected" || !sessionId || !castClientId) return;

    const client = getClient();
    if (!client) return;

    const url = client.getSessionEventsUrl(
      sessionId,
      castClientId,
      CAST_CLIENT_NAME,
      castDeviceName ?? undefined,
    );
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data: SessionEvent = JSON.parse(event.data);
        handleCastSessionEventRef.current(data).catch(console.error);
      } catch {
        // Ignore keep-alive and malformed events.
      }
    };

    eventSource.onerror = () => {};

    return () => {
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
    };
  }, [castState, sessionId, castClientId, castDeviceName]);

  useEffect(() => {
    if (castState !== "connected" || !sessionId || !castClientId) return;

    sendCastHeartbeatRef.current().catch(() => {});
    const interval = setInterval(() => {
      sendCastHeartbeatRef.current().catch(() => {});
    }, CAST_HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [castState, sessionId, castClientId]);

  useEffect(() => {
    if (castState !== "connected") return;
    setCastMediaVolume(volume, isMuted).catch((error) => {
      console.error("[Cast] Failed to sync Cast volume:", error);
    });
  }, [castState, volume, isMuted]);

  useEffect(() => {
    if (castState !== "connected" || !currentSong) return;
    if (loadedSongIdRef.current === currentSong.id) return;
    if (isAudioOwnerRef.current) return;
    if (useNativeCast && nativeCastStatusRef.current?.songId) return;

    const startPositionMs = loadedSongIdRef.current ? 0 : undefined;
    loadCurrentCastSongRef.current(startPositionMs).catch(console.error);
  }, [castState, currentSong, useNativeCast]);
}

/**
 * Hook for Cast playback controls.
 */
export function useCast() {
  const useNativeCast = isTauriMobile();
  const castState = useAtomValue(castStateAtom);
  const castDeviceName = useAtomValue(castDeviceNameAtom);
  const isCasting = castState === "connected";
  const isAvailable =
    castState === "available" ||
    castState === "connecting" ||
    castState === "connected";

  const requestCast = () => {
    if (useNativeCast) {
      getNativeCastApi()
        .then((api) => api.requestCastSession())
        .catch((error) => {
          console.error("[Cast] Failed to request native session:", error);
        });
      return;
    }

    try {
      cast.framework.CastContext.getInstance().requestSession();
    } catch (error) {
      console.error("[Cast] Failed to request session:", error);
    }
  };

  const stopCasting = () => {
    if (useNativeCast) {
      getNativeCastApi()
        .then((api) => api.stopCastSession())
        .catch((error) => {
          console.error("[Cast] Failed to stop native session:", error);
        });
      return;
    }

    try {
      const session =
        cast.framework.CastContext.getInstance().getCurrentSession();
      session?.endSession(true);
    } catch (error) {
      console.error("[Cast] Failed to stop session:", error);
    }
  };

  const castCurrentTrack = (song: Song, startTime = 0) => {
    loadMediaOnCast(song, startTime, useNativeCast).catch(console.error);
  };

  return {
    castState,
    castDeviceName,
    isCasting,
    isAvailable,
    requestCast,
    stopCasting,
    castCurrentTrack,
  };
}
