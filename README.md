# Ferrotune Music Server

An OpenSubsonic-compatible music server written in Rust.

## Features

- **OpenSubsonic API** - Full JSON API support for music clients
- **Tokio-based async I/O** - High performance asynchronous operations
- **Metadata extraction** - Reads ID3 tags from MP3, FLAC, OGG, M4A files using lofty
- **SQLite database** - Embedded database with full-text search (FTS5)
- **Multiple authentication methods** - API keys, token+salt, password (with Argon2 hashing)
- **User management** - Multi-user support with admin capabilities
- **Cover art** - Extraction and serving of album artwork
- **Playlists** - Support for M3U/XSPF playlist formats
- **Favorites** - Star/unstar songs, albums, and artists
- **Search** - Full-text search across songs, albums, and artists

## Quick Start

### 1. Configuration

Create a config file at `~/.config/ferrotune/config.toml`:

```bash
mkdir -p ~/.config/ferrotune
cp config.example.toml ~/.config/ferrotune/config.toml
```

Edit the configuration and set your music folder paths:

```toml
[[music.folders]]
name = "Music"
path = "/path/to/your/music"
```

### 2. Build and Run

With Nix:
```bash
nix develop -c cargo build --release
```

Or with Cargo directly:
```bash
cargo build --release
```

Then run the server:
```bash
ferrotune serve
# Or specify the full path: ./target/release/ferrotune serve
```

### 3. Scan Your Music Library

```bash
# Preview what would change (recommended first time)
ferrotune scan --dry-run

# Incremental scan (add new files, remove deleted)
ferrotune scan

# Full rescan (also refresh metadata for existing files)
ferrotune scan --full
```

### 4. Create Additional Users

```bash
ferrotune create-user \
  --username newuser \
  --password secret \
  --email user@example.com
```

### 5. Connect a Client

Configure your Subsonic-compatible music client with:
- **Server URL**: `http://localhost:4040/rest`
- **Username**: Your admin username
- **Password**: Your admin password
- **API Version**: 1.16.1 or higher

## CLI Commands

```bash
# Start the server (default command)
ferrotune serve --host 0.0.0.0 --port 4040

# Scan music library
ferrotune scan              # Incremental scan (new/modified/deleted files)
ferrotune scan --full       # Full rescan (refresh all metadata)
ferrotune scan --folder 1   # Scan specific folder
ferrotune scan --dry-run    # Preview changes without modifying database

# User management
ferrotune create-user --username alice --password secret --admin

# Generate example config
ferrotune generate-config > ~/.config/ferrotune/config.toml

# Enable verbose logging
ferrotune --verbose serve
```

### Library Scanning

The scanner supports two modes:

| Behavior | Incremental (default) | Full (`--full`) |
|----------|----------------------|------------------|
| Add new files | ✅ | ✅ |
| Remove deleted files | ✅ | ✅ |
| Update modified files | ✅ | ✅ |
| Refresh unchanged files | ❌ | ✅ |

**Incremental scan** checks file modification times and only re-reads metadata for files that have changed since the last scan. This is fast and suitable for routine use.

**Full scan** re-reads metadata for every file regardless of modification time. Use this after bulk re-tagging your library or if you suspect the database is out of sync.

Add `--dry-run` to either mode to preview what would change without modifying the database.

All commands support environment variables:
- `FERROTUNE_CONFIG` - Config file path
- `FERROTUNE_HOST` - Server host
- `FERROTUNE_PORT` - Server port

## API Endpoints

### System
- `ping` - Test server connectivity
- `getLicense` - Get server license info
- `getOpenSubsonicExtensions` - List supported extensions
- `getMusicFolders` - List configured music folders

### Browse
- `getArtists` - Get all artists (✅ implemented)
- `getArtist` - Get artist details and albums (✅ implemented)
- `getAlbum` - Get album details and songs (✅ implemented)
- `getSong` - Get song details (✅ implemented)
- `getGenres` - List all genres (✅ implemented)

### Media
- `stream` - Stream audio files (✅ implemented with range requests)
- `download` - Download original files (✅ implemented)
- `getCoverArt` - Get album artwork (🚧 coming soon)

### Library Management (Coming Soon)
- `startScan` - Trigger library scan
- `getScanStatus` - Check scan progress

### Favorites (Coming Soon)
- `star` - Star items
- `unstar` - Unstar items
- `getStarred2` - Get starred items

### Playlists (Coming Soon)
- `getPlaylists` - List playlists
- `getPlaylist` - Get playlist contents
- `createPlaylist` - Create new playlist
- `updatePlaylist` - Modify playlist
- `deletePlaylist` - Remove playlist

### Search (Coming Soon)
- `search3` - Unified search endpoint

### Discovery (Coming Soon)
- `getAlbumList2` - Get album lists (newest, random, etc.)
- `getRandomSongs` - Get random songs
- `scrobble` - Register playback

## Configuration Options

### Server Settings
- `host` - Bind address (default: `127.0.0.1`)
- `port` - Server port (default: `4040`)
- `name` - Server name (default: `Ferrotune`)

### Database
- `path` - SQLite database location

### Music
- `readonly_tags` - Whether to allow tag editing (default: `true`)
- `folders` - List of music folder configurations

### Cache
- `path` - Cache directory for cover art
- `max_cover_size` - Maximum cover art dimensions in pixels
