# Environment Variables

Ferrotune is configured primarily through `FERROTUNE_*` environment variables. This page documents the variables currently wired into the server runtime, background jobs, and test helpers.

## Common Runtime Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `FERROTUNE_DATABASE_URL` | unset | Selects the database backend. When unset, Ferrotune falls back to SQLite. Accepted formats: `sqlite:///absolute/path/to/file.db`, `sqlite:relative.db`, `postgres://user:pw@host:5432/dbname`, `postgresql://...`. |
| `FERROTUNE_DATA_DIR` | platform-specific local data dir + `/ferrotune` | Base directory for Ferrotune data. When `FERROTUNE_DATABASE_URL` is unset, the default SQLite database path becomes `$FERROTUNE_DATA_DIR/ferrotune.db`. When this variable is set, cache data is stored under `$FERROTUNE_DATA_DIR/cache/`. |
| `FERROTUNE_HOST` | `127.0.0.1` | Server bind address. The `ferrotune serve --host ...` CLI flag overrides this environment variable. |
| `FERROTUNE_PORT` | `4040` | Server bind port. The `ferrotune serve --port ...` CLI flag overrides this environment variable. |
| `FERROTUNE_TRANSCODE_CACHE_PATH` | system temp dir + `/ferrotune/transcodes` | Directory used for the byte-range-addressable transcode cache. Useful when you want the transcode cache on a dedicated or ephemeral volume. |
| `FERROTUNE_TRANSCODE_CACHE_MAX_MB` | `10240` | Maximum transcode cache size in MiB before LRU eviction. |

## CORS Configuration

These variables only matter when the server is bound to a non-local host. When running on `127.0.0.1` or `localhost`, Ferrotune allows any origin for local development.

| Variable | Default | Description |
|----------|---------|-------------|
| `FERROTUNE_CORS_ALLOWED_ORIGINS` | unset | Comma-separated allowlist of extra origins. If unset, Ferrotune automatically allows its own origin; localhost deployments also include common development origins. Tauri app origins are always allowed. |
| `FERROTUNE_CORS_ALLOW_ANY` | unset / false | If set to `true` or `1`, allows any origin. This is unsafe for production deployments. |

## Scanning And Analysis

These variables affect background audio analysis during library scans.

| Variable | Default | Description |
|----------|---------|-------------|
| `FERROTUNE_ANALYSIS_CONCURRENCY` | `min(available CPUs, 4)` | Limits concurrent ReplayGain, waveform, and bliss analysis work so large scans do not overcommit memory. |
| `FERROTUNE_BLISS_MAX_DURATION_SECS` | `1200` | Skips bliss similarity analysis for tracks longer than the configured number of seconds. Only relevant when bliss analysis is enabled. |

## Database Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `FERROTUNE_DB_MAX_CONNECTIONS` | driver default | Maximum database pool connections. Applies to both SQLite and PostgreSQL. |
| `FERROTUNE_DB_JOURNAL_MODE` | driver default | SQLite only. Valid values: `delete`, `truncate`, `persist`, `memory`, `wal`, `off`. |
| `FERROTUNE_DB_SYNCHRONOUS` | driver default | SQLite only. Valid values: `off`, `normal`, `full`, `extra`. |
| `FERROTUNE_DB_LOCKING_MODE` | driver default | SQLite only. Valid values: `normal`, `exclusive`. |
| `FERROTUNE_DB_BUSY_TIMEOUT` | driver default | SQLite only. Busy timeout in seconds. |

## Testing And CI

These variables are intended for automated tests and other controlled environments rather than normal deployments.

| Variable | Default | Description |
|----------|---------|-------------|
| `FERROTUNE_TESTING` | unset / false | Enables testing-only API endpoints such as state reset helpers under `/api/testing/*`. |
| `FERROTUNE_TEST_DATABASE_GUARD` | unset / false | Forces the PostgreSQL safety guard that refuses non-local test database URLs outside normal `cargo test` execution. |
| `FERROTUNE_ALLOW_NONLOCAL_TEST_DATABASE` | unset / false | Bypasses the non-local PostgreSQL test database guard when this is intentionally required. |

## Examples

SQLite with an explicit data directory:

```bash
FERROTUNE_DATA_DIR=/var/lib/ferrotune \
  ferrotune serve
```

SQLite with an explicit database URL:

```bash
FERROTUNE_DATABASE_URL="sqlite:///var/lib/ferrotune/ferrotune.db" \
  ferrotune serve
```

PostgreSQL:

```bash
FERROTUNE_DATABASE_URL="postgres://ferrotune:ferrotune@localhost:5432/ferrotune" \
  ferrotune serve
```

PostgreSQL with an explicit CORS allowlist:

```bash
FERROTUNE_DATABASE_URL="postgres://ferrotune:ferrotune@localhost:5432/ferrotune" \
FERROTUNE_CORS_ALLOWED_ORIGINS="https://music.example.com,https://admin.example.com" \
  ferrotune serve
```

## Notes

- Ferrotune logs through `tracing_subscriber`, so the standard `RUST_LOG` environment variable can be used if you want to override the default log filter.
- If `FERROTUNE_DATA_DIR` is set and `FERROTUNE_DATABASE_URL` is unset, Ferrotune uses SQLite at `$FERROTUNE_DATA_DIR/ferrotune.db`.
- The default transcode cache path is derived from the system temporary directory, which usually means something like `$TMPDIR/ferrotune/transcodes` on Unix-like systems.