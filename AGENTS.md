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
moon run android:generate-bindings # regenerate Kotlin DTOs from ts-rs TS output
```

`android:install-debug` installs through the platform-tools `adb` and honors
`ANDROID_ADB_SERVER_ADDRESS` (and `ANDROID_SERIAL`) from the environment, so a
remote adb server works; Gradle's own `installDebug` cannot see remote
devices and is no longer used.

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
| `android/core/media/PlaybackRepository.kt` | App-scoped front end for `PlaybackService`; binds on first use, mirrors state to flows, exposes suspend commands | `state: StateFlow<PlaybackState>`, `events: SharedFlow<PlaybackEvent>`, `initSession()`, `startPlayback()`, `play()`, `pause()`, `nextTrack()`, `previousTrack()`, `seek()`, `applySettings()` |
| `android/core/media/PlaybackSettingsRepository.kt` | Server-synced playback preferences (ReplayGain mode/offset, transcoding enabled/bitrate, progress bar style under the web client's `progress-bar-style` key) applied to the engine via `PlaybackSettingsApplier`; defaults computed/0/computed/192/waveform | `settings: StateFlow<PlaybackSettings>`, `ensureLoaded()`, `load()`, `invalidate()`, `setReplayGainMode()`, `setReplayGainOffset()`, `setTranscodingEnabled()`, `setTranscodingBitrate()`, `setProgressBarStyle()`, `DEFAULT_PROGRESS_BAR_STYLE`, `PROGRESS_BAR_STYLES` |
| `android/core/media/WaveformRepository.kt` | App-scoped fetch/cache for `GET /api/songs/{id}/waveform` normalized bar heights; LRU-capped (24) with in-flight deduplication so player surfaces can render the waveform progress bar | `heights(songId): List<Float>`, `clear()` |
| `android/core/media/cast/CastManager.kt` | Cast sender port of the legacy `NativeCastManager` with StateFlow state/status, queue loading, transport, and volume; no hidden route-button hack (UI owns `MediaRouteButton`) | `state: StateFlow<CastConnectionState>`, `status: StateFlow<CastMediaStatus>`, `initialize()`, `loadQueue()`, `play()`, `pause()`, `next()`, `previous()`, `seek()`, `setVolume()`, `endSession()` |
| `android/core/media/CastUrls.kt` | Pure helpers for external-player URLs: appends media URL tokens, maps Opus streams to an OGG content type | `appendUrlToken()`, `castContentType()`; `PlaybackService.castMediaItems()` / `PlaybackRepository.castMediaItems()` build the receiver queue (stream + cover URLs with a media URL token from `ensureMediaUrlToken()`) |
| `android/feature/player/CastRouteButton.kt` | Compose wrapper around the Cast `MediaRouteButton`; `PlayerViewModel` routes transport to `CastManager` while connected and shows "Casting to <device>" with a disconnect action | `CastRouteButton()` |
| `android/app/.../CastOptionsProvider.kt` | Cast options using the default media receiver, registered via the `OPTIONS_PROVIDER_CLASS_NAME` manifest meta-data | `CastOptionsProvider` |
| `android/core/media/PlaybackEvent.kt` | Typed playback events (replaces JSON-over-WebView payloads) | `StateChanged`, `Progress`, `TrackChanged`, `PlaybackError`, `QueueStateChanged`, `StarToggled`, ... |
| `android/feature/player/QueueSheet.kt` + `NowPlayingScreen.kt` + `MiniPlayerBar.kt` | Queue sheet (cover rows, now-playing highlight, long-press drag-handle reorder, per-row play/move/remove menu, shuffle/repeat/clear), full-screen player content (seeded backdrop, interactive waveform or slider seek, favorite action, queue button), and mini player (tap or swipe up to expand, swipe sideways to skip, non-interactive waveform strip) | `QueueSheet()`, `NowPlayingScreen()`, `MiniPlayerBar()` |
| `android/feature/player/NowPlayingSheetState.kt` + `NowPlayingOverlay.kt` | Hoisted now-playing overlay state machine (offset follow, 25% dismiss threshold, animated open/close, prev/next skip) and the app-level overlay composable (scrim tap-to-dismiss, back handling, axis-locked drag gestures, haptics); the app shell renders it above the mini player instead of a route | `NowPlayingSheetState`, `rememberNowPlayingSheetState()`, `NowPlayingOverlay()` |
| `android/core/media/AudioState.kt` + `FerrotuneApiClient.kt` | `TrackInfo` carries the current track's `starred` flag parsed from queue-window `QueueSong` JSON, so player surfaces can show and mutate favorite state | `TrackInfo`, `QueueSong`, `parseSong()`, `songToTrackInfo()` |
| `android/core/datastore/AccountStore.kt` | Encrypted account persistence plus stable device identity | `accounts`, `activeAccount`, `upsert()`, `setActive()`, `clientId()` |
| `android/core/network/FerrotuneApi.kt` | Retrofit native API surface bound to a server URL/token | `login()`, `me()`, `refresh()`, `logout()`, `connectSession()`, `startQueue()`, `randomSongs()`, `search()`, `artist*`, `album*`, `song*`, `songIds()`, `sourceSongIds()`, `genres()`, `history()`, `star()`, `setRating()`, `addToQueue()` |
| `android/core/network/AuthenticatedApiProvider.kt` | Caches the active account's `FerrotuneApi` and `Account`; also backs the app-wide authenticated OkHttp client for Coil | `requireApi()`, `requireAccount()` |
| `android/core/network/QueryMap.kt` | Converts generated query DTOs into Retrofit `@QueryMap` parameters, omitting nulls | `toQueryMap()` |
| `android/core/network/ConnectivityMonitor.kt` | Validated-network connectivity state; drives the global offline banner and offline-aware UI | `isOnline: StateFlow<Boolean>` (interface `ConnectivityMonitor`, impl `AndroidConnectivityMonitor`) |
| `android/core/media/PlaybackSessionStarter.kt` | Connects a playback session and materializes queues (library, album, artist, genre, favorites, history, search, song radio, explicit song IDs, plus next/end additions; additions without an active session start a queue instead) | `QueueStartSpec`, `QueueAddSpec`, `startQueue()`, `startRandomQueue()`, `startAlbum()`, `startArtist()`, `startSongRadio()`, `addToQueue()`, `queueSort()`; ViewModels inject the `PlaybackStarter` interface so tests can fake it |
| `android/core/actions/SongActions.kt` | Shared song action menu (favorite, play next, add to queue, song radio, start-selection, extra slots) backed by a Hilt entry point so any feature module can drop in row/top-bar actions | `SongActionsEntryPoint`, `rememberSongFlags()`, `SongActionsViewModel` (`toggleStar`, `setStarredBulk`, `loadAllIds`, `playNext`, `addToQueue`), `SongMenuItems`, `SongRowMenu`, `SongFavoriteButton`, `SongActionsMenuContent` |
| `android/core/actions/CollectionActions.kt` | Shared long-press menus for album/artist/playlist collections: resolves a `CollectionTarget` source descriptor into play/shuffle/play-next/add-to-queue commands, with an optional "Go to artist" item and feature `extraItems` | `CollectionSource`, `CollectionTarget`, `CollectionActionsViewModel` (`play`, `shuffle`, `playNext`, `addToQueue`), `CollectionMenuItems()` |
| `android/core/actions/SongSelection.kt` | Screen-local multi-select for song lists: count/select-all top bar and bottom action bar (play next, queue, favorite/unfavorite + feature slots), with select-all resolved server-side via `/songs/ids` or `/sources/song-ids` | `SongSelectionState`, `rememberSongSelectionState()`, `SongSelectionTopBar`, `SongSelectionActionBar`, `SongSelectionAction` |
| `android/core/actions/SongFlagsStore.kt` | Optimistic starred overlay over API mutations with rollback on failure; bulk starring merges overrides without clobbering other songs | `SongFlags`, `SongFlagsOverride`, `SongFlagsStore`, `setStarred()`, `setStarredBulk()`, `clear()` |
| `android/feature/library/LibraryRepository.kt` + `LibraryPagingSources.kt` | Paged browse/search/history reads and starring mutations; requests `inlineImages=medium` cover art in browse/search/history params so list rows render artwork without extra fetches; server-side sort/filter keys | `songs()`, `albums()`, `artists()`, `albumSongs()`, `artistSongs()`, `artistAlbums()`, `history()`, `genres()`, `similarSongs()`, `setStarred()`, `INLINE_IMAGES` |
| `android/feature/library/LibraryViewPreferencesRepository.kt` | Server-synced per-tab library sort preferences stored as JSON under the native-only `library-sort-native` key (the shared `library-sort` key belongs to the web/Tauri client and must not be clobbered) | `sort: StateFlow<LibrarySortConfig>`, `ensureLoaded()`, `load()`, `invalidate()`, `setSongSort()`, `setAlbumSort()`, `setArtistSort()` |
| `android/feature/playlists/PlaylistRepository.kt` + `PlaylistPagingSources.kt` | Playlist folders, playlists, smart playlists, shares, membership, song search, and music folders for rule fields | `folders()`, `createFolder()`, `updateFolder()`, `movePlaylist()`, `playlistSongs()`, `addSongs()`, `removeSongs()`, `moveEntry()`, `shares()`, `setShares()`, `smartPlaylists()`, `materializeSmartPlaylist()`, `musicFolders()`, `searchSongs()` |
| `android/feature/playlists/PlaylistFolderTree.kt` | Builds the folder hierarchy the playlist browser renders (position/name ordering, orphan fallback) | `buildPlaylistTree()`, `PlaylistFolderNode`, `PlaylistTree` |
| `android/feature/playlists/SmartPlaylistRules.kt` | Smart playlist rule field/operator descriptors plus `SmartConditionDraft` ⇄ `SmartPlaylistConditionApi` value conversion | `ruleFields()`, `operatorsFor()`, `SmartConditionDraft.toApiCondition()`, `SmartPlaylistConditionApi.toDraft()` |
| `android/feature/playlists/AddToPlaylistDialog.kt` | Overflow action/menu item + dialog for adding song IDs to an editable playlist; hosts its own Hilt VM so any feature can use it | `AddToPlaylistAction()`, `AddToPlaylistMenuItem()`, `AddToPlaylistDialog()` |
| `android/feature/home/HomeRepository.kt` | Home dashboard per-section reads, stats, and listening review reads | `continueListening()`, `mostPlayedRecently()`, `forgottenFavorites()`, `albumList()`, `similarTracks()`, `playlistSongs()`, `smartPlaylistSongs()`, `stats()`, `listeningStats()`, `periodReview()` |
| `android/feature/home/HomeSectionLoader.kt` | Loads one dashboard section's preview items, honoring its configured filters | `load(section, size)`, `HomeSectionData` |
| `android/feature/home/HomeLayoutPreferencesRepository.kt` | Server-synced dashboard layout stored under the web/Tauri client's `home-tiles-v1` / `home-sections-v1` keys so both clients stay in sync | `tiles`, `sections`, `ensureLoaded()`, `load()`, `invalidate()`, `setTiles()`, `setSections()` |
| `android/feature/home/HomeTilePresentation.kt` | Tile/section presentation and queue-source mapping matching the web client, plus `HomeLinkTarget` navigation targets | `homeTilePresentation()`, `homeSectionQueueSpec()`, `homeSectionLabel()`, `homeSectionIcon()` |
| `android/feature/home/HomePlaylistChoicesRepository.kt` | Playlist + smart-playlist choices for the Home layout editors | `choices()`, `HomePlaylistChoice` |
| `android/feature/home/HomeLayoutSettingsViewModel.kt` + `HomeLayoutSettingsScreen.kt` + `HomeLayoutSettingsPresentation.kt` | Settings → Home editor for tiles (add/edit/reorder/remove, playlist and account pickers) and sections (enable/edit/reorder/remove playlist sections, per-kind settings) | `HomeLayoutSettingsScreen`, `HomeLayoutSettingsViewModel`, `homeTileKindLabel()`, `homeSectionDescription()`, `homeSectionHasSettings()` |
| `android/feature/player/QueueRepository.kt` | Server-side queue window reads and edits for the queue sheet; mutations flow back through SSE | `loadQueue()`, `removeEntry()`, `clear()`, `moveEntry()`, `setShuffled()`, `setRepeatMode()`, `QueueSnapshot`, `QueueEntry` |
| `android/core/network/paging/OffsetPagingSource.kt` | Shared offset-keyed Paging 3 base for endpoints that report totals | `OffsetPagingSource`, `DEFAULT_PAGE_SIZE` |
| `android/core/database/` | Room store for download metadata: `DownloadedSongEntity`, `DownloadedContainerEntity`, junction membership, `DownloadDao` (`songs()`, `containersWithCount()`, `containerSongIds()`, `pruneEmptyContainers()`, ...), `DownloadDatabase` | `DownloadContainerType`, `SongResponse.toDownloadedSong()` |
| `android/core/media/DownloadEngine.kt` | Testable surface over Media3 `DownloadManagerHolder` (enqueue/cancel/pause/resume/removeAll/wifi-only + event flow) | `DownloadEngine`, `Media3DownloadEngine` |
| `android/core/media/OfflineQueueSource.kt` | Materializes a local queue when the server is unreachable; consumed by `PlaybackSessionStarter.startQueue` fallback | `offlineQueue(sourceType, sourceId, startSongId)` |
| `android/feature/downloads/DownloadRepository.kt` | Download state (engine snapshot + events) and persisted song/container metadata; container downloads page through album/playlist/smart-playlist APIs | `enqueueSong()`, `downloadAlbum()`, `downloadPlaylist()`, `downloadSmartPlaylist()`, `removeSong()`, `removeContainer()`, `clearAll()`, `downloadedSongIds`, `downloadedContainerIds` |
| `android/feature/downloads/DownloadSettingsRepository.kt` | Server-synced download preferences (`downloadFormat`, `downloadBitrate`, `downloadWifiOnly`) applied to the engine; defaults opus/128/no restriction | `settings: StateFlow<DownloadSettings>`, `ensureLoaded()`, `setFormat()`, `setBitRate()`, `setWifiOnly()` |
| `android/feature/downloads/OfflineQueue.kt` | Builds `GetQueueResponse` from Room metadata and implements `OfflineQueueSource` (container order, start-song index; non-container sources fail gracefully like the web materializer) | `materializeOfflineQueue()`, `RoomOfflineQueueSource` |
| `android/feature/downloads/ui/` | Downloads screen (songs + saved containers, pause/resume/clear all), `SongDownloadAction` row icon, `SongDownloadMenuItem` overflow item, `ContainerDownloadAction` top-bar action, `DownloadActionViewModel.downloadSongs()` for bulk selections | `DownloadsScreen`, `SongDownloadAction`, `SongDownloadMenuItem`, `ContainerDownloadAction`, `DownloadActionViewModel`, `ContainerDownloadType` |
| `android/feature/settings/ui/` | Settings screen: account info/sign-out, theme mode (system/light/dark), accent color (presets + custom OKLCH sliders), Home layout, playback (ReplayGain, transcoding), downloads (format/bitrate/Wi-Fi only) | `SettingsScreen`, `SettingsViewModel` |
| `android/feature/settings/AccentSettingsRepository.kt` | Server-synced accent color: preset name from `accentColor`, custom OKLCH values from the preference fields; `AppViewModel` applies it via `FerrotuneTheme(accent = ...)` | `state: StateFlow<AccentState>`, `ensureLoaded()`, `load()`, `invalidate()`, `setPreset()`, `setCustom()` |
| `android/core/designsystem/theme/AccentPalette.kt` | OKLCH→sRGB conversion (port of the web `oklchToRgb`), web-matching presets, custom clamping, and Material3 scheme derivation | `OklchColor`, `AccentColors`, `oklchToColor()`, `FerrotuneTheme(accent = ...)` |
| `android/core/designsystem/theme/Type.kt` + `Shape.kt` | Bundled Inter font family (matches the web client) with the shared typography scale, plus the app-wide rounded shape scale | `InterFamily`, `FerrotuneTypography`, `FerrotuneShapes` |
| `android/core/designsystem/theme/GradientPalette.kt` | Deterministic seed-based gradient colors used for artwork fallbacks and detail/now-playing backdrops | `seedGradient()`, `seedGradientBrush()`, `SeedGradient` |
| `android/core/datastore/ThemePreferencesRepository.kt` | Device-level theme mode persisted in a `ferrotune_ui` DataStore; `ThemeModeStore` interface keeps ViewModels testable | `ThemeModeStore`, `ThemePreferencesRepository`, `themeMode`, `setThemeMode()` |
| `android/core/testing/FakeFerrotuneApi.kt` | Shared `FerrotuneApi` test double with per-endpoint handler lambdas; consumed as `testImplementation(project(":core:testing"))` | `FakeFerrotuneApi`, `FakeApiProvider`, `FakeAccounts`, `FakeAccountSwitcher`, `testAccount()`, `FakePlaybackStarter` |
| `android/core/designsystem/components/` | Shared Compose building blocks | `CoverArt` (seeded gradient fallback), `MediaCard`/`ShelfCard` (shelf + grid cards with play overlay and long-press menu hook), `MediaRow` (circular-cover and multi-select support), `SectionHeader`, `DetailHeader` (gradient detail header with badges/actions), `FavoriteButton` (filled/outline heart), `WaveformBar` (seekable bar strip with tap/drag scrubbing), `ShimmerBox`/`MediaRowSkeletonList`/`MediaCardSkeleton`, `SortMenu`, `PagingListFooter`, `ErrorState`, `EmptyState`, `LoadingState` |

### Native Android UI Conventions

- Chrome screens (Home, Library, Playlists, Search) and the app shell set
  `contentWindowInsets = WindowInsets(0)`; detail screens keep default insets and
  rely on `TopAppBar`/`Scaffold`. Do not add manual status-bar padding.
- Song rows open the shared `SongMenuItems` menu on long-press; while a selection
  is active, long-press toggles selection instead. The menu's "Select" item
  (`Icons.Filled.Checklist`) starts selection.
- Player surfaces render `WaveformBar` when a song has waveform data and fall back
  to `LinearProgressIndicator`/`Slider` otherwise; the choice follows the
  server-synced `progress-bar-style` preference.

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
