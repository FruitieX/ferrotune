# Ferrotune

A self-hosted music server written in Rust with a Vite/React web client.

AI tools were used during development. Review important behavior yourself before relying on it.

Ferrotune is experimental software and not yet ready for production use. Back up your music library and database before installing.

Ferrotune focuses on:

- A built-in web client for playback, administration, and library curation
- A native JSON API used by the web and mobile clients
- Import tools for playlists, favorites, and play history
- Listening statistics and library management features
- Large-library performance with virtualization, lazy loading, and server-side queue materialization

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

### Direct Binary Examples

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
```

## License

AGPL-3.0
