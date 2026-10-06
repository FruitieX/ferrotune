# AI Agent Instructions for Ferrotune

## Project Overview

**Ferrotune** is a self-hosted music server written in Rust with a Vite/React web client. It enables users to stream and curate their personal music libraries through Ferrotune's native web and mobile clients.

### Technology Stack
| Component | Technology |
|-----------|------------|
| Backend | Rust, Axum, SQLite (sqlx), Tokio |
| Frontend | Vite, React, React Router, TailwindCSS, Jotai |
| Testing | Hurl (backend), Playwright (frontend) |
| Task Runner | Moon |

### Architecture
- **Native API** (`/api` port 4040) - JSON API used by the web and mobile clients
- **Web Client** (`client/`) - Vite/React web interface

---

## Project Structure

```
ferrotune/
├── src/                      # Rust backend
│   ├── main.rs               # CLI entry point
│   ├── api/                  # Native API routes, auth extractors, and shared API helpers
│   └── db/                   # Database queries
├── client/                   # Vite/React frontend
│   ├── src/app/              # App router pages
│   ├── src/components/       # React components
│   ├── src/lib/              # Utilities, API client, store
│   └── e2e/                  # Playwright tests
├── migrations/               # SQLite migrations
├── tests/                    # Backend integration tests
│   ├── hurl/                 # Hurl HTTP test scripts
│   └── fixtures/             # Test audio files
└── docs/                     # Extended documentation
    └── TESTING.md            # Comprehensive testing guide
```

---

## Development Commands

All tasks are managed via [Moon](https://moonrepo.dev/). Run tasks with `moon run <task>` or `moon run <project>:<task>`.

### Building

```bash
moon run build              # Debug build (Rust backend)
moon run build-release      # Release build (Rust backend)
moon run build-release-ui   # Release build with embedded web UI
moon run client:build       # Build Vite client
```

### Running Servers

```bash
moon run dev                # Run backend dev server
moon run client:dev         # Run frontend dev server (with HMR)
moon run serve              # Run backend (after build)
moon run client:start       # Run frontend production build
```

### Testing

```bash
# Full test suites
moon run test               # Backend unit + integration tests
moon run client:test        # Frontend E2E tests (Playwright)
moon run ci                 # Full backend CI pipeline
moon run ci-all-lite        # Full stack CI (backend + client, without E2E)
moon run ci-all             # Full stack CI (backend + client, with E2E)

# Backend tests
moon run test-unit          # Unit tests only
moon run test-integration   # Integration tests (Hurl)
moon run test-integration-full  # Integration tests including ignored

# Individual Hurl test scripts
moon run hurl-system        # System endpoints
moon run hurl-auth          # Authentication endpoints
moon run hurl-browse        # Browse endpoints
moon run hurl-streaming     # Streaming endpoints
moon run hurl-search        # Search endpoints
moon run hurl-starring      # Starring endpoints
moon run hurl-playlists     # Playlist endpoints
moon run hurl-lists         # List endpoints
moon run hurl-playqueue     # Play queue endpoints

# Frontend E2E tests
moon run client:test-e2e          # All E2E tests
moon run client:test-e2e-ui       # E2E tests with Playwright UI
moon run client:test-e2e-headed   # E2E tests in headed browser
moon run client:test-e2e-debug    # E2E tests in debug mode

# Individual E2E test specs
moon run client:test-auth         # Auth tests
moon run client:test-browse       # Browse tests
moon run client:test-search       # Search tests
moon run client:test-playback     # Playback tests
moon run client:test-queue        # Queue tests
moon run client:test-starring     # Starring tests
moon run client:test-playlists    # Playlist tests
```

### Code Quality

```bash
moon run lint               # Rust clippy
moon run fmt                # Format Rust code
moon run fmt-check          # Check Rust formatting
moon run client:lint        # ESLint for frontend
moon run client:typecheck   # TypeScript type checking
moon run client:fmt         # Format frontend code (Prettier)
moon run client:fmt-check   # Check frontend formatting (Prettier)
```

### Code Generation

```bash
moon run generate-bindings  # Generate TypeScript types from Rust
moon run generate-fixtures  # Generate test audio fixtures (requires ffmpeg)
```

### Utilities

```bash
moon run scan               # Scan music library
moon run clean              # Clean Rust build artifacts
moon run client:clean       # Clean frontend build artifacts
moon run client:playwright-install  # Install Playwright browsers
moon run client:playwright-report   # View Playwright test report
```

### Android Environment

Android Tauri build and deploy commands must be run inside the Android nix shell.
If `moon run client:tauri-android-build*` or `moon run client:tauri-android-deploy` fails with missing `JAVA_HOME`, `ANDROID_HOME`, or Android SDK tooling, enter the nix shell first and run the Moon task from there.

Example:

```bash
nix develop .#android
moon run client:tauri-android-deploy
```

### Native Android Client (`android/`)

The native Kotlin/Compose Android client lives in `android/` (moon project `android`). Build, test, and lint tasks must run inside the Android nix shell:

```bash
nix develop .#android
moon run android:test-unit        # JVM unit tests
moon run android:lint             # Android lint
moon run android:assemble-debug   # debug APK
moon run android:install-debug    # install on a connected device/emulator
moon run android:deploy           # minified release build, signed + installed + launched
moon run android:generate-bindings # regenerate Kotlin DTOs from ts-rs TS output
```

`android:install-debug` installs through the platform-tools `adb` and honors
`ANDROID_ADB_SERVER_ADDRESS` (and `ANDROID_SERIAL`) from the environment, so a
remote adb server works; Gradle's own `installDebug` cannot see remote
devices and is no longer used.

`android:deploy` builds the R8-minified release APK and signs it with the
release key from `FERROTUNE_RELEASE_KEYSTORE*` when set (falling back to the
local debug keystore), then installs and launches it. Use it for real-world
use and performance checks: debug builds run Compose without R8 and are
noticeably slower. A release-signed install cannot be updated in place by a
debug-signed APK (and vice versa); uninstall once when switching.

The native app intentionally installs side by side with the legacy Tauri
Android app during the transition: it uses `applicationId
com.ferrotune.music.native` and label "Ferrotune Native", and any
`ContentProvider` authority must be derived from the application id (see
`ArtworkContentProvider.authority(context)`) instead of a hardcoded package
name. The Tauri Android path stays until the native app has been verified on a
device.

### Kotlin DTOs (`android/core/network/.../generated/`)

Response DTOs are generated from the ts-rs TypeScript contracts
(`client/src/lib/api/generated`) by
`android/scripts/generate-kotlin-bindings.mjs` and committed. The TypeScript
files are the wire-shape source of truth; the script indexes Rust structs only
to recover numeric precision (i32 → `Int`, i64 → `Long`, f64 → `Double`).

- After changing Rust response structs, run `moon run generate-bindings`
  (Rust/ts-rs) and then `moon run android:generate-bindings`.
- Never hand-edit generated files; CI fails when they drift from the TS
  contracts.
- Request/query structs that ts-rs does not export stay hand-written in
  `android/core/network/.../dto/`.

---

## Testing Requirements

**Every implementation must include tests. Follow this workflow:**

1. **Implement** the feature
2. **Write tests** - Hurl for backend, Playwright for frontend
3. **Run tests** - Verify they pass
4. **Fix failures** - Iterate until green

For detailed testing guidance, see [docs/TESTING.md](docs/TESTING.md).

### Quick Test Commands
```bash
# Backend - specific hurl test
moon run hurl-browse

# Frontend - E2E with UI
moon run client:test-e2e-ui
```

---

## Code Conventions

### Backend (Rust)

**Response Format**: Native API endpoints return JSON and use HTTP status codes directly.

**Authentication**: Uses the `FerrotuneAuthenticatedUser` extractor. Browser and app clients use bearer session tokens; tests and command-line tools may use HTTP Basic auth. URL-only browser surfaces use short-lived scoped URL tokens.

**Error Handling**: Use `Error` enum in `error.rs`:
- `Error::NotFound(msg)` → 404
- `Error::InvalidRequest(msg)` → 400
- `Error::Unauthorized(msg)` → 401

**Query Parameters**: Use custom deserializers in `query.rs` where endpoints need duplicate-key query parameters or single-value/array compatibility.

### Frontend (Vite/React)

**State Management**: Jotai atoms in `src/lib/store/`
**API Client**: `src/lib/api/client.ts` wraps native `/api` calls
**Components**: Shadcn/ui components in `src/components/ui/`
**Routing**: React Router routes are declared in `src/routes.tsx`; Vite entrypoint is `src/main.tsx`
**Legacy compatibility**: `src/lib/next-compat/` backs old Link/navigation/image call sites during the Vite migration. Prefer React Router APIs and shared components for new code.

---

## Shared Utilities (Code Reuse)

**IMPORTANT**: Before implementing new functionality, check if shared utilities exist. Avoid duplicating code.

### Database Layer (`src/db/`)

| Module | Purpose |
|--------|---------|
| `entity/` | SeaORM entity structs generated from the Postgres schema. Prefer these for simple CRUD. |
| `models.rs` | Shared DTO structs with `sea_orm::FromQueryResult` + `serde` derives used by `raw::*` queries and API responses. |
| `raw.rs` | Dialect-aware raw-SQL escape hatch: `raw::query_all<T>`, `raw::query_one<T>`, `raw::query_scalar<T>`, `raw::execute`, `raw::query_rows`. Each takes SQLite and Postgres SQL variants so callers can keep dialect-specific syntax (`?` vs `$N`, FTS5 vs `to_tsvector`, `COLLATE NOCASE` vs `ILIKE`, typed NULL casts). |
| `repo/` | Domain-scoped SeaORM query surface. All code under `src/api/**`, `src/watcher.rs`, `src/thumbnails.rs`, `src/bliss.rs`, etc. must go through `repo::*` helpers (or `entity::*` directly) instead of `crate::db::raw::*`. Submodules include: users/auth, config/setup, stats, song flags, starring/rating, scrobble import/dedupe helpers, browse reads, listening flows, playlist folder/share/mutation/recent slices, `coverart` (thumbnail presence/insert/fetch for albums/artists/songs/playlists), `bliss` (similarity seed + candidate fetch), `history` (play-history aggregates + batched song fetch), `history_admin` (raw scrobble/listening-session management list/delete helpers), `music_folders`, and simple list/reporting reads. `raw::*` is now a database-internal escape hatch consumed only by `src/db/queries.rs`, `src/db/migrations.rs` and FTS/search helpers. |
| `retry.rs` | `with_retry` for SQLite "database is locked" errors. Wraps `DbErr`. |
| `ordering.rs` | `case_insensitive_order(backend, col)` helper. |

```rust
// ✅ Good — raw SQL via the dialect-aware helpers
let songs: Vec<Song> = crate::db::raw::query_all(
    database.conn(),
    "SELECT ... FROM songs WHERE artist_id = ?",       // SQLite
    "SELECT ... FROM songs WHERE artist_id = $1",      // Postgres
    [sea_orm::Value::from(artist_id)],
).await?;

// ❌ Bad — do not reach for `sqlx::query_*` directly. `src/db/mod.rs` is the
// only place allowed to depend on `sqlx` at runtime (pool bootstrap + migrator).
```

**Migrations**: schema changes are written as paired `.sql` files in `migrations/sqlite/NNN_*.sql` and `migrations/postgres/NNN_*.sql`. The sqlx migrator at startup applies whichever set matches the configured backend. There is no `ferrotune db migrate` CLI — migrations run automatically on server startup.

**Migrating a prod SQLite DB to Postgres**: use `scripts/migrate_sqlite_to_postgres.py` (see script header for usage). The target Postgres must have schema applied (start the server once against the target URL to let the migrator create tables, then stop it before running the script).

### Backend Shared Modules (`src/api/common/`)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `utils.rs` | Common formatting utilities | `format_datetime_iso()`, `format_datetime_iso_ms()`, `get_content_type_for_format()`, `parse_inline_images()` |
| `starring.rs` | Star/favorite and rating operations | `star_items()`, `unstar_items()`, `set_item_rating()`, `fetch_starred_content()`, `get_starred_map()`, `get_ratings_map()` |
| `history.rs` | Play history operations | `fetch_play_history()` |
| `scrobbling.rs` | Shared scrobble dedupe/insert utilities | `insert_submission_scrobble_if_not_recent_duplicate()` |
| `playqueue.rs` | Queue utilities | `find_current_index()` |
| `browse.rs` | Browse operations | `get_artists_logic()`, `get_album_logic()`, `song_to_response()`, `song_to_response_with_stats()` |
| `lists.rs` | List generation | `get_album_list_logic()`, `get_random_songs_logic()`, `get_songs_by_genre_logic()` |
| `search.rs` | Search operations | `search_artists()`, `search_albums()`, `search_songs()` |
| `sorting.rs` | Server-side sorting | `filter_and_sort_songs()` |

### Server Runtime and Collection Commands

| Module | Purpose | Key APIs |
|--------|---------|----------|
| `src/lib.rs` | Canonical standalone/embedded server bootstrap and owned maintenance-task lifecycle | `ServerRuntime::bootstrap()`, `ServerRuntime::bootstrap_with_database()`, `ServerRuntimeOptions`, `CorsPolicy` |
| `src/api/queue.rs` | Server-side materialization of one or more collection descriptors with stable first-occurrence deduplication | `QueueSourceRequest`, `materialize_queue_sources()` |
| `src/api/media.rs` | IDs-only and native-download snapshots for collection commands | `POST /api/sources/song-ids`, `POST /api/downloads/manifest` |

CLI, desktop, and test launchers must consume `ServerRuntime`; do not recreate
watchers, session maintenance loops, router layers, or startup readiness in a
launcher. Queue, bulk, playlist, and download actions should send collection
source descriptors instead of fetching detail DTOs to extract song IDs.

**Examples:**

```rust
// ✅ Good - Use shared date formatting
use crate::api::common::utils::format_datetime_iso_ms;
let created = format_datetime_iso_ms(album.created_at);

// ❌ Bad - Don't inline format strings
let created = album.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

// ✅ Good - Use shared starring logic
use crate::api::common::starring::{star_items, fetch_starred_content};
star_items(&pool, user_id, &song_ids, &album_ids, &artist_ids).await?;

// ✅ Good - Use shared content type detection
use crate::api::common::utils::get_content_type_for_format;
let content_type = get_content_type_for_format(&song.file_format);
```

### Frontend Shared Components (`client/src/components/shared/`)

| Component | Purpose |
|-----------|---------|
| `media-menu-items.tsx` | Polymorphic menu items for ContextMenu/DropdownMenu |
| `details-dialog.tsx` | Unified details dialog for songs/albums/artists |
| `media-card.tsx` | Shared media card component |
| `action-bar.tsx` | Shared action bar component |

**Menu Items Example:**

```tsx
// ✅ Good - Use shared menu items with component adapters
import { AlbumMenuItems, MenuComponents } from "@/components/shared/media-menu-items";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";

const contextMenuComponents: MenuComponents = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
};

<AlbumMenuItems
  components={contextMenuComponents}
  handlers={{ handlePlay, handleShuffle, ... }}
  state={{ isStarred }}
  album={{ artistId: album.artistId }}
/>

// ❌ Bad - Don't duplicate menu item JSX across ContextMenu and DropdownMenu variants
```

### Frontend API Client Utilities (`client/src/lib/api/client.ts`)

```typescript
// ✅ Good - Use buildEndpoint for query parameters
const endpoint = buildEndpoint(`/api/artists/${id}`, {
  sort: options?.sort,
  sortDir: options?.sortDir,
  filter: options?.filter,
});

// ❌ Bad - Don't manually construct URLSearchParams
const params = new URLSearchParams();
if (options?.sort) params.set("sort", options.sort);
// ... repeated code
```

### Frontend Route Helpers (`client/src/lib/utils/source-links.ts`)

| Helper | Purpose |
|--------|---------|
| `getPlaylistDetailsHref()` | Route shared playlist/smart-playlist links to the correct page variant |
| `getSongRadioHref()` | Build the dedicated Song Radio page URL from a seed song ID |
| `getQueueSourceHref()` | Reuse source-to-route mapping for queue banners and other source-linked UI |

### Frontend Home Customization Helpers (`client/src/lib/utils/`)

| Module | Purpose |
|--------|---------|
| `home-sections.ts` | Home section defaults, normalization, display presentation, section detail links, queue filters, and playlist-backed custom section creation |
| `home-tiles.ts` | Home quick tile defaults, normalization, settings requirements, display presentation, and section-aware queue/link actions |

Server-backed UI preferences such as Home tiles and sections use `atomWithServerStorage`. That helper keeps an account-scoped memory cache and mirrors values into the shared IndexedDB cache store, so account switches can render the correct Home/settings state before the fresh server preference fetch completes.

### Frontend Persistent Query Cache (`client/src/lib/query-persister.ts`)

`PERSISTED_QUERY_CACHE_BUSTER` versions API DTOs stored by TanStack Query in
the account-scoped IndexedDB cache. Increment it whenever a persisted response
shape changes incompatibly; do not hydrate old DTOs and patch them with legacy
field fallbacks in components.

### Frontend Hooks (`client/src/lib/hooks/`)

| Hook | Purpose |
|------|---------|
| `use-album-actions.ts` | Album playback/queue/starring actions |
| `use-artist-actions.ts` | Artist playback/queue/starring actions |
| `use-song-actions.ts` | Song playback/queue/starring/rating actions |
| `use-session-owner-state.ts` | Shared session ownership snapshot handling and foreground recovery |
| `use-star.ts` | Generic starring state management |

### Frontend Queue Helpers (`client/src/lib/queue/`)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `current-position.ts` | Source-aware now-playing matching for virtualized collection views | `queueSourceMatchesView()`, `getCurrentQueuePositionMatch()` |

### Frontend Offline Helpers (`client/src/lib/offline/`)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `download-manager.ts` | Native download state subscription plus persisted downloaded song/container metadata | `initDownloadManager()`, `getDownloadedSongs()`, `getDownloadedContainers()` |
| `playlist-membership.ts` | Account-scoped IndexedDB cache for visible playlist membership of downloaded song IDs, used only for true offline playback/materialization | `syncOfflinePlaylistMembership()`, `getOfflinePlaylistMembershipForPlaylist()` |

### Android Native Audio Lifecycle Helpers (`client/tauri-plugin-native-audio/android/`)

| Helper | Purpose |
|--------|---------|
| `OwnedCallback.kt` | Owner-token callback slot for Activity/WebView bridges whose stale teardown must not clear a replacement binding. |
| `SseConnectionGeneration.kt` | Generation guard that discards callbacks from superseded native SSE connections. |
| `PlaybackStallMonitor.kt` | Pure watchdog state machine for playback progress, backward-seek re-baselining, recovery, and skip escalation. |
| `PlaybackNotificationLifecycle.kt` | Foreground-service policy for playback intent during notification updates, buffering, and track transitions. |
| `NativeListeningSessionLifecycle.kt` | Pure native listening-session state machine for periodic updates, pause snapshots, and per-track finalization while the WebView sleeps. |
| `WebViewPlaybackEventPolicy.kt` | Drops stale playback snapshots while the Android WebView is backgrounded; the plugin emits one current snapshot on resume. |

### Native Android Modules (`android/`)

The native client lives in `android/` and will replace the Tauri/WebView Android
path (see `docs/NATIVE_ANDROID.md`). The playback engine moved to
`android/core/media` in M1 and drops the JSObject/WebView bridge in favour of
typed flows.

| Module | Purpose | Key APIs |
|--------|---------|----------|
| `android/core/media/PlaybackRepository.kt` | App-scoped front end for `PlaybackService`; binds on first use, mirrors state to flows, exposes suspend commands | `state: StateFlow<PlaybackState>`, `events: SharedFlow<PlaybackEvent>`, `initSession()`, `startPlayback()`, `play()`, `pause()`, `nextTrack()`, `previousTrack(force)`, `seek()`, `applySettings()`; `force = true` skips to the previous entry even within the first 3 seconds (web `previousForce`, used by swipe gestures) |
| `android/core/media/PlaybackSettingsRepository.kt` | Server-synced playback preferences (ReplayGain mode/offset, transcoding enabled/bitrate, progress bar style under the web client's `progress-bar-style` key) applied to the engine via `PlaybackSettingsApplier`; defaults computed/0/computed/192/waveform | `settings: StateFlow<PlaybackSettings>`, `ensureLoaded()`, `load()`, `setReplayGainMode()`, `setReplayGainOffset()`, `setTranscodingEnabled()`, `setTranscodingBitrate()`, `setProgressBarStyle()`, `applySearchTermsToQueue` / `setApplySearchTermsToQueue()` (web "Apply search terms to queues", key `apply-search-terms-to-queue`, default on; `PlaybackSessionStarter.startQueue` drops the view's `filter` when off and the server finds the tapped song by `startSongId`; Library asks `PlaybackStarter.appliesSearchTermsToQueue()`), `DEFAULT_PROGRESS_BAR_STYLE`, `PROGRESS_BAR_STYLES` |
| `android/core/media/WaveformRepository.kt` | App-scoped fetch/cache for `GET /api/songs/{id}/waveform` normalized bar heights; LRU-capped (24) with in-flight deduplication so player surfaces can render the waveform progress bar | `heights(songId): List<Float>`, `clear()` |
| `android/core/media/cast/CastManager.kt` | Cast sender port of the legacy `NativeCastManager` with StateFlow state/status, queue loading, transport, and volume; no hidden route-button hack (UI owns `MediaRouteButton`) | `state: StateFlow<CastConnectionState>`, `status: StateFlow<CastMediaStatus>`, `initialize()`, `loadQueue()`, `play()`, `pause()`, `next()`, `previous()`, `seek()`, `setVolume()`, `endSession()` |
| `android/core/media/CastUrls.kt` | Pure helpers for external-player URLs: appends media URL tokens, maps Opus streams to an OGG content type | `appendUrlToken()`, `castContentType()`; `PlaybackService.castMediaItems()` / `PlaybackRepository.castMediaItems()` build the receiver queue (stream + cover URLs with a media URL token from `ensureMediaUrlToken()`) |
| `android/feature/player/PlaybackClients.kt` + `PlaybackClientsViewModel.kt` | Web `FollowerIndicator` + "Connected Clients" menu: while another client owns the shared session, a "Playing on <device>" strip sits above the mini player (the shell renders it); tapping it opens a sheet of connected clients (`GET /api/sessions/clients`) and moves audio with a `takeOver` command (`POST /api/sessions/{id}/command`). The engine's `OwnerChanged` handling does the actual pause/resume | `PlaybackOwnerStrip()`, `PlaybackClientsViewModel` (`refresh()`, `transferTo()`), `friendlyClientName()` |
| `android/core/media/cast/CastPlaybackHandoff.kt` | App-scoped Cast session handoff (web `use-cast`): on connect it pauses the phone, claims the shared session for the virtual receiver client (`castClientId()`, `ferrotune-cast:<clientId>`) and loads the queue at the current queue position, or adopts a resumed receiver that is already playing instead of resetting it; while casting it heartbeats the receiver's track/position; on disconnect it hands the session back to the phone paused at the receiver's position and resyncs the engine. Ports: `CastSessionPort` (`CastManager`), `CastHandoffPlayback` (`PlaybackSessionStarter`); `FakeCastSession` in `core:testing` | `CastPlaybackHandoff.start()`, `castClientId()`, `castStartIndex()`, `CAST_CLIENT_NAME` |
| `android/core/media/SessionRemoteControl.kt` | Web remote control: while another client owns the shared session (`PlaybackState.isFollowing`), `PlayerViewModel` sends play/pause/next/previous/seek as session commands to the owner instead of playing locally, and shows the owner's play state and progress from `PlaybackState.remote` (`RemotePlayback`, filled by the engine from `positionUpdate` events; the engine also moves its paused cursor to the owner's track). `PlaybackClientsMenuSection()` adds the web's "Connected Clients" list to the Home account menu | `SessionRemoteControl` (`play()`, `pause()`, `next()`, `previous()`, `seek()`), `isFollowing`, `RemotePlayback`, `PlaybackClientsMenuSection()` |
| `android/feature/player/CastRouteButton.kt` | Compose wrapper around the Cast `MediaRouteButton`; `PlayerViewModel` routes transport to `CastManager` while connected and shows "Casting to <device>" with a disconnect action | `CastRouteButton()`, `rememberCastChooser()` (opens the device chooser from menus, e.g. the player bar ⋯ "Cast…" item, via a hidden attached route button) |
| `android/app/.../CastOptionsProvider.kt` | Cast options using the default media receiver, registered via the `OPTIONS_PROVIDER_CLASS_NAME` manifest meta-data | `CastOptionsProvider` |
| `android/core/media/PlaybackEvent.kt` | Typed playback events (replaces JSON-over-WebView payloads) | `StateChanged`, `Progress`, `TrackChanged`, `PlaybackError`, `QueueStateChanged`, `StarToggled`, ... |
| `android/feature/player/NowPlayingScreen.kt` + `MiniPlayerBar.kt` + `PlayerProgress.kt` | Full-screen player (web layout: "Playing from" header with the song menu, blurred-cover background, full-size artwork, title/artist + heart, `PlayerSeekBar`, transport, Cast + Queue pill) and mini player (tap or swipe up to expand, swipe sideways to skip with adjacent-track previews, scrubable waveform strip, play/pause + queue + overflow menu) | `NowPlayingScreen()`, `MiniPlayerBar()`, `PlayerSeekBar()`, `PlayerProgressLine()` |
| `android/feature/player/MiniPlayerSwipe.kt` | Pure helpers for the mini player's sideways skip gesture (web `player-bar` parity) | `miniPlayerSwipeDirection(offsetX, velocityX, distanceThresholdPx, velocityThreshold)`, `miniPlayerSwipePreviewAlpha(offsetX, thresholdPx, distancePx)` |
| `android/feature/player/NowPlayingSheetState.kt` + `NowPlayingOverlay.kt` | Hoisted now-playing overlay state machine (offset follow, the web's dp thresholds with flick velocity — open after a 50dp pull or an upward flick, dismiss after 100dp or a fast flick past 40dp — animated open/close, prev/next art swipe with adjacent artwork previews, `SheetAnimator` seam for JVM tests) and the app-level overlay composable (scrim tap-to-dismiss, `PredictiveBackHandler` progress tracking, axis-locked drag gestures, haptics); the app shell renders it above the mini player instead of a route | `NowPlayingSheetState`, `SheetAnimator`, `rememberNowPlayingSheetState()`, `NowPlayingOverlay()` |
| `android/core/media/AudioState.kt` + `FerrotuneApiClient.kt` | `TrackInfo` carries the current track's `starred` flag parsed from queue-window `QueueSong` JSON, so player surfaces can show and mutate favorite state | `TrackInfo`, `QueueSong`, `parseSong()`, `songToTrackInfo()` |
| `android/core/datastore/AccountStore.kt` | Encrypted account persistence plus stable device identity | `accounts`, `activeAccount`, `upsert()`, `setActive()`, `clientId()` |
| `android/core/network/ServerPreferences.kt` | Single source for the active account's `GET /api/preferences`: one deduplicated server read shared by every preference repository, an on-device per-account JSON cache (`FilePreferencesCache`) so cold/offline starts show saved values, optimistic writes with rollback, and account switching by account id. Repositories derive their state with `mapState` (`StateFlows.kt`, a scope-free derived `StateFlow`); tests use `testServerPreferences(api)` / `InMemoryPreferencesCache` from `core:testing` | `snapshot`, `ensureLoaded(maxAgeMs)`, `refresh()`, `invalidate()`, `set(key, value)`, `setAccent()`, `mapState()` |
| `android/core/network/FerrotuneApi.kt` | Retrofit native API surface bound to a server URL/token | `login()`, `me()`, `refresh()`, `logout()`, `connectSession()`, `startQueue()`, `randomSongs()`, `search()`, `artist*`, `album*`, `song*`, `songIds()`, `sourceSongIds()`, `genres()`, `history()`, `star()`, `setRating()`, `addToQueue()` |
| `android/core/network/AuthenticatedApiProvider.kt` | Caches the active account's `FerrotuneApi` and `Account`; also backs the app-wide authenticated OkHttp client for Coil | `requireApi()`, `requireAccount()` |
| `android/core/network/QueryMap.kt` | Converts generated query DTOs into Retrofit `@QueryMap` parameters, omitting nulls | `toQueryMap()` |
| `android/core/network/ConnectivityMonitor.kt` | Validated-network connectivity state; drives the global offline banner and offline-aware UI | `isOnline: StateFlow<Boolean>` (interface `ConnectivityMonitor`, impl `AndroidConnectivityMonitor`) |
| `android/core/media/PlaybackSessionStarter.kt` | Connects a playback session and materializes queues (library, album, artist, genre, favorites, history, search, song radio, explicit song IDs, plus next/end additions; additions without an active session start a queue instead) | `QueueStartSpec`, `QueueAddSpec`, `startQueue()`, `startRandomQueue()`, `startAlbum()`, `startArtist()`, `startSongRadio()`, `addToQueue()`, `queueSort()`; ViewModels inject the `PlaybackStarter` interface so tests can fake it |
| `android/core/actions/SongActions.kt` | Song mutations behind the shared menus (favorite, rating, play next/queue, select-all id resolution) with outcomes reported through `UserMessages` | `SongActionsEntryPoint`, `rememberSongFlags()`, `SongActionsViewModel` (`toggleStar`, `setRating`, `setStarredBulk`, `loadAllIds`, `playNext`, `addToQueue`, `playSong`), `SongFavoriteButton` |
| `android/core/actions/SongMenu.kt` | The web song row and song drawer menu: one hoisted `SongMenuState` + `SongMenuSheet` per screen (Play, Play next, Add to queue, Start radio, Add to playlist, favorite, inline 1–5 rating, Go to artist/album, Download, Select + screen `extraActions`), `SongListRow` over `TrackRow` with now-playing bars, and `rememberNowPlaying()` (track/play state only, so progress ticks never recompose lists) | `SongMenuTarget`, `toMenuTarget()`, `SongMenuState`, `rememberSongMenuState()`, `SongMenuSheet()`, `SongListRow()`, `songSubtitle()`, `NowPlaying`, `rememberNowPlaying()` |
| `android/core/actions/SongDetails.kt` + `DisabledSongsStore.kt` | Web "View Details" and "Disable Track" in the song menu: `SongDetailsSheet` (opened through `SongMenuState.showDetails`) loads `GET /api/songs/{id}` and shows the details dialog's rows (`songDetailRows()`; long-press copies the track id or file path). `DisabledSongsStore` holds the account's disabled ids (`GET /api/disabled-songs`, optimistic `PUT /api/songs/{id}/disabled` + bulk, reset on account switch); `SongListRow` dims disabled songs with a blocked icon via `rememberDisabledSongIds()` | `SongDetailsSheet()`, `songDetailRows()`, `DisabledSongsStore`, `rememberDisabledSongIds()`, `SongActionsViewModel.setDisabled()` |
| `android/core/actions/SongListItems.kt` | `LazyListScope` helper rendering paged songs with loading/error/empty/append states, optional index column, disc separators (`discHeader`), and custom keys (null keys for lists with duplicate songs) | `songPagingItems()`, `discHeader()` |
| `android/core/actions/MediaActions.kt` | App-level navigation and cross-feature actions provided by the app shell through a CompositionLocal (open album/artist/genre/radio/playlist, the shared "Add to playlist" dialog, downloads, the song download menu row). Screens never thread these callbacks | `MediaActions`, `LocalMediaActions`, `NoOpMediaActions` |
| `android/core/actions/UserMessages.kt` | App-wide snackbar feed (web toasts): actions report confirmations/errors here instead of failing silently or replacing the page with an error | `UserMessages` (`show`, `error`, `failure`), `UserMessage` |
| `android/core/actions/Covers.kt` | Cover models like the web `CoverImage`: inline thumbnail when present, else the authenticated `/api/cover-art` URL built from `LocalServerUrl` (provided by the app shell) | `LocalServerUrl`, `coverModel()`, `coverUrl()`, `CoverSize` |
| `android/core/actions/CollectionActions.kt` | Hoisted album/artist/playlist/genre drawer menu: play, shuffle, play next, add to queue, add to playlist (resolves the source's song ids), favorite (albums/artists), Go to artist, plus screen `extraActions`/`extraContent` (download, sort) | `CollectionSource`, `CollectionTarget`, `CollectionMenuState`, `rememberCollectionMenuState()`, `CollectionMenuSheet()`, `CollectionActionsViewModel` |
| `android/core/actions/SongSelection.kt` | Screen-local multi-select for song lists: count/select-all top bar and bottom action bar (play next, queue, favorite/unfavorite, add to playlist, download + screen `extraActions`), with select-all resolved server-side via `/songs/ids` or `/sources/song-ids` | `SongSelectionState`, `rememberSongSelectionState()`, `SongSelectionTopBar`, `SongSelectionActionBar`, `SongSelectionAction` |
| `android/core/actions/SongFlagsStore.kt` | Optimistic starred/rating overlay over API mutations with rollback on failure; bulk starring merges overrides without clobbering other songs | `SongFlags`, `SongFlagsOverride`, `SongFlagsStore`, `setStarred()`, `setRating()`, `setStarredBulk()`, `clear()` |
| `android/feature/library/LibraryRepository.kt` + `LibraryPagingSources.kt` | Paged browse/search/history reads and starring mutations; requests `inlineImages=medium` cover art in browse/search/history params so list rows render artwork without extra fetches; server-side sort/filter keys; `favoritesCounts()` resolves starred song/album/artist totals from a zero-count search for the Favorites tab labels | `songs()`, `albums()`, `artists()`, `albumSongs()`, `artistSongs()`, `artistAlbums()`, `history(filter, sort, sortDir)`, `favoritesCounts()`, `genres()`, `similarSongs()`, `setStarred()`, `INLINE_IMAGES` |
| `android/feature/library/ui/FilesViewModel.kt` + `FilesBrowser.kt` | Web Library → Files as the Library screen's "Files" chip: library list, folder heading with play/shuffle, breadcrumbs, folders then files (`GET /api/libraries`, paged `GET /api/directory` via `DirectoryPagingSource`), server-side filter and sort (`ViewSortKey.FILES`). Files play the open folder as `directoryFlat` (start index = list position − folder count); folder actions use the recursive `directory` source with `libraryId:path` ids. System back walks up the path | `FilesViewModel` (`activate()`, `openLibrary()`, `openFolder()`, `navigateUp()`, `playFile()`, `playFolder()`, `addFolderToQueue()`, `playCurrentFolder()`), `FilesLocation`, `DirectorySummary`, `FilesSort`, `FilesBrowser()` |
| `android/feature/library/LibraryViewPreferencesRepository.kt` | Server-synced per-tab library sort preferences stored as JSON under the native-only `library-sort-native` key (the shared `library-sort` key belongs to the web/Tauri client and must not be clobbered) | `sort: StateFlow<LibrarySortConfig>`, `ensureLoaded()`, `load()`, `setSongSort()`, `setAlbumSort()`, `setArtistSort()` |
| `android/core/network/ViewSortPreferencesRepository.kt` | Server-synced per-view sort preferences for the Favorites tabs, album/artist/genre detail, history, and playlist detail (playlist and smart-playlist detail share one key), stored under native-only `*-native` keys with the web's `{field, direction}` shape | `config(key, default)`, `ensureLoaded()`, `load()`, `setSort(key, field, direction)`; `ViewSortKey`, `ViewSortConfig` |
| `android/core/network/ViewModePreferencesRepository.kt` | Server-synced grid/list toggle (web `*ViewModeAtom`) for library albums/artists, favorite albums/artists, and the Playlists page under native-only `*-view-native` keys; grid by default. Screens render `ViewModeSheetSection` (in `SortMenu.kt`) in their ⋯ sheet and switch to a one-column grid of `MediaRow`s in list mode | `modes: StateFlow<Map<ViewModeKey, ViewMode>>`, `ensureLoaded()`, `mode()`, `setMode()`; `ViewModeKey`, `ViewMode` |
| `android/feature/playlists/PlaylistRepository.kt` + `PlaylistPagingSources.kt` | Playlist folders, playlists, smart playlists, shares, membership, song search, and music folders for rule fields | `folders()`, `createFolder()`, `updateFolder()`, `movePlaylist()`, `playlistSongs()`, `addSongs()`, `removeSongs()`, `moveEntry()`, `shares()`, `setShares()`, `smartPlaylists()`, `materializeSmartPlaylist()`, `musicFolders()`, `searchSongs()` |
| `android/feature/playlists/PlaylistFolderTree.kt` | Builds the folder hierarchy the playlist browser renders (position/name ordering, orphan fallback) and answers drill-down queries against it | `buildPlaylistTree()`, `PlaylistFolderNode`, `PlaylistTree`, `foldersIn()`, `playlistsIn()`, `folderById()`, `folderPath()`; `PlaylistsViewModel` keeps `currentFolderId`/`openFolder()`/`navigateUp()` for the breadcrumb browser and `browserItems()` (folders first, then playlists + smart playlists filtered/sorted like the web toolbar) |
| `android/feature/playlists/SmartPlaylistRules.kt` | Smart playlist rule field/operator descriptors plus `SmartConditionDraft` ⇄ `SmartPlaylistConditionApi` value conversion | `ruleFields()`, `operatorsFor()`, `SmartConditionDraft.toApiCondition()`, `SmartPlaylistConditionApi.toDraft()` |
| `android/feature/playlists/AddToPlaylistDialog.kt` | Overflow action/dialog for adding song IDs to an editable playlist, plus an `AddToPlaylistMenuItem()` sheet row; hosts its own Hilt VM so any feature can use it | `AddToPlaylistAction()`, `AddToPlaylistMenuItem()`, `AddToPlaylistDialog()` |
| `android/feature/home/HomeRepository.kt` | Home dashboard per-section reads, stats, and listening review reads | `continueListening()`, `mostPlayedRecently()`, `forgottenFavorites()`, `albumList()`, `similarTracks()`, `playlistSongs()`, `smartPlaylistSongs()`, `stats()`, `listeningStats()`, `periodReview()` |
| `android/feature/home/HomeSectionLoader.kt` | Loads one dashboard section's preview items, honoring its configured filters | `load(section, size)`, `HomeSectionData` |
| `android/feature/home/HomeLayoutPreferencesRepository.kt` | Server-synced dashboard layout stored under the web/Tauri client's `home-tiles-v1` / `home-sections-v1` keys so both clients stay in sync | `tiles`, `sections`, `ensureLoaded()`, `load()`, `setTiles()`, `setSections()` |
| `android/feature/home/HomeTilePresentation.kt` | Tile/section presentation and queue-source mapping matching the web client, plus `HomeLinkTarget` navigation targets | `homeTilePresentation()`, `homeSectionQueueSpec()`, `homeSectionLabel()`, `homeSectionIcon()` |
| `android/feature/home/HomePlaylistChoicesRepository.kt` | Playlist + smart-playlist choices for the Home layout editors | `choices()`, `HomePlaylistChoice` |
| `android/feature/home/HomeLayoutSettingsViewModel.kt` + `HomeLayoutSettingsScreen.kt` + `HomeLayoutSettingsPresentation.kt` | Settings → Home editor for tiles (add/edit/reorder/remove, playlist and account pickers) and sections (enable/edit/reorder/remove playlist sections, per-kind settings) | `HomeLayoutSettingsScreen`, `HomeLayoutSettingsViewModel`, `homeTileKindLabel()`, `homeSectionDescription()`, `homeSectionHasSettings()` |
| `android/feature/player/QueueRepository.kt` + `QueuePagingSource.kt` | Server-side queue reads and edits for the queue panel: the whole queue paged with placeholders (aligned page keys, so list indices are queue positions); mutations flow back through SSE | `queuePages()`, `removeEntry()`, `clear()`, `moveEntry()`, `setShuffled()`, `setRepeatMode()`, `QueuePagingSource`, `alignedQueueKey()`, `QueueEntry` |
| `android/feature/player/QueueSheetViewModel.kt` + `QueueSheet.kt` | Web mobile queue: a full-screen panel drawn by the app shell above the player (`QueuePanelHost`, opened through `LocalQueuePanel`), sliding in from the right (swipe right/back closes), with jump-to-current, Clear, "Playing from", card rows with now-playing bars, drag handles, and a long-press song menu adding Move to position / Remove. The engine's queue index is authoritative for the highlight; pages reload when the session, queue length, shuffle, or source changes, after edits, and on resume | `QueuePanelState`, `LocalQueuePanel`, `QueuePanelHost()`, `QueueSheetUiState`, `entries`, `reload()`, `jumpTo()`, `remove()`, `clear()`, `moveTo()` |
| `android/core/network/paging/OffsetPagingSource.kt` | Shared offset-keyed Paging 3 base for endpoints that report totals | `OffsetPagingSource`, `DEFAULT_PAGE_SIZE` |
| `android/core/database/` | Room store for download metadata: `DownloadedSongEntity`, `DownloadedContainerEntity`, junction membership, `DownloadDao` (`songs()`, `containersWithCount()`, `containerSongIds()`, `pruneEmptyContainers()`, ...), `DownloadDatabase` | `DownloadContainerType`, `SongResponse.toDownloadedSong()` |
| `android/core/media/DownloadEngine.kt` | Testable surface over Media3 `DownloadManagerHolder` (enqueue/cancel/pause/resume/removeAll/wifi-only + event flow). `setServer(serverUrl, token)` configures download URLs/auth from the active account (called by `DownloadRepository` at startup and before every enqueue), so downloads never depend on a playback session existing | `DownloadEngine`, `Media3DownloadEngine` |
| `android/core/media/OfflineQueueSource.kt` | Materializes a local queue when the server is unreachable; consumed by `PlaybackSessionStarter.startQueue` fallback | `offlineQueue(sourceType, sourceId, startSongId)` |
| `android/feature/downloads/DownloadRepository.kt` | Download state (engine snapshot + events) and persisted song/container metadata; container downloads return the number of songs queued; container downloads page through album/playlist/smart-playlist APIs | `enqueueSong()`, `downloadAlbum()`, `downloadPlaylist()`, `downloadSmartPlaylist()`, `removeSong()`, `removeContainer()`, `clearAll()`, `downloadedSongIds`, `downloadedContainerIds`, `containerSongs(containerId)` |
| `android/feature/downloads/DownloadSettingsRepository.kt` | Server-synced download preferences (`downloadFormat`, `downloadBitrate`, `downloadWifiOnly`) applied to the engine; defaults opus/128/no restriction | `settings: StateFlow<DownloadSettings>`, `ensureLoaded()`, `setFormat()`, `setBitRate()`, `setWifiOnly()` |
| `android/feature/downloads/OfflineQueue.kt` | Builds `GetQueueResponse` from Room metadata and implements `OfflineQueueSource` (container order, start-song index; non-container sources fail gracefully like the web materializer) | `materializeOfflineQueue()`, `RoomOfflineQueueSource` |
| `android/feature/downloads/ui/` | Downloads collection page (web-style hero + Play/Shuffle bar, saved albums/playlists shelf that plays offline in saved order, song rows with in-progress/failed indicators, long-press sheets to remove, confirmed "Remove all"); `DownloadActionViewModel` confirms or explains every action through `UserMessages`, `SongDownloadAction` row icon, `SongDownloadMenuItem` sheet row, `ContainerDownloadAction` top-bar action, `DownloadActionViewModel.downloadSongs()` for bulk selections | `DownloadsScreen`, `SongDownloadAction`, `SongDownloadMenuItem`, `ContainerDownloadAction`, `DownloadActionViewModel`, `ContainerDownloadType` |
| `android/feature/home/ui/ProfileScreen.kt` + `ProfileViewModel.kt` | Web profile page (account sheet → Profile): sticky header with Admin badge, account card (`GET /api/users/me`), listening activity tiles + "Your Review", and a confirmed Sign Out card; each card loads independently. Play-count/favorite imports and raw history management stay on desktop | `ProfileScreen`, `ProfileViewModel`, `skipRatePercent()`, `formatMemberSince()` |
| `android/feature/home/ui/ReviewScreen.kt` + `ReviewViewModel.kt` | Web "Your Review" (account sheet → Your Review, Profile → Your Review): ‹ period picker › (years newest first, then months), overview stat tiles, and ranked top tracks/artists/albums with medals; tracks play the ranked list from the tapped row (`history` source + song ids), artist/album covers play and rows open; "Create Playlist" saves the top tracks | `ReviewViewModel` (`select()`, `playTrack()`, `playArtist()`, `playAlbum()`, `createPlaylist()`), `ReviewPeriod`, `sortedPeriods()`, `periodLabel()`, `topTracksName()` |
| `android/feature/settings/ui/` | Web-style Settings: icon header, section jump chips, and cards for server connection/accounts (switch, add, sign out), library statistics, Home layout, playback (ReplayGain, transcoding, progress bar), downloads (format/bitrate/Wi-Fi only, manage downloads), appearance (Light/Dark/System, accent presets + custom OKLCH), and about | `SettingsScreen`, `SettingsViewModel` (`libraryStats`) |
| `android/feature/settings/AccentSettingsRepository.kt` | Server-synced accent color: preset name from `accentColor`, custom OKLCH values from the preference fields; `AppViewModel` applies it via `FerrotuneTheme(accent = ...)` | `state: StateFlow<AccentState>`, `ensureLoaded()`, `load()`, `setPreset()`, `setCustom()` |
| `android/core/designsystem/theme/AccentPalette.kt` | OKLCH→sRGB conversion (port of the web `oklchToRgb`), web-matching presets, custom clamping, and Material3 scheme derivation | `OklchColor`, `AccentColors`, `oklchToColor()`, `FerrotuneTheme(accent = ...)` |
| `android/core/designsystem/theme/Type.kt` + `Shape.kt` | Bundled Inter font family (matches the web client) with the shared typography scale, plus the app-wide rounded shape scale | `InterFamily`, `FerrotuneTypography`, `FerrotuneShapes` |
| `android/core/designsystem/theme/GradientPalette.kt` | Deterministic seed-based gradient colors used for artwork fallbacks and detail/now-playing backdrops | `seedGradient()`, `seedGradientBrush()`, `SeedGradient` |
| `android/core/datastore/ThemePreferencesRepository.kt` | Device-level theme mode persisted in a `ferrotune_ui` DataStore; `ThemeModeStore` interface keeps ViewModels testable | `ThemeModeStore`, `ThemePreferencesRepository`, `themeMode`, `setThemeMode()` |
| `android/core/testing/FakeFerrotuneApi.kt` | Shared `FerrotuneApi` test double with per-endpoint handler lambdas; consumed as `testImplementation(project(":core:testing"))` | `FakeFerrotuneApi`, `FakeApiProvider`, `FakeAccounts`, `FakeAccountSwitcher`, `testAccount()`, `FakePlaybackStarter` |
| `android/core/designsystem/components/` | Shared Compose building blocks | `CoverArt` (web `CoverImage` placeholder: seeded `coverPlaceholderColors` gradient + white type icon under the image, optional low-res `fallbackModel`), `TrackRow` (web song row: index/now-playing bars/checkbox column, 40dp cover, title/subtitle, duration, current/selected tint) + `TrackListHeader` (`# Title Time`) + `TrackGroupHeader` ("Disc N"), `NowPlayingBars`, `MediaCard`/`ShelfCard` (web card: 8dp-padded `bg-card` tile, type icon + tint before the title, centered text for circular covers, no touch play overlay; `MediaGridMinCellWidth` gives three columns on phones, `ShelfCardWidth` for home shelves), `MediaRow`, `MediaActionSheet`/`MediaActionRow`/`MediaActionSeparator` (web drawer menu: animated dismiss, scrollable, separators, destructive rows; rows close the sheet via `LocalMediaSheetDismiss`), `SectionHeader`, `CoverViewer` (web `CoverArtModal`: full-size cover, pinch/double-tap zoom, tap to close) opened by `DetailHeader(fullCoverModel = fullCoverUrl(id))`, `DetailHeader` (always clears the status bar; gradient icon tile via `icon`/`iconGradient`, `coverFallbackModel`, `coverPlaceholder`), `DetailHero` (backdrop sized to the header so it scrolls away) + `bleedHorizontal()`, `DetailActionBar` (web `ActionBar`: translucent strip with play/shuffle/`actions`) + `PinnedActionBar`/`rememberActionBarPinned()`/`ACTION_BAR_ITEM_KEY` (the web's sticky action bar), `ChipTabRow`, `SegmentedTabs` (optionally `scrollable`), `FilterPill` (Search IME action dismisses the keyboard), `SearchField`, `FavoriteButton` (web red heart), `WaveformBar` (web track-change sweep keyed by `trackKey`: old bars flatten behind a moving front and new ones rise behind a second front, via `WaveformTransition.kt` `downsampleHeights()`/`waveformTransitionHeight()`/`advanceWaveformTransition()`; empty heights draw flat bars while loading), `ShimmerBox`/`MediaRowSkeletonList`/`MediaCardSkeleton`, `PageIconHeader` + `SectionCard` + `StatTile` (web settings/profile page header, `Card` with icon title and optional destructive `accent`, and uppercase-label stat tiles), `SortMenu` + `SortSheetSection` (sort rows for ⋯ sheets; choosing the active field flips direction) + `ViewModeSheetSection` ("View as" Grid/List rows), `Formatting.kt`, `PagingListFooter`, `ErrorState`, `EmptyState` (web icon circle + title + description + action), `LoadingState` |

### Native Android UI Conventions

- The web client is the design reference: match its mobile layout, copy, and
  "where things live" (e.g. sort lives in the ⋯ drawer, not a separate icon).
  `ThemeMode.DEFAULT` is dark like the web. Components read `LocalDarkTheme`,
  never `isSystemInDarkTheme()`, so the in-app theme choice wins.
- Edge to edge everywhere: screens use `contentWindowInsets = WindowInsets(0)`;
  `DetailHeader` and the chrome headers clear the status bar themselves.
- Detail screens (album, artist, genre, playlist, smart playlist, favorites,
  history, song radio, home section, the Playlists tab) are one lazy list or
  grid: a `DetailHero` item (backdrop + `DetailHeader`), then the
  `DetailActionBar` as its own item keyed `ACTION_BAR_ITEM_KEY`, then content.
  Define the action bar once as a local `@Composable` lambda and also render it
  in `PinnedActionBar(visible = rememberActionBarPinned(listState))` so it pins
  under the status bar like the web's sticky `ActionBar`. The bar holds play,
  shuffle, a `FilterPill`, and a ⋯ button opening the page's
  `CollectionMenuSheet`/`MediaActionSheet` with download and `SortSheetSection`.
- Song lists render through `songPagingItems`/`SongListRow` with one
  `SongMenuSheet` and `rememberNowPlaying()` per screen. Tap plays, long-press
  opens the song drawer menu (toggles selection while selecting); rows carry no
  per-row heart/⋯ buttons, like the web on touch. Album/artist/playlist cards use
  `CollectionMenuSheet`. Navigation from rows and sheets goes through
  `LocalMediaActions`.
- Playing from any list must materialize the same list server-side: pass the
  source type/id, `queueTextFilter(filter)` (or `{query}` for library/search),
  the active sort, and `startIndex` + `startSongId` of the tapped row (playlist
  rows use `songIndex`, since playlists can repeat songs and skip missing
  entries). Home sections carry their discovery seed in `queueFilters`.
- Lists that restore a stored sort gate paging with `waitFor(sortReady)` and
  `SORT_PREFERENCES_TIMEOUT_MS` (`core/network/SortPreferencesLoading.kt`) so the
  first page isn't fetched twice. Sort selections persist through
  `ViewSortPreferencesRepository` (`ViewSortKey`, native-only `*-native` keys).
- Report action outcomes with `UserMessages`; keep error *states* for failed
  page loads only.
- Collection screens that the web renders as `TabsList` use `SegmentedTabs`
  (Favorites, Search); library chips use `ChipTabRow`. Grids use
  `GridCells.Adaptive(MediaGridMinCellWidth)` (web: three columns on phones);
  lists that mix a grid with other sections use `pagedCardRows`
  (`feature/library/.../LibraryLists.kt`).
- Top-level navigation (`navigateTopLevel` in `AppNavHost.kt`) pops back to
  Home and launches a single top instance per tab; it intentionally does not
  use `saveState`/`restoreState`, so tapping a tab always lands on that tab's
  root instead of a stale saved stack. The app content is keyed on the active
  account, so switching accounts starts a fresh navigation stack.
- Media actions are bottom sheets (the web drawer menu on touch), not dropdown
  menus; plain overflow menus without media context may still use
  `DropdownMenu`.
- The player keeps playback position out of `PlayerUiState`:
  `PlayerViewModel.progress` + `rememberPlaybackPosition()` interpolate between
  the engine's once-a-second progress events, and only `PlayerSeekBar` /
  `PlayerProgressLine` read it. The seek bar shows `WaveformBar` when the
  server-synced `progress-bar-style` is "waveform" (`PlayerUiState.showsWaveform`:
  flat bars while the song's waveform loads, like the web), and a `Slider` when
  the song has no waveform.
- The mini player's waveform deliberately lives *outside* the Material3
  `Surface` and is positioned with a placement-based `Modifier.offset`: a
  `Surface` clips hit testing, so a `graphicsLayer` overhang would draw above the
  bar but stay untouchable. Keep the waveform as a sibling of the `Surface` if
  you touch this layout.
- A `LazyVerticalGrid` item with multiple root layouts overlays them at the
  same origin, so wrap a multi-composable header slot in a single `Column`
  before placing it in a grid item.

---

## Common Tasks

### Adding a New API Endpoint
1. Add handler in the appropriate `src/api/*.rs` module
2. Add route in `src/api/routes.rs`
3. Create request/response structs with serde and `ts_rs` exports when used by the client
4. Add database queries or repository helpers if needed
5. **Write hurl tests** in `tests/hurl/`
6. Run tests: `cargo test`

### Adding a Frontend Feature
1. Implement component/page
2. **Write Playwright tests** in `client/e2e/`
3. Run tests: `moon run client:test-e2e`

### Adding a Database Field
1. Create migration in `migrations/NNN_description.sql`
2. Update model in `src/db/models.rs`
3. Update queries in `src/db/queries.rs`
4. Update response structs

---

## Extended Documentation

Read these when working on specific areas:

- **[docs/TESTING.md](docs/TESTING.md)** - Comprehensive testing guide with examples
- **[docs/ANDROID_EMULATOR.md](docs/ANDROID_EMULATOR.md)** - Android emulator interaction (ADB commands, nix shell, debugging)

---

## Resources

- [Hurl Documentation](https://hurl.dev/)
- [Axum Documentation](https://docs.rs/axum/latest/axum/)
- [Playwright Documentation](https://playwright.dev/)

## Further instructions

- Always use ts_rs for generating TypeScript types from Rust structs for API request/response data. Use the generated types in the frontend.
- Filtering and sorting logic is always implemented serverside, NEVER clientside. The server will anyway need to support filtering and sorting, since it's supposed to materialize playback queues from queueSource info so that we can efficiently start playback of giant track lists without loading everything clientside.
- Always use virtualization (react-virtual) and "infinite scroll" for lists showing data from the library (e.g., library views, playlists, queue, search results, etc.) to ensure good performance with large libraries.
- Always use moon tasks where applicable since these make use of caching
- The native Ferrotune API is JSON-only and mounted under `/api`.
- We're using React Compiler, so we do not need to use React.memo or useMemo/useCallback anywhere.
- After finishing your changes, run `moon run pre-ci` to ensure everything passes.
- Moon runs dependencies of tasks automatically, so you can just run the high-level tasks like `moon run pre-ci` or `moon run :test` and moon will take care of running e.g. code generation, linting, type checking etc. as needed.
- Run `moon query tasks` to get a list of moon tasks
- You can run similarily named client and server tasks with e.g. `moon run :fmt` to format both client and server code.
- i64 etc types get exported as bigint, you should just override this as number
- **Before implementing new functionality, check the "Shared Utilities" section above** for existing helpers. Use `src/api/common/` for backend and `client/src/components/shared/` for frontend shared code.
- When adding new shared functionality, update the "Shared Utilities" section in this file to document it for future agents.
- Avoid Promise.race in e2e tests, instead write the test for specific expected behavior.
- Avoid timeouts in tests, instead use proper waiting for elements or network requests.

## Legacy / backwards-compatibility code

This project has exactly one deployed user (the maintainer). It is almost never necessary to keep legacy code paths, shims, one-off data migrations, deprecated field fallbacks, or "just in case an old client does X" branches. **Before writing any such code, ask the user whether backwards compatibility is actually required.** Default to removing legacy code rather than preserving it. If in doubt, ask.

Examples of code that usually should be deleted rather than retained:
- One-shot data migrations guarded by a "migration_complete" flag (the migration has already run).
- Fallback code paths for old config/request/response shapes.
- Dual-writing to both old and new schemas.
- `#[deprecated]` wrappers with no internal callers.
