# Ferrotune

A self-hosted music server written in Rust with a Next.js web client.

## Disclaimer #1

> ⚠️ **Note on AI usage**: This project was developed with extensive use of AI-assisted programming tools. Due to limited spare time, this project would not have been possible otherwise.

## Disclaimer #2

> ⚠️ **Experimental Software**: Ferrotune is under active development and not yet ready for production use. **Please backup your music library before installing.** It is advised to take regular backups of the database as well.

## Features

- **Modern web client**
  - Built-in web UI for administration, library curation and playback on desktop
- **User-friendly data migration**
  - Import playlists, play counts, favorites from e.g. CSV files
  - UI with smart matching of imported data to library
  - Supports importing playlist entries with no matches in library, with deferred matching
- **OpenSubsonic API**
  - Tested with Supersonic and Symfonium
- **Configless operation**
  - Can run without a config file; configure via web UI
- **Listening statistics**
  - Track your listening history and habits
- **High performance**
  - Lists in the UI are virtualized and lazy loaded
  - Playback queue is computed serverside, so starting playback from a list with 10k tracks is fast

## Quick Start

```bash
moon run install
ferrotune serve
```

On first run, open `http://localhost:4040` in your browser to:
1. Sign in with default credentials (admin/admin)
2. Change your password
3. Add your music folders
4. Scan your library

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

## Development

Make sure to have `nix` installed. You can install it from [here](https://nixos.org/download.html).

```bash
# Enter development environment
nix develop

# Start backend + frontend dev servers
moon run :dev

# Run CI checks
moon run ci-all
```

## License

AGPL-3.0
