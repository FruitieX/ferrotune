CREATE TABLE IF NOT EXISTS cover_art_thumbnails (
    hash TEXT PRIMARY KEY,
    small BYTEA NOT NULL,
    medium BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cover_art_thumbnails_updated ON cover_art_thumbnails(updated_at);