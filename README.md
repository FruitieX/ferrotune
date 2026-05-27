# ![Ferrotune logo](/docs/logo.png)

A self-hosted music server written in Rust with a React web client and Tauri Android client.

AI tools were used during development. You have been warned.

Ferrotune is experimental software. Back up your music library before installing. Periodically back up your Ferrotune database if you end up using it long-term.

Ferrotune focuses on:

- Performance and user experience
- A built-in web client for playback, administration, and library curation
- Import tools for playlists, favorites, and play history to onboard from existing platforms
- Listening statistics and library management features (smart playlists, tag editing, batch renaming, etc)

A more complete feature list can be found in [docs/FEATURES.md](docs/FEATURES.md).

![Screenshot of the Ferrotune web client showing the home page](/docs/screenshot.png)

## Quick Start

### Docker Examples

Container images are published to `ghcr.io/fruitiex/ferrotune`. Use a release tag when available; `:main` tracks the latest build from the default branch.

SQLite with a persistent data volume:

```bash
docker run -d \
  --name ferrotune \
  -p 4040:4040 \
  -v /path/to/music:/music:ro \
  -v ferrotune-data:/data \
  ghcr.io/fruitiex/ferrotune:main
```

Postgres with a persistent cache/data volume:

```bash
docker run -d \
  --name ferrotune \
  -p 4040:4040 \
  -v /path/to/music:/music:ro \
  -v ferrotune-data:/data \
  -e FERROTUNE_DATABASE_URL="postgres://ferrotune:ferrotune@postgres:5432/ferrotune" \
  ghcr.io/fruitiex/ferrotune:main
```

On first run, open `http://localhost:4040` in your browser, follow the guided setup wizard, and add `/music` as your library path inside the container.

### Binary Examples

SQLite with a dedicated data directory:

```bash
FERROTUNE_DATA_DIR=/var/lib/ferrotune \
  ferrotune serve
```

This stores the default SQLite database at `/var/lib/ferrotune/ferrotune.db` and cache data under `/var/lib/ferrotune/cache/`.

Postgres:

```bash
FERROTUNE_DATABASE_URL="postgres://ferrotune:ferrotune@localhost:5432/ferrotune" \
  ferrotune serve
```

For the full environment variable reference, see [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## Development

Make sure to have `nix` installed. You can install it from [here](https://nixos.org/download.html).

```bash
# Enter development environment
nix develop

# Start backend + frontend dev servers
moon run :dev

# Run the full local validation suite
moon run pre-ci

# Build release binary with embedded UI
moon run build-release-ui
```

## Android App Distribution

Main-branch CI publishes signed Android APKs to GitHub prereleases for use with Obtainium. See [docs/APP_DISTRIBUTION.md](docs/APP_DISTRIBUTION.md) for release signing, Obtainium setup, and desktop artifact notes.

## Local Android USB Deployment

Make sure you've connected an Android device with USB debugging enabled, run `adb usb` and make sure `adb devices` lists your device.

Then run:

```bash
nix develop .#android

moon run client:tauri-android-deploy
```

## License

AGPL-3.0
