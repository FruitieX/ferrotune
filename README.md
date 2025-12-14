# Ferrotune Music Server

An OpenSubsonic-compatible music server written in Rust with a Next.js web client.

> ⚠️ **Experimental Software**: Ferrotune is under active development and not yet ready for production use. **Please backup your music library before installing.** The database schema may change between versions without migration support.

## Features

- **OpenSubsonic API** - Full JSON and XML API support for Subsonic-compatible clients
- **Modern Web Client** - Built-in responsive web UI with Next.js
- **Configless Operation** - Can run without a config file; configure via web UI
- **Multi-user Support** - User management with per-user library access control
- **High Performance** - Async Rust backend with Tokio
- **SQLite Database** - Embedded database with full-text search (FTS5)
- **Cover Art** - Extraction and serving of embedded album artwork
- **Playlists** - M3U/XSPF import with smart matching for missing tracks
- **Listening Statistics** - Track your listening history and habits

## Quick Start

### Option 1: Run Without Config (Recommended for Getting Started)

```bash
# Build and run
cargo build --release
./target/release/ferrotune serve

# Or with Docker
docker run -v /path/to/music:/music -v ferrotune-data:/data -p 4040:4040 ferrotune
```

On first run, open `http://localhost:4040/setup` in your browser to:
1. Sign in with default credentials (admin/admin)
2. Optionally change your password
3. Add your music folders
4. Scan your library

### Option 2: Run With Config File

Create a config file at `~/.config/ferrotune/config.toml`:

```toml
[server]
host = "127.0.0.1"
port = 4040
name = "Ferrotune"

[database]
path = "~/.local/share/ferrotune/ferrotune.db"

[cache]
path = "~/.cache/ferrotune"

[[music.folders]]
name = "Music"
path = "/path/to/your/music"
```

Then run:
```bash
./target/release/ferrotune serve
```

### Connect a Client

Configure your Subsonic-compatible music client with:
- **Server URL**: `http://localhost:4040`
- **Username**: `admin` (or your configured user)
- **Password**: Your password
- **API Version**: 1.16.1 or higher

## Docker Deployment

```bash
# Build the image
docker build -t ferrotune .

# Run with a data volume for persistence
docker run -d \
  --name ferrotune \
  -p 4040:4040 \
  -v /path/to/music:/music:ro \
  -v ferrotune-data:/data \
  -e FERROTUNE_DATA_DIR=/data \
  -e FERROTUNE_HOST=0.0.0.0 \
  ferrotune
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FERROTUNE_DATA_DIR` | Directory for database and cache | Platform-specific |
| `FERROTUNE_CONFIG` | Path to config file | `~/.config/ferrotune/config.toml` |
| `FERROTUNE_HOST` | Server bind address | `127.0.0.1` |
| `FERROTUNE_PORT` | Server port | `4040` |

When `FERROTUNE_DATA_DIR` is set:
- Database: `$FERROTUNE_DATA_DIR/ferrotune.db`
- Cache: `$FERROTUNE_DATA_DIR/cache/`

### Docker Compose Example

```yaml
version: '3.8'
services:
  ferrotune:
    image: ferrotune
    ports:
      - "4040:4040"
    volumes:
      - /path/to/music:/music:ro
      - ferrotune-data:/data
    environment:
      - FERROTUNE_DATA_DIR=/data
      - FERROTUNE_HOST=0.0.0.0
    restart: unless-stopped

volumes:
  ferrotune-data:
```

## CLI Commands

```bash
# Start the server (default command)
ferrotune serve --host 0.0.0.0 --port 4040

# Scan music library
ferrotune scan              # Incremental scan
ferrotune scan --full       # Full rescan (refresh all metadata)
ferrotune scan --folder 1   # Scan specific folder
ferrotune scan --dry-run    # Preview changes

# User management
ferrotune create-user --username alice --password secret --admin
ferrotune set-password --username alice --password newsecret

# Generate example config
ferrotune generate-config > ~/.config/ferrotune/config.toml
```

## API Endpoints

### OpenSubsonic API (`/rest/*`)

Full implementation of the Subsonic/OpenSubsonic API for client compatibility:
- System: `ping`, `getLicense`, `getOpenSubsonicExtensions`
- Browsing: `getArtists`, `getArtist`, `getAlbum`, `getSong`, `getGenres`
- Lists: `getAlbumList2`, `getRandomSongs`, `getSongsByGenre`
- Streaming: `stream`, `download`, `getCoverArt`
- Search: `search3`
- Playlists: `getPlaylists`, `getPlaylist`, `createPlaylist`, `updatePlaylist`, `deletePlaylist`
- User: `star`, `unstar`, `setRating`, `getStarred2`, `scrobble`
- Queue: `savePlayQueue`, `getPlayQueue`

### Ferrotune Admin API (`/ferrotune/*`)

Extended REST API for administration:
- Health: `GET /ferrotune/health`
- Statistics: `GET /ferrotune/stats`
- Library: `POST /ferrotune/scan`, `GET /ferrotune/scan/status`
- Music Folders: CRUD at `/ferrotune/music-folders`
- Users: CRUD at `/ferrotune/users`
- Configuration: `/ferrotune/config`
- Playlists: Enhanced endpoints including import and reordering
- Listening: `/ferrotune/listening/stats`, `/ferrotune/listening/review`

## Building

### With Nix

```bash
nix develop
cargo build --release
```

### With Cargo

```bash
cargo build --release
```

### With Embedded Web UI

```bash
# Build frontend first
cd client && npm install && npm run build && cd ..

# Build backend with embedded UI
cargo build --release --features embedded-ui
```

## Dev Container / GitHub Codespaces

The project includes a dev container configuration for consistent development environments.

### VS Code / Cursor

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open the project folder
3. Click "Reopen in Container" when prompted (or run `Dev Containers: Reopen in Container` from the command palette)

### GitHub Codespaces

Click the "Code" button on GitHub and select "Open with Codespaces" to launch a cloud development environment.

### Mounting Your Music Library

Edit `.devcontainer/devcontainer.json` to mount your music library:

```jsonc
"mounts": [
  "source=ferrotune-devdata,target=/data,type=volume",
  "source=/path/to/your/music,target=/music,type=bind,readonly"
],
```

### Available Services

| Port | Service | Description |
|------|---------|-------------|
| 4040 | Ferrotune API | Backend server (`moon run dev`) |
| 3000 | Next.js Client | Frontend dev server (`moon run client:dev`) |

### Database Persistence

The dev container uses a named Docker volume (`ferrotune-devdata`) for the SQLite database. Your data persists across container rebuilds. The database is stored at `/workspaces/ferrotune/.data`.

## Development

```bash
# Start backend + frontend dev servers
moon run :dev

# Run CI checks
moon run ci-all-lite
```

## License

MIT
