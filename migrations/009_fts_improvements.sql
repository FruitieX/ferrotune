-- Migration 009: Add FTS5 tables for artists and albums
--
-- This migration adds FTS5 full-text search indexes for artists and albums,
-- matching the existing songs_fts implementation. All FTS tables use the
-- standard unicode61 tokenizer with prefix wildcard support.
--
-- The Rust code will convert queries to use prefix wildcards (e.g., "beat*")
-- to enable matching word prefixes: "beat" -> "Beatles", "rock" -> "Rocker"

-- ===== ARTISTS FTS =====

CREATE VIRTUAL TABLE IF NOT EXISTS artists_fts USING fts5(
    artist_id UNINDEXED,
    name,
    sort_name
);

-- Populate existing artists
INSERT INTO artists_fts(artist_id, name, sort_name)
SELECT id, name, COALESCE(sort_name, name) FROM artists;

-- Triggers to keep artists_fts in sync
CREATE TRIGGER IF NOT EXISTS artists_fts_insert AFTER INSERT ON artists BEGIN
    INSERT INTO artists_fts(artist_id, name, sort_name)
    VALUES (new.id, new.name, COALESCE(new.sort_name, new.name));
END;

CREATE TRIGGER IF NOT EXISTS artists_fts_delete AFTER DELETE ON artists BEGIN
    DELETE FROM artists_fts WHERE artist_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS artists_fts_update AFTER UPDATE ON artists BEGIN
    DELETE FROM artists_fts WHERE artist_id = old.id;
    INSERT INTO artists_fts(artist_id, name, sort_name)
    VALUES (new.id, new.name, COALESCE(new.sort_name, new.name));
END;

-- ===== ALBUMS FTS =====

CREATE VIRTUAL TABLE IF NOT EXISTS albums_fts USING fts5(
    album_id UNINDEXED,
    name,
    artist_name
);

-- Populate existing albums
INSERT INTO albums_fts(album_id, name, artist_name)
SELECT a.id, a.name, ar.name
FROM albums a
INNER JOIN artists ar ON a.artist_id = ar.id;

-- Triggers to keep albums_fts in sync
CREATE TRIGGER IF NOT EXISTS albums_fts_insert AFTER INSERT ON albums BEGIN
    INSERT INTO albums_fts(album_id, name, artist_name)
    SELECT new.id, new.name, (SELECT name FROM artists WHERE id = new.artist_id);
END;

CREATE TRIGGER IF NOT EXISTS albums_fts_delete AFTER DELETE ON albums BEGIN
    DELETE FROM albums_fts WHERE album_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS albums_fts_update AFTER UPDATE ON albums BEGIN
    DELETE FROM albums_fts WHERE album_id = old.id;
    INSERT INTO albums_fts(album_id, name, artist_name)
    SELECT new.id, new.name, (SELECT name FROM artists WHERE id = new.artist_id);
END;
