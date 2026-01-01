-- Allow the same relative file path in different music folders
-- Previously file_path was globally unique (UNIQUE constraint), but this prevented having 
-- the same folder structure in different libraries (e.g., "Artist/Album/song.flac")
-- 
-- The uniqueness constraint should be on (file_path, music_folder_id) instead
--
-- SQLite doesn't allow dropping UNIQUE constraints, so we need to recreate the table

-- Step 1: Create new table without the inline UNIQUE on file_path
-- Columns based on: 001_schema.sql + 002_cover_art_thumbnails.sql + 010_recycle_bin.sql
CREATE TABLE songs_new (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
    artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    music_folder_id INTEGER REFERENCES music_folders(id) ON DELETE CASCADE,
    track_number INTEGER,
    disc_number INTEGER NOT NULL DEFAULT 1,
    year INTEGER,
    genre TEXT,
    duration INTEGER NOT NULL DEFAULT 0,
    bitrate INTEGER,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_format TEXT NOT NULL,
    file_mtime INTEGER,
    partial_hash TEXT,
    full_file_hash TEXT,
    cover_art_hash TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    marked_for_deletion_at TEXT DEFAULT NULL,
    -- New: uniqueness is per-folder, not global
    UNIQUE(file_path, music_folder_id)
);

-- Step 2: Copy all data (using COALESCE to handle any NULL timestamps)
INSERT INTO songs_new (
    id, title, album_id, artist_id, music_folder_id, track_number, disc_number,
    year, genre, duration, bitrate, file_path, file_size, file_format, file_mtime,
    partial_hash, full_file_hash, cover_art_hash, created_at, updated_at, marked_for_deletion_at
)
SELECT 
    id, title, album_id, artist_id, music_folder_id, track_number, disc_number,
    year, genre, duration, bitrate, file_path, file_size, file_format, file_mtime,
    partial_hash, full_file_hash, cover_art_hash,
    COALESCE(created_at, CURRENT_TIMESTAMP),
    COALESCE(updated_at, CURRENT_TIMESTAMP),
    marked_for_deletion_at
FROM songs;

-- Step 3: Drop old table (this also drops the FTS triggers)
DROP TABLE songs;

-- Step 4: Rename new table
ALTER TABLE songs_new RENAME TO songs;

-- Step 5: Recreate all the indexes
CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album_id);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_songs_path ON songs(file_path);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_music_folder ON songs(music_folder_id);
CREATE INDEX IF NOT EXISTS idx_songs_mtime ON songs(file_mtime);
CREATE INDEX IF NOT EXISTS idx_songs_full_hash ON songs(full_file_hash) WHERE full_file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_songs_partial_hash ON songs(partial_hash) WHERE partial_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_songs_cover_art ON songs(cover_art_hash) WHERE cover_art_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_songs_marked_for_deletion ON songs(marked_for_deletion_at) WHERE marked_for_deletion_at IS NOT NULL;

-- Step 6: Recreate the FTS triggers (dropped when songs table was dropped)
CREATE TRIGGER IF NOT EXISTS songs_fts_insert AFTER INSERT ON songs BEGIN
    INSERT INTO songs_fts(song_id, title, artist_name, album_name)
    SELECT 
        new.id,
        new.title,
        (SELECT name FROM artists WHERE id = new.artist_id),
        COALESCE((SELECT name FROM albums WHERE id = new.album_id), '');
END;

CREATE TRIGGER IF NOT EXISTS songs_fts_delete AFTER DELETE ON songs BEGIN
    DELETE FROM songs_fts WHERE song_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS songs_fts_update AFTER UPDATE ON songs BEGIN
    DELETE FROM songs_fts WHERE song_id = old.id;
    INSERT INTO songs_fts(song_id, title, artist_name, album_name)
    SELECT 
        new.id,
        new.title,
        (SELECT name FROM artists WHERE id = new.artist_id),
        COALESCE((SELECT name FROM albums WHERE id = new.album_id), '');
END;
