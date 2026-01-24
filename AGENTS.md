# AI Agent Instructions for Ferrotune

## Project Overview

**Ferrotune** is an OpenSubsonic-compatible music server written in Rust with a Next.js web client. It enables users to stream their personal music libraries using any Subsonic-compatible client application.

### Technology Stack
| Component | Technology |
|-----------|------------|
| Backend | Rust, Axum, SQLite (sqlx), Tokio |
| Frontend | Next.js, React, TailwindCSS, Jotai |
| Testing | Hurl (backend), Playwright (frontend) |
| Task Runner | Moon |

### Architecture
- **OpenSubsonic API** (`/rest` port 4040) - Client-facing API for Subsonic ecosystem
- **Admin API** (`/ferrotune` port 4040) - REST API for administration
- **Web Client** (`client/`) - Next.js web interface

---

## Project Structure

```
ferrotune/
├── src/                      # Rust backend
│   ├── main.rs               # CLI entry point
│   ├── api/subsonic/         # OpenSubsonic endpoints
│   ├── api/ferrotune/        # Admin API
│   └── db/                   # Database queries
├── client/                   # Next.js frontend
│   ├── src/app/              # App router pages
│   ├── src/components/       # React components
│   ├── src/lib/              # Utilities, API client, store
│   └── e2e/                  # Playwright tests
├── migrations/               # SQLite migrations
├── tests/                    # Backend integration tests
│   ├── hurl/                 # Hurl HTTP test scripts
│   └── fixtures/             # Test audio files
└── docs/                     # Extended documentation
    ├── API_STATUS.md         # Endpoint implementation status
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
moon run client:build       # Build Next.js client
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

---

## Testing Requirements

**Every implementation must include tests. Follow this workflow:**

1. **Implement** the feature
2. **Write tests** - Hurl for backend, Playwright for frontend
3. **Run tests** - Verify they pass
4. **Fix failures** - Iterate until green
5. **Commit** - Only when tests pass

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

**Response Format**: Endpoints support both JSON and XML via `FormatResponse`:
```rust
pub async fn endpoint(user: AuthenticatedUser, ...) -> Result<FormatResponse<Response>> {
    Ok(FormatResponse::new(user.format, response))
}
```

**Authentication**: Uses `AuthenticatedUser` extractor. Three methods:
1. API Key: `?k=<token>`
2. Token + Salt: `?t=<hash>&s=<salt>`
3. Plain Password: `?p=<password>` (testing only)

**Error Handling**: Use `Error` enum in `error.rs`:
- `Error::NotFound(msg)` → 404
- `Error::InvalidRequest(msg)` → 400
- `Error::Unauthorized(msg)` → 401

**Query Parameters**: Use custom deserializers in `query.rs` for Subsonic's quirky parameter handling (single values OR arrays).

### Frontend (Next.js)

**State Management**: Jotai atoms in `src/lib/store/`
**API Client**: `src/lib/api/client.ts` wraps OpenSubsonic calls
**Components**: Shadcn/ui components in `src/components/ui/`

---

## Shared Utilities (Code Reuse)

**IMPORTANT**: Before implementing new functionality, check if shared utilities exist. Avoid duplicating code.

### Backend Shared Modules (`src/api/common/`)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `utils.rs` | Common formatting utilities | `format_datetime_iso()`, `format_datetime_iso_ms()`, `get_content_type_for_format()`, `parse_inline_images()` |
| `starring.rs` | Star/favorite and rating operations | `star_items()`, `unstar_items()`, `set_item_rating()`, `fetch_starred_content()`, `get_starred_map()`, `get_ratings_map()` |
| `history.rs` | Play history operations | `fetch_play_history()` |
| `playqueue.rs` | Queue utilities | `find_current_index()` |
| `browse.rs` | Browse operations | `get_artists_logic()`, `get_album_logic()`, `song_to_response()`, `song_to_response_with_stats()` |
| `lists.rs` | List generation | `get_album_list_logic()`, `get_random_songs_logic()`, `get_songs_by_genre_logic()` |
| `search.rs` | Search operations | `search_artists()`, `search_albums()`, `search_songs()` |
| `sorting.rs` | Server-side sorting | `filter_and_sort_songs()` |

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
const endpoint = buildEndpoint(`/ferrotune/artists/${id}`, {
  sort: options?.sort,
  sortDir: options?.sortDir,
  filter: options?.filter,
});

// ❌ Bad - Don't manually construct URLSearchParams
const params = new URLSearchParams();
if (options?.sort) params.set("sort", options.sort);
// ... repeated code
```

### Frontend Hooks (`client/src/lib/hooks/`)

| Hook | Purpose |
|------|---------|
| `use-album-actions.ts` | Album playback/queue/starring actions |
| `use-artist-actions.ts` | Artist playback/queue/starring actions |
| `use-song-actions.ts` | Song playback/queue/starring/rating actions |
| `use-star.ts` | Generic starring state management |

---

## Common Tasks

### Adding a New OpenSubsonic Endpoint
1. Add handler in `src/api/subsonic/*.rs`
2. Add route in `src/api/mod.rs`
3. Create request/response structs with serde
4. Implement `ToXml` trait for XML support
5. Add database queries if needed
6. **Write hurl tests** in `tests/hurl/`
7. Run tests: `cargo test`

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

- **[docs/API_STATUS.md](docs/API_STATUS.md)** - OpenSubsonic endpoint implementation status
- **[docs/TESTING.md](docs/TESTING.md)** - Comprehensive testing guide with examples

---

## Resources

- [OpenSubsonic API Spec](https://opensubsonic.netlify.app/)
- [Hurl Documentation](https://hurl.dev/)
- [Axum Documentation](https://docs.rs/axum/latest/axum/)
- [Playwright Documentation](https://playwright.dev/)

## Further instructions

- After implementing a feature, suggest a conventional commits compliant commit message summarizing the change.
- Always use ts_rs for generating TypeScript types from Rust structs for API request/response data. Use the generated types in the frontend.
- Filtering and sorting logic is always implemented serverside, NEVER clientside. The server will anyway need to support filtering and sorting, since it's supposed to materialize playback queues from queueSource info so that we can efficiently start playback of giant track lists without loading everything clientside.
- Always use virtualization (react-virtual) and "infinite scroll" for lists showing data from the library (e.g., library views, playlists, queue, search results, etc.) to ensure good performance with large libraries.
- Always use moon tasks where applicable since these make use of caching
- Only opensubsonic API endpoints need to support both JSON and XML responses. The ferrotune API is JSON-only. We should keep the opensubsonic API compatible with the spec as much as possible. If there's anything requiring out of spec behaviour, we should create a ferrotune-specific endpoint instead and implement the behaviour there.
- We're using React Compiler, so we do not need to use React.memo or useMemo/useCallback anywhere.
- Don't add linter ignores, instead fix the underlying issue.
- After finishing your changes, run `moon run pre-ci` to ensure everything passes.
- Moon runs dependencies of tasks automatically, so you can just run the high-level tasks like `moon run pre-ci` or `moon run :test` and moon will take care of running e.g. code generation, linting, type checking etc. as needed.
- Run `moon query tasks` to get a list of moon tasks
- You can run similarily named client and server tasks with e.g. `moon run :fmt` to format both client and server code.
- i64 etc types get exported as bigint, you should just override this as number
- Try to reuse code when feasible. If the user refers to replicating some other functionality, or if there are any existing implementations using similar logic, you should aim to share code between these functionalities/implementations by e.g. extracting code into utility functions.
- **Before implementing new functionality, check the "Shared Utilities" section above** for existing helpers. Use `src/api/common/` for backend and `client/src/components/shared/` for frontend shared code.
- When adding new shared functionality, update the "Shared Utilities" section in this file to document it for future agents.
- Avoid Promise.race in e2e tests, instead write the test for specific expected behavior.
- Avoid timeouts in tests, instead use proper waiting for elements or network requests.

## TODO list files

When asking to complete batches from a TODO list file, complete items from top to bottom regardless of complexity. Mark the items as done when progressing. After completing a batch, check if there are any new items in the referenced TODO file, and if so, begin working on those. Loop until there are no more items left to complete in the referenced TODO file batch.

## After task completion

- Read the TODO.md file, see if any tasks are present. If so, continue working on these tasks before handing control back to the user. Each time after completing a task (even if the last one), check the TODO.md file again and loop until no tasks remain. Mark the tasks as done (by ticking the checkbox, not deleting the TODO entry) when progressing.