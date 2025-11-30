# AI Agent Instructions for Ferrotune

This document provides comprehensive guidance for AI agents working on the Ferrotune codebase.

## Project Overview

**Ferrotune** is an OpenSubsonic-compatible music server written in Rust. It enables users to stream their personal music libraries using any Subsonic/OpenSubsonic-compatible client application.

### Target Clients
- **Android**: Symfonium, Ultrasonic, Subtracks
- **iOS**: play:Sub, Amperfy, SubStreamer
- **Desktop**: Feishin, Sonixd, Submariner
- **Web**: Subplayer, Airsonic Refix

### Technology Stack
| Component | Technology |
|-----------|------------|
| Web Framework | Axum + Tokio async runtime |
| Database | SQLite with sqlx (compile-time checked) |
| Full-text Search | SQLite FTS5 |
| Metadata | lofty (pure Rust, MP3/FLAC/OGG/M4A) |
| Image Processing | image crate |
| Authentication | Argon2 (passwords), MD5 (token validation) |
| Task Runner | Moon (build, test, CI orchestration) |
| Testing | Hurl HTTP testing scripts |

### Architecture
Ferrotune runs two separate HTTP APIs:
1. **OpenSubsonic API** (default port 4040) - Client-facing API compatible with Subsonic ecosystem
2. **Ferrotune Admin API** (default port 4041) - Custom REST API for administration

---

## Project Structure

```
ferrotune/
├── src/
│   ├── main.rs              # CLI entry point, server startup
│   ├── config.rs            # Configuration loading
│   ├── error.rs             # Error types, HTTP error responses
│   ├── scanner.rs           # Music library scanner
│   ├── api/
│   │   ├── mod.rs           # AppState, shared types, route definitions
│   │   ├── subsonic/        # OpenSubsonic API endpoints
│   │   │   ├── auth.rs      # Authentication middleware
│   │   │   ├── browse.rs    # Browse endpoints (artists, albums, songs)
│   │   │   ├── coverart.rs  # Cover art endpoint
│   │   │   ├── lists.rs     # Album lists, random songs, scrobble
│   │   │   ├── playlists.rs # Playlist CRUD
│   │   │   ├── playqueue.rs # Play queue management (stub)
│   │   │   ├── query.rs     # Query string deserializers
│   │   │   ├── response.rs  # Response wrappers
│   │   │   ├── search.rs    # Search endpoint (FTS5)
│   │   │   ├── starring.rs  # Star, unstar, ratings
│   │   │   ├── stream.rs    # Audio streaming with range requests
│   │   │   ├── system.rs    # System endpoints (ping, license)
│   │   │   └── xml.rs       # XML serialization types
│   │   └── ferrotune/       # Ferrotune Admin API
│   │       ├── mod.rs       # Admin routes
│   │       └── scan.rs      # Scan endpoints
│   └── db/
│       ├── mod.rs           # Database connection pool, migrations
│       ├── models.rs        # Database row types
│       └── queries.rs       # SQL query functions
├── migrations/              # SQLite migrations (applied on startup)
├── tests/
│   ├── integration.rs       # Test runner with individual test functions
│   ├── common/mod.rs        # TestServer harness
│   ├── fixtures/music/      # Generated test audio files
│   └── hurl/                # Hurl HTTP test scripts
├── scripts/
│   └── generate-test-fixtures.sh  # Creates test audio with ffmpeg
├── Cargo.toml
├── config.example.toml
└── README.md
```

---

## OpenSubsonic API Implementation Status

### ✅ Implemented Endpoints (26)

#### System
- `ping` - Server health check
- `getLicense` - License info (always returns valid)
- `getOpenSubsonicExtensions` - Supported extensions
- `getMusicFolders` - Configured music directories

#### Browse
- `getArtists` - Artist index with album counts
- `getArtist` - Artist details with albums
- `getArtistInfo2` - Artist metadata ⚠️ stub (returns empty)
- `getAlbum` - Album with songs
- `getSong` - Single song details
- `getGenres` - Available genres

#### Media
- `stream` - Audio streaming with HTTP range requests
- `download` - File download
- `getCoverArt` - Album artwork

#### Annotation
- `star` - Star songs/albums/artists
- `unstar` - Remove stars
- `setRating` - Rate items 1-5 (0 removes rating)
- `getStarred` - List starred items
- `getStarred2` - List starred items (ID3 format)
- `scrobble` - Track play history

#### Lists
- `getAlbumList2` - Album lists by various criteria
- `getRandomSongs` - Random song selection

#### Search
- `search3` - Full-text search across library

#### Playlists
- `getPlaylists` - List all playlists
- `getPlaylist` - Playlist details with songs
- `createPlaylist` - Create new playlist
- `updatePlaylist` - Modify playlist
- `deletePlaylist` - Remove playlist

#### Play Queue ⚠️ Stub Implementation
- `savePlayQueue` - Save current play queue (returns success without persisting)
- `getPlayQueue` - Retrieve play queue (always returns empty)

### ❌ Missing Endpoints (Priority Order)

#### High Priority (Commonly used by clients)
| Endpoint | Purpose |
|----------|---------|
| `startScan` | Trigger library scan via API |
| `getScanStatus` | Check scan progress |
| `getIndexes` | Directory-based browsing |
| `getMusicDirectory` | Directory listing |
| `getAlbumList` | Non-ID3 album lists |
| `getSongsByGenre` | Filter songs by genre |

#### Medium Priority
| Endpoint | Purpose |
|----------|---------|
| `getAlbumInfo2` | External album metadata |
| `getArtistInfo` | External artist metadata |
| `getSimilarSongs2` | Song recommendations |
| `getTopSongs` | Top songs for artist |
| `getNowPlaying` | Currently playing |
| `getLyricsBySongId` | Song lyrics |

#### User Management
| Endpoint | Purpose |
|----------|---------|
| `getUser` | User details |
| `getUsers` | List all users |
| `createUser` | Create user |
| `updateUser` | Modify user |
| `deleteUser` | Remove user |
| `changePassword` | Password change |

#### Bookmarks
| Endpoint | Purpose |
|----------|---------|
| `getBookmarks` | Position bookmarks |
| `createBookmark` | Save position |
| `deleteBookmark` | Remove bookmark |

#### Sharing
| Endpoint | Purpose |
|----------|---------|
| `getShares` | Public share links |
| `createShare` | Create share |
| `updateShare` | Modify share |
| `deleteShare` | Remove share |

#### Low Priority
- Internet radio stations
- Podcasts
- Video support
- Chat (deprecated)
- Jukebox control

---

## Ferrotune Custom API

The Admin API runs on a separate port (default 4041) and provides modern REST endpoints.

### Current Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Health check with version |
| POST | `/scan` | Trigger library scan |
| GET | `/scan/status` | Scan progress ⚠️ stub |

### Planned Features
- Async scanning with WebSocket progress updates
- User management API
- Library statistics
- Configuration management
- Log viewing
- Backup/restore

### Design Philosophy
The Ferrotune API will eventually provide a complete alternative to the OpenSubsonic API with:
- Modern REST conventions
- Proper HTTP status codes
- JSON-only responses
- WebSocket support for real-time updates
- OpenAPI documentation

---

## Development Environment Setup

### Requirements
- Rust 1.91.0+ (specified in `rust-toolchain.toml`)
- SQLite 3.x
- ffmpeg (for test fixture generation)
- hurl (for integration tests)

### Quick Start with Moon (Recommended)
```bash
# Run all tests
moon run test

# Build release binary
moon run build

# Run specific test suites
moon run test-browse
moon run test-starring

# Full CI pipeline
moon run ci
```

### Using Nix
```bash
# Enter development shell with all dependencies
nix develop
```

### Manual Setup
```bash
# Install hurl
cargo install hurl

# Build project
cargo build --release

# Generate test fixtures
./scripts/generate-test-fixtures.sh
```

---

## Integration Testing

### Prerequisites
```bash
# Install hurl (HTTP testing tool)
cargo install hurl

# Generate test fixtures (requires ffmpeg)
./scripts/generate-test-fixtures.sh

# Build the binary
cargo build
```

### Running Tests
```bash
# Run all tests
cargo test

# Run specific test suite
cargo test test_starring_endpoints
cargo test test_browse_endpoints
cargo test test_search_endpoints

# Run with output
cargo test test_starring_endpoints -- --nocapture

# Run full integration test (all scripts sequentially)
cargo test test_full_integration -- --ignored
```

### Test Architecture

#### TestServer (`tests/common/mod.rs`)
The `TestServer` struct manages a complete isolated ferrotune instance:

1. **Port Allocation**: Automatically finds available ports
2. **Temp Directory**: Creates isolated environment with database and config
3. **Fixture Copying**: Copies test music files to temp directory
4. **Server Lifecycle**: Starts server, polls until ready, stops on drop
5. **Cleanup**: Removes all temp files when test completes

```rust
let server = TestServer::new()?;
server.scan_library()?;  // Populate database
// Server accessible at server.base_url
// Cleaned up automatically when dropped
```

#### Hurl Test Scripts (`tests/hurl/`)
Tests are written in **hurl** format - a declarative HTTP testing language.

Script naming convention: `NN_feature.hurl` where NN is ordering number.

| Script | Coverage |
|--------|----------|
| `01_system.hurl` | ping, getLicense, extensions, music folders |
| `02_auth.hurl` | Authentication methods, error cases |
| `03_browse.hurl` | Artists, albums, songs, genres |
| `04_streaming.hurl` | stream, download, cover art |
| `05_search.hurl` | search3 with various queries |
| `06_starring.hurl` | star, unstar, setRating, getStarred |
| `07_playlists.hurl` | Playlist CRUD operations |
| `08_lists.hurl` | Album lists, random songs, scrobble |
| `09_playqueue.hurl` | Play queue save/retrieve |

#### Test Fixtures (`tests/fixtures/music/`)
Generated audio files with full metadata:

```
Test Artist/
  Test Album/
    01 - Track One.mp3
    02 - Track Two.mp3
    03 - Track Three.mp3
Another Artist/
  Another Album/
    01 - Song A.flac
    02 - Song B.flac
Various Artists/
  Compilation Album/
    01 - Comp Track 1.mp3
    02 - Comp Track 2.mp3
```

Each file has unique frequency tones (for stream verification), embedded cover art, and complete ID3/Vorbis tags.

### Writing New Tests

#### Hurl Script Structure
```hurl
# Comment describing the test
GET {{base_url}}/rest/endpoint?u={{username}}&p={{password}}&v=1.16.1&c=hurl-test&f=json&param=value
HTTP 200
[Asserts]
header "Content-Type" contains "application/json"
jsonpath "$.subsonic-response.status" == "ok"
jsonpath "$.subsonic-response.data.field" exists
[Captures]
captured_value: jsonpath "$.subsonic-response.data.id"
```

#### Best Practices

1. **Test both formats**: Most endpoints should have XML and JSON tests
   ```hurl
   # JSON
   GET {{base_url}}/rest/ping?...&f=json
   jsonpath "$.subsonic-response.status" == "ok"
   
   # XML
   GET {{base_url}}/rest/ping?...&f=xml
   xpath "string(//*[local-name()='subsonic-response']/@status)" == "ok"
   ```

2. **Use captures for IDs**: Extract values to use in subsequent requests
   ```hurl
   [Captures]
   song_id: jsonpath "$.subsonic-response.randomSongs.song[0].id"
   
   # Later...
   GET {{base_url}}/rest/star?...&id={{song_id}}
   ```

3. **Verify required fields**: Check all OpenSubsonic-required fields exist
   ```hurl
   jsonpath "$.subsonic-response.song.id" exists
   jsonpath "$.subsonic-response.song.title" exists
   jsonpath "$.subsonic-response.song.coverArt" exists
   jsonpath "$.subsonic-response.song.artist" exists
   ```

4. **Test error cases**: Verify proper error responses
   ```hurl
   GET {{base_url}}/rest/getSong?...&id=nonexistent
   HTTP 404
   jsonpath "$.subsonic-response.status" == "failed"
   jsonpath "$.subsonic-response.error.code" exists
   ```

5. **Test idempotency**: Star/unstar operations should be idempotent
   ```hurl
   # Star twice - both should succeed
   GET {{base_url}}/rest/star?...&id={{song_id}}
   HTTP 200
   GET {{base_url}}/rest/star?...&id={{song_id}}
   HTTP 200
   ```

6. **Verify state changes**: Check that operations actually change state
   ```hurl
   # Star, then verify starred appears
   GET {{base_url}}/rest/star?...&id={{song_id}}
   HTTP 200
   
   GET {{base_url}}/rest/getSong?...&id={{song_id}}
   jsonpath "$.subsonic-response.song.starred" exists
   ```

#### Available Variables
Tests receive these variables from the test harness:
- `{{base_url}}` - Server URL (e.g., `http://127.0.0.1:31518`)
- `{{username}}` - Admin username
- `{{password}}` - Admin password  
- `{{password_hex}}` - Hex-encoded password (for token auth)

#### Adding a New Test File
1. Create `tests/hurl/NN_feature.hurl`
2. Add test function in `tests/integration.rs`:
   ```rust
   #[test]
   fn test_feature_endpoints() {
       if !hurl_available() { return; }
       if !fixtures_exist() { return; }
       
       let server = TestServer::new().expect("Failed to start test server");
       server.scan_library().expect("Failed to scan library");
       
       run_hurl_script(&server, &hurl_script("NN_feature.hurl"))
           .expect("Feature endpoint tests failed");
   }
   ```
3. Add to `test_full_integration` script list

---

## Database Schema

### Core Tables
| Table | Purpose |
|-------|---------|
| `users` | User accounts with Argon2 password hashes |
| `api_keys` | API authentication tokens |
| `music_folders` | Configured music directories |
| `artists` | Artist metadata (name, sort name, album count) |
| `albums` | Album metadata (artist link, year, genre, stats) |
| `songs` | Track metadata (album/artist links, file info) |
| `starred` | User favorites (type: song/album/artist) |
| `ratings` | User ratings 1-5 scale |
| `playlists` | Playlist metadata |
| `playlist_songs` | Playlist track positions |
| `scrobbles` | Play history tracking |
| `songs_fts` | FTS5 full-text search index |

### Key Constraints
- `starred.item_type` IN ('song', 'album', 'artist')
- `ratings.rating` BETWEEN 1 AND 5
- Foreign keys with CASCADE delete
- Unique constraints prevent duplicates

### Adding Migrations
Create `migrations/NNN_description.sql` with schema changes. Migrations run automatically on server startup via `sqlx::migrate!()`.

---

## Code Conventions

### Query Parameter Deserialization
The OpenSubsonic API has quirks where parameters can be single values OR arrays. Use the custom deserializers in `query.rs`:

```rust
#[derive(Deserialize)]
pub struct MyParams {
    #[serde(default, deserialize_with = "first_string_or_none")]
    id: Option<String>,
    
    #[serde(default, deserialize_with = "string_or_seq")]
    ids: Vec<String>,
    
    #[serde(deserialize_with = "first_i32")]
    rating: i32,
}
```

### Response Format
Endpoints must support both JSON and XML. Use `FormatResponse`:

```rust
pub async fn my_endpoint(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<MyParams>,
) -> Result<FormatResponse<MyResponse>> {
    let response = MyResponse { /* ... */ };
    Ok(FormatResponse::new(user.format, response))
}
```

For XML, implement `ToXml` trait in `xml.rs`.

### Authentication Flow
Authentication uses the `AuthenticatedUser` extractor in `src/api/subsonic/auth.rs`. Three methods in precedence order:

1. **API Key** (preferred): `?k=<token>` - Checked against `api_keys` table
2. **Token + Salt**: `?t=<hash>&s=<salt>` - MD5(password + salt) validation
3. **Plain Password**: `?p=<password>` - Direct comparison (legacy, testing only)

The extractor validates API version compatibility and returns structured errors for missing/invalid credentials. API key auth is mutually exclusive with token/password methods per OpenSubsonic spec.

### Error Handling
Use the `Error` enum in `error.rs`. Different error types map to appropriate HTTP status codes and Subsonic error codes:

```rust
Error::NotFound(msg) -> (404, code 70)
Error::InvalidRequest(msg) -> (400, code 10)
Error::Unauthorized(msg) -> (401, code 40)
```

### Database Query Patterns
Query functions in `src/db/queries.rs` follow these conventions:

- **`fetch_one`** - Returns single row, errors if not found or multiple results
- **`fetch_optional`** - Returns `Option<T>`, None if not found
- **`fetch_all`** - Returns `Vec<T>`, empty vec if no results
- **`execute`** - For INSERT/UPDATE/DELETE, returns rows affected

Use compile-time checked queries with `sqlx::query_as!` macro. Add indexes for foreign keys and frequently filtered columns.

---

## Development Workflow

### Building
```bash
# Using Moon (recommended)
moon run build          # Release build
moon run build-dev      # Debug build

# Using Cargo directly
cargo build             # Debug build
cargo build --release   # Release build
cargo check             # Type check only (faster)
```

### Running
```bash
# With example config
cargo run -- --config config.example.toml serve

# Scan library
cargo run -- --config config.example.toml scan

# Create user
cargo run -- --config config.example.toml create-user \
    --username alice --password secret --admin
```

### Testing
```bash
# Using Moon (recommended)
moon run test              # All tests
moon run test-browse       # Browse endpoints
moon run test-starring     # Starring endpoints
moon run ci                # Full CI pipeline

# Using Cargo directly
./scripts/generate-test-fixtures.sh  # Generate fixtures first
cargo test
cargo test test_starring_endpoints -- --nocapture
```

### Logging
Set `RUST_LOG` for detailed output:
```bash
RUST_LOG=debug cargo run -- serve
RUST_LOG=ferrotune=trace cargo run -- serve
```

---

## Common Tasks for AI Agents

### Adding a New OpenSubsonic Endpoint
1. Add handler function in appropriate `src/api/*.rs` file
2. Add route in `src/api/mod.rs`
3. Create request/response structs with proper serde attributes
4. Implement `ToXml` for XML response format
5. Add database queries in `src/db/queries.rs` if needed
6. Write hurl tests in `tests/hurl/`
7. Update this document's implementation status

### Adding a Database Field
1. Create migration in `migrations/NNN_description.sql`
2. Update model in `src/db/models.rs`
3. Update queries in `src/db/queries.rs`
4. Update response structs in relevant endpoint files
5. Update XML types if needed

### Debugging Test Failures
1. Run with `--nocapture` to see server output
2. Check the hurl script line number in error message
3. Manually test endpoint with curl if needed:
   ```bash
   curl "http://localhost:4040/rest/endpoint?u=admin&p=admin&v=1.16.1&c=test&f=json"
   ```

---

## Resources

- [OpenSubsonic API Spec](https://opensubsonic.netlify.app/)
- [Subsonic API Spec](http://www.subsonic.org/pages/api.jsp)
- [Hurl Documentation](https://hurl.dev/)
- [Axum Documentation](https://docs.rs/axum/latest/axum/)
- [sqlx Documentation](https://docs.rs/sqlx/latest/sqlx/)

# Development guidelines

- Write integration and playwright tests for any new features
- Update existing tests where needed
- Run tests after implementation is complete and fix any problems
