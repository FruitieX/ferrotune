# Native Android Client (Kotlin + Jetpack Compose) — Feasibility & Implementation Plan

> Status: Draft for review · Date: 2026-09-20 · Branch: `native-android-feasibility`
> Related: `TAURI.md` (superseded by this doc), `docs/ANDROID_EMULATOR.md`, `docs/APP_DISTRIBUTION.md`, `docs/TESTING.md`

---

## 1. Verdict

**Feasible, and substantially de-risked by what already exists.** Three findings drive this:

1. **The hard Android work is already native Kotlin.** ~10.5k LOC under
   `client/tauri-plugin-native-audio/android/` implements background playback
   (Media3 `MediaSessionService` + ExoPlayer), autonomous server-queue windows,
   scrobbling/listening/heartbeats, session SSE + ownership/takeover, offline
   downloads (Media3 `DownloadService` + pinned cache), ReplayGain DSP, high-res
   notification artwork, Google Cast, stall recovery, and diagnostics. Only
   `NativeAudioPlugin.kt` (1,280 LOC) and small `JSObject` touchpoints are
   Tauri/WebView-specific. The engine moves essentially wholesale.
2. **The backend was designed for this.** Server-authoritative queue with windows
   and a `version` counter, one playback session per user with many clients,
   `ferrotune-mobile` client type, SSE commands/ownership, mobile download
   manifests, offline playlist membership sync, 30-day sliding bearer tokens,
   server-side filtering/sorting, and ts-rs DTOs. No blocking server work.
3. **The genuinely new work is UI + a data/persistence layer.** The mobile-relevant
   route pages are ~20k LOC (24.9k total minus 4.6k tagger/admin/import/setup/
   files), plus shared components and ~60–80 DTOs. The React/Jotai/TanStack
   orchestration collapses into ViewModels, repositories, Paging 3, Room, and
   DataStore — while the playback/orchestration logic that currently lives in JS
   (`native-engine.ts`, `server-queue.ts`, `track-loader.ts`) is deleted, not ported.

**Effort:** 20–30 engineer-weeks (≈5–7 months full-time, solo, conservative
baseline). With heavy AI assistance and the engine head start, 3–4 months is
plausible. The largest single cost is the player/gesture/queue UI and library
browsing; neither is technically risky.

**Recommendation:** hard cutover (already decided) — build the native app at
`android/`, move the Kotlin engine into it, then delete the Tauri Android path
and all web-client native branches. Tauri remains the desktop shell. No
cross-version continuity is required: the native build is a fresh install after
uninstalling the Tauri app (login state and downloads do not migrate).

---

## 2. Goals and Non-Goals

### Goals
- First-class Android UX: 60/120 Hz animations, native gestures, predictive back,
  edge-to-edge, platform haptics, no WebView scroll/gesture compromises.
- Better performance and battery: no WebView, no JSON-over-JS-bridge per event,
  no duplicate playback state in JS, no Rust/NDK per-ABI packaging.
- Commonly used mobile flows at parity: playback, now playing, library browsing,
  playlist browsing/management, dashboard, notifications, playback service,
  settings, offline downloads, multiple logins with hot swapping, search,
  favorites/history, song radio, Cast, smart playlist editing, period review.
- Simpler architecture: the playback service is the single source of truth for
  queue/playback; no WebView↔service dual-writer ownership races.
- Faster builds and smaller APKs (no cargo cross-compile, no 4 ABI flavors, no
  WebView assets).

### Non-Goals (v1)
- Tag editing, song matching/refine-match, tagger, scanner/library management,
  import, recycle bin, filesystem browser, admin, setup wizard, server config.
- Desktop Tauri app changes (it keeps the web client + embedded server).
- iOS / Kotlin Multiplatform. Core is Android-only; revisit only if iOS is real.
- Feature parity with every web power-user control (e.g. column visibility,
  advanced search filter matrix beyond common filters, home tile granularity may
  start simpler).

---

## 3. Current State

### 3.1 Tauri Android architecture (today)

```
WebView (HTTPS tauri.localhost) → React SPA (client/src)
   │  invoke plugin:native-audio|* (ACL-gated)
   ▼
tauri-plugin-native-audio (Rust: 31 commands, ACL TOMLs)
   ▼
NativeAudioPlugin.kt (39 @Command, event bridge via evaluateJavascript)
   ▼
PlaybackService.kt (ExoPlayer + MediaSessionService + autonomous queue + SSE)
   + FerrotuneDownloadService.kt, NativeCastManager.kt, …
```

- App shell: `client/src-tauri/` (Tauri 2.10, plugin-log, desktop-only embedded
  server; Android Rust is glue only).
- Platform flag: `window.__FERROTUNE_NATIVE_AUDIO__` selects the native engine in
  the SPA (`client/src-tauri/src/lib.rs:3-9,56-61`,
  `client/src/lib/tauri/index.ts:63-86`).
- Events flow Kotlin → `window.dispatchEvent('ferrotune:native-audio-event')`,
  with a background-drop policy and snapshot-on-resume
  (`NativeAudioPlugin.kt:460-499`, `WebViewPlaybackEventPolicy.kt`).
- WebView workarounds in place: mixed-content always-allow, safe-area CSS vars,
  resume repaint, overscroll disable, page-size linker flags for Rust JNI.

### 3.2 Already-native inventory (moves to the new app)

| File (under `client/tauri-plugin-native-audio/android/src/main/kotlin/com/ferrotune/audio/`) | LOC | Role | Tauri coupling |
|---|---|---|---|
| `PlaybackService.kt` | 5,177 | Media3 service: ExoPlayer, queue windows/prefetch, skip/shuffle/repeat, transcoded seek, scrobble/listening/heartbeat, SSE ownership, retries, stall watchdog, notification, audio focus/routes, ReplayGain | Only event emitter (`OwnedCallback<String, JSObject>`) + notification extra |
| `NativeAudioPlugin.kt` | 1,280 | Tauri bridge, 39 commands, service binding, safe-area, intents | Entirely Tauri/WebView |
| `FerrotuneApiClient.kt` | 1,012 | OkHttp REST + SSE, stream/cover/download URLs, auth headers | None |
| `FerrotuneDownloadService.kt` | 509 | Media3 DownloadService + `DownloadManagerHolder` + cache-key factory | `JSObject` payloads only |
| `NativeCastManager.kt` | 503 | Cast session/queue/transport/status | `JSObject` payloads + 1×1 route-button hack |
| `NativeAudioLogger.kt` | 347 | Rotating sanitized JSONL diagnostics | None |
| `ReplayGainAudioProcessor.kt` | 240 | PCM ReplayGain + clipping detection | None |
| `AudioState.kt` | 182 | DTOs/events/download models | `JSObject` serializers |
| 11 pure helper state machines/tests | ~700 | stall monitor, error classifier, SSE generation, ownership guard, listening lifecycle, notification policy, resume logic | None |
| `ArtworkContentProvider.kt`, `CastOptionsProvider.kt` | ~120 | Notification artwork, Cast options | None |
| 12 JVM unit test files | 668 | Unit coverage for pure logic | None |

### 3.3 Backend readiness

| Concern | Endpoint surface | Notes |
|---|---|---|
| Auth | `POST /api/auth/login`, `/logout`, `GET /auth/me`, `POST /auth/refresh` | 30-day sliding bearer (`fts_…`); multiple sessions per user; no refresh-token rotation. 4h `urlToken` flow is **not needed** natively — Bearer headers work for API, stream, cover art, SSE and downloads. |
| Sessions/multi-client | `POST/GET /api/sessions`, `/clients`, `/heartbeat`, `/command` (`takeOver`, play commands), `DELETE /clients/{id}`, `GET /sessions/{id}/events` (SSE) | One session per user, many clients; `ferrotune-mobile` recognized; events: `queueChanged`, `queueUpdated`, `playbackCommand`, `ownerChanged`, `volumeChange`, `clientListChanged`, `diagnosticsRequest`. |
| Queue (source of truth) | `POST /api/queue/start`, `GET /api/queue`, `/current-window`, `add`, `move`, `DELETE /{position}`, `shuffle`, `position`, `repeat`, `DELETE` | Server-side materialization of source descriptors; `version` for invalidation; windows are ideal for lazy UI. |
| Streaming/media | `GET /api/stream` (Range, `format=opus`, `maxBitRate`, `timeOffset`, `seekMode`), `/api/cover-art`, `/api/download`, `/api/transcode-cache/status` | ExoPlayer/Coil use Bearer headers; direct or transcoded. |
| Downloads/offline | `POST /api/downloads/manifest`, `POST /api/sources/song-ids`, `GET /api/songs/ids`, `POST /api/playlists/membership`, `GET /api/playlists/containing-songs` | Built for the current Android download manager. |
| Browse/search/lists | artists/albums/songs/genres/indexes/search + `type`-driven album lists, most-played, forgotten favorites, random, by-genre | All filtering/sorting server-side (`sort`, `sortDir`, `filter`, per-entity sort fields, advanced `SearchParams`). |
| Home/dashboard/stats | `/api/home`, `/continue-listening`, `/discovery/similar-songs`, `/api/stats`, `/api/listening/stats`, `/api/listening/review` | Section include flags already exist. |
| Playlists | folders, playlists, songs (`offset/count/sort/filter`, `entryType`), reorder, move-entry, shares, transfer, recently-played, smart playlists + materialize | Full mobile management surface. |
| Preferences | `GET/PUT /api/preferences`, `/preferences/{key}` | Server-backed UI prefs (accent color, home layout, playback prefs). |
| Playback history | `POST /api/scrobbles`, `POST /api/listening`, `GET /api/history` | Already driven from Kotlin today. |

**DTO state:** 291 generated TS files under `client/src/lib/api/generated/`
(ts-rs). Response structs are exported; many request/query structs are **not**
(`StreamParams`, `SearchParams`-adjacent query structs, queue/session/scrobble
request bodies, list params…). Those must be hand-written or newly exported.

**Known small server gaps (non-blocking):** no endpoint to list/revoke a user's
other auth sessions; `POST /api/auth/refresh` does not rotate the token (only
extends and reports expiry).

### 3.4 Why replace the WebView

- Gestures/scroll/animations are emulated (framer-motion + custom drag math) and
  never quite native; virtualized lists fight the WebView compositor.
- Every playback event crosses the JS bridge and is mirrored in Jotai; the
  service already owns the truth, so UI state is duplicated.
- Two writers on the server session (WebView + service) require ownership
  arbitration, SSE suppression, and resume snapshots.
- WebView workarounds (mixed content, safe-area CSS, resume repaint, overscroll
  disable) are pure tax.
- Build cost: full Rust toolchain + NDK, 4 ABI flavors, 16 KB page-size linker
  flags, cargo inside Gradle. The native Kotlin app has none of this.
- WebView version/GPU variance on Android is an ongoing QA surface.

### 3.5 Scale numbers

| Component | Size |
|---|---|
| Web client `client/src` (TS/TSX/CSS) | ~108k LOC incl. 291 generated DTO files |
| Mobile-relevant route pages | ~20.2k LOC (24.9k minus 4.6k out-of-scope admin/tagger/import/setup/files) |
| Shared components in scope | ~15–20k LOC of `client/src/components` (excluding tagger/admin) |
| Playback orchestration to delete (not port) | `lib/audio/*` native paths + `lib/store/server-queue.ts` native branches + offline JS materializer |
| Kotlin engine to move | ~10.5k LOC main + 668 LOC tests |

---

## 4. v1 Scope

### Included
- **Auth/accounts:** login (server URL + credentials), saved accounts, multiple
  logins, hot swapping, logout, session refresh, connected-devices view.
- **Playback:** play/shuffle album/artist/genre/playlist/smart playlist/song
  radio/favorites/history/search results, queue start, background playback,
  media notification, lock screen/Bluetooth/headset controls, audio focus,
  ReplayGain, transcoding setting, gapless-ish prefetch behavior as today,
  scrobbling/listening/heartbeats, session ownership/takeover across devices.
- **Now playing:** mini player, fullscreen player with gestures (swipe up,
  horizontal skip, drag dismiss), seek/progress (simple + waveform styles),
  star/rating, queue sheet with reorder/remove, Cast button.
- **Library browsing:** albums, artists, songs, genres, favorites (starred),
  history, home sections, continue listening, random/forgotten lists.
- **Search:** artists/albums/songs with common filters (year, genre, duration,
  rating, starred) + search history; advanced-filter matrix may be trimmed.
- **Playlists:** folders, list, detail, create/rename/delete, add/remove songs,
  reorder, move to folder, shares (view/manage), transfer ownership, recent
  playlists, smart playlists incl. rule editing and materialize.
- **Dashboard/profile:** home tiles/sections, listening stats, period review,
  song radio page.
- **Settings:** playback (ReplayGain mode/offset, transcoding on/off + bitrate,
  scrobble threshold), downloads (format, bitrate, Wi-Fi only), appearance/accent
  color, library view preferences, account management.
- **Offline:** download enqueue/remove/pause/resume/remove-all, downloads list,
  downloaded-songs library, offline queue materialization and playback, offline
  playlist membership, offline detection.
- **Mobile integration:** runtime notification permission, deep link from
  notification to now playing, haptics, predictive back, edge-to-edge.

### Excluded
- Tagger, song/album/artist matching, import, recycle bin, directory/fs browser,
  scan management, server config/setup, user administration, library folder
  management, duplicate reports, Last.fm config UI, playlist entry
  match/refine tools, smart-playlist materialize→playlist management beyond a
  single action, waveform prefetch tuning, Cast queue editing beyond transport.

---

## 5. Target Architecture

### 5.1 Repository layout (hard cutover)

```
ferrotune/
├── src/                     # Rust backend (unchanged)
├── client/                  # Vite/React web client + desktop Tauri shell only
│   └── src-tauri/           # desktop only after cutover
├── android/                 # NEW: single Gradle project, Kotlin/Compose
│   ├── app/                 # Activity, nav graph, DI wiring, deep links
│   ├── core/{common,model,network,database,datastore,designsystem,media}/
│   ├── feature/{auth,home,library,playlists,player,downloads,settings,profile}/
│   ├── gradle/libs.versions.toml
│   ├── moon.yml             # android:* tasks
│   └── scripts/
├── migrations/, tests/, docs/ (unchanged)
```

- Gradle project is committed (no Tauri-style generated `gen/android`).
- New moon project `android` (or root tasks named `android:*`), replacing
  `client:tauri-android-*`.
- Application identity: `applicationId com.ferrotune.music`, clean versioning
  starting at `versionCode 1` / `versionName 0.1.0`. Fresh install only: the
  Tauri Android app is uninstalled first (decided).

### 5.2 App modules

| Module | Contents |
|---|---|
| `:app` | `MainActivity` (edge-to-edge), Compose nav graph, deep links, Hilt root, app startup |
| `:core:common` | Dispatchers, `Result`/error model, logging (`NativeAudioLogger`), haptics, connectivity |
| `:core:model` | Domain models: songs/albums/artists/playlists/queue/player state, `PlaybackEvent` sealed class |
| `:core:network` | OkHttp + Retrofit + kotlinx.serialization, `SessionStore`, auth interceptor, SSE session client, generated + hand-written DTOs |
| `:core:database` | Room: downloaded songs/containers, offline metadata, playlist membership, download queue mirrors |
| `:core:datastore` | Preferences DataStore, saved accounts, Keystore-wrapped tokens, playback/download/UI prefs |
| `:core:designsystem` | Material 3 theme, accent color derivation, shared components (media cards, menus, rows, progress bars, sheets) |
| `:core:media` | Moved engine: `PlaybackService`, `FerrotuneApiClient`, `FerrotuneDownloadService` + `DownloadManagerHolder`, `ReplayGainAudioProcessor`, `ArtworkContentProvider`, `CastOptionsProvider`, `NativeCastManager`, helpers |
| `:feature:auth` | Login, saved accounts, account switcher, hot-swap orchestration |
| `:feature:home` | Dashboard tiles/sections, home section detail, stats, period review |
| `:feature:library` | Albums/artists/songs/genres + details, favorites, history, search, song radio |
| `:feature:playlists` | Folders, list, detail, editing, sharing, smart playlists + rule editor |
| `:feature:player` | Mini player, fullscreen player, gestures, queue sheet, Cast UI |
| `:feature:downloads` | Downloads management, downloaded library, offline mode UX |
| `:feature:settings` | Playback/download/appearance/library prefs, account/server settings |

Module count can start smaller (`:feature:browse` merging library+playlists+home)
and split later; the `:core:*` + `:core:media` boundaries are the ones worth
enforcing early.

### 5.3 Technology choices

| Concern | Choice | Rationale |
|---|---|---|
| UI | Jetpack Compose + Material 3, Navigation Compose (type-safe routes) | Native gestures/animations; already Kotlin |
| Lists | `LazyColumn`/`LazyVerticalGrid` + Paging 3 (`PagingSource` per endpoint) | Matches server pagination (`offset/count/size/limit`), virtualization requirement |
| Images | Coil 3 with the authenticated OkHttp client + disk cache | Cover art needs Bearer header; album-art-heavy UI |
| HTTP | OkHttp 4.12 (already) + Retrofit + kotlinx.serialization | Typed API layer; SSE stays `okhttp-sse` |
| Persistence | Room (KSP) + Preferences DataStore + Keystore-encrypted token storage | Offline metadata, accounts, prefs |
| Playback | Media3 1.9.x (already) with custom `ReplayGainAudioProcessor` and pinned `SimpleCache` | Existing engine |
| DI | Hilt (KSP) | Standard, testable; alternatives (Koin) acceptable |
| Cast | `play-services-cast-framework` + `androidx.mediarouter` (already), `MediaRouteButton` in Compose | Existing manager |
| Build | AGP 8.11+, Kotlin 2.2.x, KSP2, JDK 17, version catalog, `minSdk 24`, `targetSdk/compileSdk 36` | Continuity with current minSdk; modern tooling |
| Quality | ktlint + detekt + Android Lint; baseline profile (optional) | CI parity with `moon run pre-ci` |

### 5.4 State and data flow

- **Server is authoritative** for library, queue, playlist and session state.
  Repositories wrap `core:network` + Room caches; ViewModels expose
  `StateFlow<UiState>`; one-shot navigation/error events via `Channel`.
- **`:core:media` owns playback truth.** `PlaybackRepository` binds
  `PlaybackService` in-process (keep the existing custom `LocalBinder` pattern;
  UI and service share one process) and exposes:
  - `StateFlow<PlaybackStateSnapshot>` (status, position, duration, buffer,
    track, queue index/length, volume, repeat, shuffle, starred),
  - `SharedFlow<PlaybackEvent>` (track-change, error, scrobble, clipping,
    queue-state-changed, download-state-changed),
  - suspend command methods (play/pause/seek/next/previous/playAtIndex/
    setRepeat/toggleShuffle/setVolume/setReplayGain/updateStarredState/
    startPlayback/startOfflinePlayback/invalidateQueue/updateSettings).
  Media3 `MediaSession` remains for system/external controls (lock screen,
  Bluetooth, Wear, Cast).
- **Do not port the Jotai atom graph 1:1.** Feature ViewModels + repositories;
  server-backed preferences via a `PreferencesRepository` that debounces and
  PUTs `/api/preferences` (mirroring `atomWithServerStorage` semantics).
- **SSE:** a single `SessionSseClient` in `:core:network` (moved, generation
  guard retained) feeds a `SessionRepository` used by both UI (ownership,
  connected clients) and service.

### 5.5 API client and Kotlin DTOs

- `core:network` defines `FerrotuneApi` (Retrofit) for the UI-facing endpoints.
  The engine's `FerrotuneApiClient` (OkHttp/org.json) is kept initially for its
  proven queue/SSE/scrobble paths and shares `SessionStore` + auth interceptor;
  a follow-up milestone can fold it into `FerrotuneApi`.
- **Codegen pipeline:** extend the Rust side with `#[derive(TS)]` exports for the
  mobile request/query structs that are currently missing, then add
  `android/scripts/generate-kotlin-bindings.sh` converting
  `client/src/lib/api/generated/*.ts` → Kotlin `@Serializable` data classes
  (deterministic mapping, `number` reviewed per field → `Long`/`Int`/`Double`,
  since TS loses i64 precision hints). Add fixture round-trip tests against real
  responses and a CI drift check (`moon run android:generate-bindings` vs git).
  Fallback if the converter proves brittle: generate the ~60–80 needed response
  types with a one-off tool and hand-maintain.
- JSON config: `ignoreUnknownKeys = true`, `explicitNulls = false` for forward
  compatibility; camelCase as the wire shape (`c` client-label query param kept
  as today).

### 5.6 Auth, accounts and hot swapping

- `AccountStore` (DataStore + Keystore) keeps
  `{id, label, serverUrl, username, userId, token, expiresAt}` per saved account
  and the active account id. Token is the `fts_…` bearer; URL tokens are unused.
- Login: `POST /api/auth/login` with `clientName: "ferrotune-mobile"`; store
  token + expiry; connect playback session (`POST /api/sessions`) and SSE.
- Renewal: use until 401; then attempt `/api/auth/refresh` (sliding extension
  happens server-side on use) and fall back to re-login. Server does not rotate
  tokens, so no refresh-token machinery is needed.
- Hot swap sequence: `PlaybackService.resetSession()` → unpin/detach account
  caches → swap active account → recreate account-scoped Room DB
  (`ferrotune-<userId>.db`) / DataStore namespace → clear Coil caches →
  re-apply session/config/settings → reconnect SSE → refresh current screen.
  Playback stops on switch (matching current behavior).
- Multiple concurrent logins are explicitly supported server-side (a new auth
  session per login). Connected-devices UI uses
  `GET /api/sessions/clients` + `DELETE .../clients/{id}`; listing/revoking other
  auth sessions needs a small future server addition if wanted.

### 5.7 Playback engine integration

- Move files as listed in §6.1. Replace the emitter with typed flows:
  `PlaybackService` no longer serializes to `JSObject`; `DownloadManagerHolder`
  emits `DownloadEvent`.
- `startPlayback` flow stays: UI/repository calls `POST /api/queue/start`
  (source descriptor, `startIndex`, `shuffle`, `repeatMode`, `filters`, `sort`,
  `songIds`/`sources`) → service loads the window and prefetches. The Kotlin
  engine already performs all queue mutation round-trips and SSE resync.
- Notification tap: set `sessionActivity` PendingIntent to `MainActivity` with
  `EXTRA_OPEN_NOW_PLAYING`; Compose nav graph deep-links to the player route.
  The WebView flag/event plumbing is deleted.
- Remove `WebViewPlaybackEventPolicy` (no WebView). Keep `OwnershipClaimGuard`,
  `SseConnectionGeneration`, `PlaybackStallMonitor`, `PlaybackResumeLogic`,
  `NativeListeningSessionLifecycle`, `PlaybackNotificationLifecycle`.
- Settings pushed on change from `PreferencesRepository`; repository must
  re-apply cached session + settings whenever the service (re)binds or the
  account switches (the plugin does this today at `NativeAudioPlugin.kt:200-238`).
- Diagnostics: keep `NativeAudioLogger` and the SSE `diagnosticsRequest` upload;
  update `scripts/pull-android-diagnostics.sh` paths if the package changes
  (it should not).

### 5.8 Offline and downloads

- Move `FerrotuneDownloadService` + `DownloadManagerHolder` unchanged
  (content-addressed cache keys `audio:<songId>` / `cover:<id>`; pinned
  `exo-download-cache`; `NoOpCacheEvictor`).
- **Port `client/src/lib/offline/queue-materializer.ts` (240 LOC) to Kotlin**
  in `:core:media`/`:feature:downloads`: build server-shaped queue windows for
  album/artist/playlist sources from Room download metadata, then call
  `startOfflinePlayback`.
- Room schema: `downloaded_song` (metadata incl. durations/ReplayGain from
  `/api/downloads/manifest`), `downloaded_container` (album/artist/playlist
  download groups), `playlist_membership` (from `POST /api/playlists/membership`),
  plus per-account DB isolation.
- Offline detection: `ConnectivityManager` callbacks + light `/api/ping` probes;
  offline banner, disable non-offline actions, serve downloaded artwork.
- No upgrade continuity by decision: uninstalling the Tauri app removes its app
  data. The native build starts clean — fresh login and re-download.

### 5.9 Theming and UI system

- Port accent-color derivation from `client/src/lib/store/ui.ts`
  (hue/lightness/chroma) to a Compose `ColorScheme` generator; keep light/dark
  and server-backed accent prefs.
- Material 3 components replace shadcn/ui; do not chase pixel parity — aim for
  visual consistency (typography scale, spacing, corner radii).
- Reusable components to build once in `:core:designsystem`: media card/row with
  context menu, bulk-selection bar, details dialog (song/album/artist), action
  bar, progress bars (simple + waveform), bottom sheet scaffold, empty/error
  states, offline/download status icon.

### 5.10 Android integration details

| Concern | Plan |
|---|---|
| Permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `FOREGROUND_SERVICE_DATA_SYNC`, `WAKE_LOCK`, `VIBRATE`, `POST_NOTIFICATIONS`; **request `POST_NOTIFICATIONS` at runtime** (currently never requested) |
| Cleartext HTTP | Self-hosted servers may be plain HTTP; add a network security config permitting cleartext for user-entered hosts (the WebView previously force-enabled mixed content) |
| Deep links | Notification tap → `MainActivity` extra → player route; keep `<intent-filter>` minimal |
| Process death | Persist nav/UI state in `SavedStateHandle`; playback continues in the service; UI re-binds and re-syncs on return |
| Predictive back | `enableOnBackInvokedCallback`; `BackHandler` for player/queue/sheet dismissal |
| Haptics | `HapticFeedback`/`Vibrator` replacements for `lib/utils/haptic.ts` patterns |
| Edge-to-edge | `enableEdgeToEdge()` + WindowInsets; safe-area CSS vars deleted |
| Battery | Optional "ignore battery optimizations" prompt after first background playback issue; document per-OEM killers |
| Release | Same keystore, `versionCode` > 2000, update `docs/APP_DISTRIBUTION.md`; Obtainium unchanged |

---

## 6. Engine Migration

### 6.1 File mapping

| Source (`client/tauri-plugin-native-audio/`) | Destination (`android/`) | Edits |
|---|---|---|
| `android/.../PlaybackService.kt` | `core/media/.../PlaybackService.kt` | Typed emitter; drop notification-flag helper usage for a nav deep link |
| `android/.../FerrotuneApiClient.kt` | `core/network/.../FerrotuneApiClient.kt` | None initially; later merge into `FerrotuneApi` |
| `android/.../FerrotuneDownloadService.kt` | `core/media/.../download/` | `JSObject` → data classes |
| `android/.../ReplayGainAudioProcessor.kt` | `core/media/.../` | None |
| `android/.../NativeCastManager.kt` | `core/media/.../cast/` | `StateFlow` API; drop hidden route-button hack |
| `android/.../NativeAudioLogger.kt` | `core/common/.../` | None |
| `android/.../AudioState.kt` | `core/model/.../` | Remove `JSObject` serializers; keep status enums |
| 11 helper files | `core/media/.../` | None |
| `android/.../ArtworkContentProvider.kt`, `CastOptionsProvider.kt` | `app/` + manifest | Rename package, keep authority |
| `android/src/test/**` (12 files) | matching module test dirs | Package rename |
| `android/src/main/AndroidManifest.xml` entries | new app manifest | Permissions/services merged |
| `generate-fixtures`/CI signing scripts | `android/` equivalents | New Gradle-based build/sign |
| `NativeAudioPlugin.kt`, `guest-js`, Rust `src/**`, permissions TOMLs | **Deleted** | Replaced by repository/service binding |

### 6.2 Decoupling edits (the only real engine work)

1. Replace `OwnedCallback<String, JSObject>` emitter in `PlaybackService` with
   `MutableStateFlow<PlaybackStateSnapshot>` + `MutableSharedFlow<PlaybackEvent>`;
   update all `emit*` call sites (`PlaybackService.kt:4661-4753`, star/repeat at
   `:932,2677`, scrobble `:2969`).
2. Replace `DownloadManagerHolder` event payloads with `SharedFlow<DownloadEvent>`.
3. Replace `NativeAudioPlugin`'s service binding with `PlaybackRepository`
   (`bindService` + listener flow); delete `awaitService` polling and cached
   session re-apply in favor of repository lifecycle.
4. Notification tap: drop `PlaybackNotificationIntent` WebView event; use
   PendingIntent extras + nav deep link.
5. Delete `WebViewPlaybackEventPolicy`; keep snapshot-on-resume as a repository
   concern if needed for UI lifecycle.
6. Fix while moving: star toggle reports the previous value
   (`PlaybackService.kt:928-935`); request `POST_NOTIFICATIONS`; remove dead
   event constants.

### 6.3 What gets deleted (web/tauri side)

- `client/tauri-plugin-native-audio/**` entirely (after the move).
- `client/src-tauri`: plugin dependency + `tauri_plugin_native_audio::init()`,
  `append_invoke_initialization_script` Android flag, `tauri.android-*.conf.json`,
  Android icons (move to `android/app`), capabilities `mobile.json` and Android
  platform entries.
- `client/src` native branches: `lib/audio/native-engine.ts`,
  `native-callbacks.ts`, `use-native-session-init.ts`, `engine-state.ts`,
  `isTauriMobile`/`hasNativeAudio`, `__FERROTUNE_NATIVE_AUDIO__` typings,
  downloads UI/manager/offline JS (`lib/offline/*`, download menus, downloads
  settings card), `use-cast.ts` native branches, safe-area/repaint helpers,
  `native-open-now-playing` hook, plugin guest-js dependency, native-only
  branches in stores and components. **Playback orchestration JS that the engine
  supersedes is deleted, not ported.**
- `client/moon.yml` `tauri-android-*` tasks; `scripts/sync-android-icons.sh`,
  `clean-android-daemons.sh` (replace as needed); Playwright
  `client/e2e/android-emulator.spec.ts` (1,229 LOC) and the `test-android-emulator`
  task.
- `flake.nix` android shell: drop Rust Android targets + NDK + 16 KB linker
  concern; keep Android SDK + JDK 17 (SDK still needed for Gradle builds).
- CI `android-app` job → Gradle assemble + unit tests + sign/upload.
- Docs: rewrite `TAURI.md`, `docs/ANDROID_EMULATOR.md`, `docs/TESTING.md`
  sections; update `docs/APP_DISTRIBUTION.md`.

---

## 7. Feature Implementation Map

Complexity: S ≈ days, M ≈ 1–2 weeks, L ≈ 2–4 weeks, XL ≈ 4+ weeks.

### Auth / accounts
| Work | Endpoints | Reuse | New | Cx |
|---|---|---|---|---|
| Login screen (server URL, credentials, saved accounts) | `POST /auth/login`, `GET /ping`, `GET /setup/status` | Auth model | ViewModel, AccountStore, Keystore, validation | M |
| Account switcher + user menu | `GET /users/me`, `GET /sessions/clients`, `POST /sessions/{id}/command takeOver`, `DELETE .../clients/{id}`, `POST /auth/logout` | SSE/ownership | Hot-swap orchestration, per-account DB swap | L |
| Session renewal/401 handling | `POST /auth/refresh` | Sliding token | Interceptor + re-login UX | S |

### Playback engine + player
| Work | Endpoints | Reuse | New | Cx |
|---|---|---|---|---|
| Move service + repository | — | ~90% of `PlaybackService` | Typed flows, binding, settings re-apply | M |
| Playback start from any source | `POST /queue/start`, `/queue/current-window` | Engine queue autonomy | Source descriptor builders | M |
| Mini player | — | — | Compose + swipe up/horizontal skip | L |
| Fullscreen player | — | waveform API | Gestures, drag-dismiss, seek, star/rating, transitions | XL |
| Queue sheet | `GET /queue`, add/move/remove/repeat/shuffle | Engine mutations | Reorder/remove UI | L |
| Notification/lock screen/Bluetooth | — | Media3 + engine | Runtime notification permission, deep link | S–M |
| Multi-device session controls | `/sessions/*`, SSE | Engine SSE | Connected-device UI | M |

### Library / search / discovery
| Work | Endpoints | Reuse | New | Cx |
|---|---|---|---|---|
| Albums/artists/songs/genres lists + detail | browse + list endpoints | Server sorting/filtering | Paging 3 sources, grids, sort/filter UI | L |
| Favorites/history | `/starred`, `/star`, `/rating`, `/history` | — | Tabs/lists, bulk star | M |
| Search | `/search` (common filters) | `SearchParams` | Debounced search, tabs, history | M |
| Song radio | `/discovery/similar-songs` + queue start | seed/source fields | Page + queue action | S |
| Home dashboard + sections | `/home`, `/continue-listening`, album lists, `/stats` | Section flags | Tiles/section config port, offline fallback | L |
| Profile/stats/period review | `/listening/stats`, `/listening/review` | — | Charts/lists | M |

### Playlists
| Work | Endpoints | Reuse | New | Cx |
|---|---|---|---|---|
| Folders + playlist list | `/playlist-folders`, `/recently-played` | — | Tree UI, create/move dialogs | M |
| Playlist detail + editing | `/playlists/{id}`, `/songs`, reorder, add/remove, move-entry | Server CRUD | Reorder interactions, missing entries | L |
| Sharing / transfer | `/shares`, `/transfer-ownership` | — | Manage dialogs | M |
| Smart playlists + rule editor | `/smart-playlists*`, `/songs`, `/materialize` | Rules server-evaluated | Rule builder UI | L |
| Offline membership sync | `/playlists/membership`, `/containing-songs` | — | Room + Kotlin sync job | M |

### Downloads / offline
| Work | Endpoints | Reuse | New | Cx |
|---|---|---|---|---|
| Move download service | — | 100% | Manifest/DI wiring | S |
| Offline queue materializer | `/downloads/manifest`, `/sources/song-ids` | JS logic to port (240 LOC) | Kotlin materializer + tests | M |
| Downloads UI (song/album/playlist) | download commands | Engine events | Lists, progress, wifi-only, remove | M |
| Offline library + mode | `/ping`, Room | — | Connectivity monitor, offline states | M |

### Settings / appearance / Cast
| Work | Endpoints | Reuse | New | Cx |
|---|---|---|---|---|
| Playback settings | `/preferences` | Engine `updateSettings` | Screens + push to service | M |
| Appearance/accent/home layout | `/preferences` | Port accent derivation | Compose ColorScheme, preference sync | M |
| Downloads settings | local | — | DataStore + manager | S |
| Cast UI | — | `NativeCastManager` | `MediaRouteButton`, status sheet | M |

---

## 8. Milestones

| # | Milestone | Deliverables | Exit criteria | Est. |
|---|---|---|---|---|
| M0 | Foundation | `android/` Gradle project + modules, theme, nav shell, Hilt, Retrofit/kotlinx, `AccountStore`, login + saved accounts, moon tasks, trimmed nix shell, CI build job | APK installs on emulator; logs into a real server; token persists; account switch resets state | 2–3 wk |
| M1 | Engine move | `core:media` populated; typed flows; repository binding; notification + runtime permission; deep link; minimal now-playing UI; settings push; SSE/session; scrobbling | Background playback from a debug list; notification/lock-screen controls; scrobble + heartbeat visible in DB; moved JVM tests green | 2–3 wk |
| M2 | Browse & search | Library lists/details, Paging 3, sort/filter, favorites/history, search, song radio | Browse + search usable end-to-end, virtualized, server-side sorting | 3 wk |
| M3 | Playlists & dashboard | Playlists/folders/detail/edit/shares/smart + home/stats/review | Create/edit/reorder/share playlist; home sections render; offline membership sync | 3 wk |
| M4 | Player polish | Fullscreen player, gestures, queue sheet, transitions, haptics, progress styles | Gesture checklist passes on device; queue edits reflected via SSE | 2–3 wk |
| M5 | Offline & downloads | Download service move, materializer, Room, downloads UI/library, offline mode | Airplane-mode playback of a downloaded album/playlist; download management UI | 2 wk |
| M6 | Settings, Cast, cutover | Settings screens, Cast UI, process death/error hardening, a11y, delete Tauri Android path + web native branches, CI/signing/docs | `moon run pre-ci` green; release APK upgrades the Tauri install; Tauri Android code gone | 3 wk |

Total ≈ 17–19 focused weeks optimistic; **20–30 engineer-weeks** with hardening
and rework. Milestones M1/M4 are the highest-value proof points early.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| UI breadth/scope creep (biggest cost) | High | Milestone feature freeze; shared components first; defer advanced filter matrix/column prefs; track parity checklist per screen |
| Gesture/animation fidelity expectations | Medium | Prototype fullscreen player early (M1 spike); Compose anchored draggable/`SwipeToDismiss`, shared element transitions |
| Offline parity regressions | Medium | Port materializer with unit tests against JS behavior; keep cache keys; dedicated airplane-mode test pass |
| DTO drift / codegen brittleness | Medium | Extend ts-rs exports, converter + fixture round-trip tests, CI drift check; hand-written layer is only request/query params |
| Loss of 1,229-LOC Playwright Android suite | Medium | Replace with Compose UI tests + Hurl-seeded emulator integration + ADB smoke; do not port WebView selectors |
| Two API stacks during transition (`FerrotuneApiClient` vs Retrofit) | Low–Med | Single `SessionStore`/interceptor; fold client in a follow-up milestone |
| Release continuity (upgrade in place) | Low | Same `applicationId`, keystore, higher `versionCode`; test upgrade from Tauri build |
| Cleartext self-hosted servers blocked | Low | Network security config allowing user-entered cleartext hosts |
| Process death / OEM battery killers | Low–Med | Media3 service handles playback; UI state restoration; optional battery prompt + docs |
| Multi-account cache bleed | Low–Med | Account-scoped Room/DataStore + clear Coil caches on swap; tests for swap sequences |
| Web client divergence after removing native branches | Low | Desktop-only web client is intentional; keep Playwright/Hurl suites for web+backend |

---

## 10. Testing & CI

- **Unit (JVM):** move the 12 existing engine tests; add repository tests
  (MockWebServer), queue materializer, account switching, preference sync,
  accent-color derivation.
- **Compose UI tests:** login, library list + sort, playlist edit, player
  controls, downloads states; `createAndroidComposeRule`.
- **Instrumented integration:** run against a Hurl-fixture backend reachable at
  `10.0.2.2:4040` on the emulator; reuse `tests/fixtures`.
- **Contract tests:** DTO deserialization fixtures recorded from real responses;
  CI check that generated Kotlin matches TS output.
- **Smoke:** ADB script (`moon run android:smoke`) launching the app, logging in,
  playing, asserting logcat/UI; replaces the Playwright Android spec.
- **CI jobs:** `android:lint` + `android:test-unit` + `android:assemble-debug`
  on push; release assembly + keystore signing + artifact upload on `main`
  (mirrors current `android-app` job); optional nightly connected tests.
- **Moon/nix:** new `android/moon.yml` tasks (`build`, `build-debug`, `test`,
  `lint`, `deploy`, `smoke`, `generate-bindings`); trimmed android dev shell
  (SDK + JDK 17, no NDK/Rust targets); update AGENTS.md task references.

---

## 11. Alternatives Considered

| Alternative | Verdict |
|---|---|
| Keep Tauri WebView, optimize gestures/rendering further | Rejected: ceiling reached; WebView/bridge costs remain |
| Native shell + WebView for library, native player only | Rejected: two state systems, still web UX for main flows |
| Flutter / React Native | Rejected: discards ~10.5k LOC of proven Kotlin and Media3 integration; ecosystem mismatch for the self-hosted API |
| Full Kotlin Multiplatform core for future iOS | Deferred: Media3/OkHttp/Room core cannot be shared anyway; revisit if iOS becomes real |
| Incremental parallel apps (Tauri + native) | Rejected by decision: hard cutover, move engine outright |

---

## 12. Decisions Log and Open Questions

### Decided (from review)
- Hard cutover: native app replaces Tauri Android; Tauri stays desktop-only.
- Move the Kotlin engine outright into the new app; delete the plugin.
- Android-only for v1; no KMP groundwork.
- v1 includes offline downloads, search + favorites/history, song radio, Cast,
  smart playlist editing, and the period review page.
- No continuity between the Tauri Android app and the native app: the old app is
  uninstalled first; no token/download migration.

### Open (recommendations in parentheses)
1. Repo location for the Gradle project (`android/` at top level — recommended)
   vs `client/android/`.
2. `minSdk 24` continuity (recommended) vs raising to 26+ for Media3/Compose
   niceties.
3. Retrofit + kotlinx.serialization for the UI API layer (recommended) vs
   extending the existing OkHttp `FerrotuneApiClient` for everything.
4. Hilt (recommended) vs Koin vs manual DI.
5. DTO generation: custom TS→Kotlin converter (recommended) vs quicktype vs
   hand-writing the ~60–80 needed types.
6. Smart playlist rule editor depth in v1: full rule builder (user selected
   editing; confirm condition/operator coverage) vs subset of common fields.
7. Whether to add server endpoints for listing/revoking other auth sessions in
   v1 or later (later recommended; connected *playback* clients already
   manageable).
8. Waveform progress style in v1 or defer (current app supports it; lower
   priority than other player polish).

---

## Appendix A — Mobile Endpoint Map (quick reference)

- **Auth:** `POST /api/auth/login|logout|refresh`, `GET /api/auth/me`,
  `GET /api/ping`, `GET /api/setup/status`.
- **Sessions/SSE:** `POST|GET /api/sessions`, `GET /api/sessions/clients`,
  `POST /api/sessions/{id}/heartbeat|command`,
  `GET /api/sessions/{id}/events`,
  `DELETE|POST /api/sessions/{id}/clients/{clientId}`,
  `POST /api/sessions/{id}/diagnostics[/{requestId}]`.
- **Queue:** `POST /api/queue/start`, `GET /api/queue`,
  `GET /api/queue/current-window`, `POST /api/queue/add|move|shuffle|position|repeat`,
  `DELETE /api/queue/{position}`, `DELETE /api/queue`.
- **Media:** `GET /api/stream`, `/api/download`, `/api/cover-art`,
  `/api/transcode-cache/status`, `/api/songs/{id}/waveform`.
- **Offline:** `POST /api/downloads/manifest`, `/api/sources/song-ids`,
  `GET /api/songs/ids`, `POST /api/playlists/membership`,
  `GET /api/playlists/containing-songs`.
- **Browse/lists:** `/api/artists[...]`, `/api/albums[...]`, `/api/songs/[...]`,
  `/api/genres`, `/api/indexes`, `/api/albums?type=…`, `/api/songs/random`,
  `/api/songs/by-genre`, `/api/songs/most-played-recently`,
  `/api/songs/forgotten-favorites`.
- **Search:** `/api/search` (per-entity counts/sorts/filters).
- **Home/stats:** `/api/home`, `/api/continue-listening`,
  `/api/discovery/similar-songs`, `/api/stats`, `/api/listening/stats`,
  `/api/listening/review`, `/api/history`.
- **Starring/rating:** `/api/star`, `/api/unstar`, `/api/rating`, `/api/starred`.
- **Playlists:** `/api/playlist-folders[...]`, `/api/playlists[...]`,
  `/api/playlists/{id}/songs|reorder|move|shares|transfer-ownership`,
  `/api/playlists/recently-played`, `/api/smart-playlists[...]`.
- **Preferences/users:** `/api/preferences[/{key}]`, `/api/users/me`,
  `/api/users/shareable`.
- **Scrobbles/listening:** `POST /api/scrobbles`, `POST /api/listening`.

## Appendix B — Engine Inventory (mobile-relevant only)

`PlaybackService.kt` (queue autonomy, SSE, scrobble, notification, audio focus,
retry/stall) · `FerrotuneApiClient.kt` · `FerrotuneDownloadService.kt` +
`DownloadManagerHolder` · `NativeCastManager.kt` · `NativeAudioLogger.kt` ·
`ReplayGainAudioProcessor.kt` · `AudioState.kt` · `ArtworkContentProvider.kt` ·
helpers (`PlaybackStallMonitor`, `PlaybackErrorClassifier`,
`NativeListeningSessionLifecycle`, `PlaybackResumeLogic`,
`PlaybackNotificationLifecycle`, `PlaybackNotificationIntent`,
`QueuePlaybackIntent`, `OwnershipClaimGuard`, `OwnedCallback`,
`SseConnectionGeneration`, `WebViewPlaybackEventPolicy`→delete) · 12 JVM tests.
