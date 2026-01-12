-- Ferrotune Database Schema

-- =====================
-- SERVER CONFIGURATION
-- =====================

-- Server configuration stored in database for configless operation
CREATE TABLE IF NOT EXISTS server_config (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration values
-- Note: 'music.readonly_tags' is NOT included - it's read dynamically from the config file
INSERT OR IGNORE INTO server_config (key, value) VALUES
    ('server.name', '"Ferrotune"'),
    ('server.host', '"127.0.0.1"'),
    ('server.port', '4040'),
    ('server.admin_user', '"admin"'),
    ('server.admin_password', '"admin"'),
    ('cache.max_cover_size', '1024'),
    ('initial_setup_complete', 'false');

-- =====================
-- USERS & AUTH
-- =====================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    subsonic_token TEXT,  -- For OpenSubsonic token+salt auth
    email TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- =====================
-- MUSIC LIBRARY
-- =====================

CREATE TABLE IF NOT EXISTS music_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    watch_enabled BOOLEAN NOT NULL DEFAULT 0,
    last_scanned_at TIMESTAMP,
    scan_error TEXT
);

CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_name TEXT,
    album_count INTEGER NOT NULL DEFAULT 0,
    cover_art_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_artists_sort_name ON artists(sort_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    year INTEGER,
    genre TEXT,
    song_count INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    cover_art_hash TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_name ON albums(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_albums_year ON albums(year);
CREATE INDEX IF NOT EXISTS idx_albums_genre ON albums(genre);

CREATE TABLE IF NOT EXISTS songs (
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
    marked_for_deletion_at TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Uniqueness is per-folder, not global
    UNIQUE(file_path, music_folder_id)
);

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

-- Cover art thumbnails
CREATE TABLE IF NOT EXISTS cover_art_thumbnails (
    hash TEXT PRIMARY KEY,
    small BLOB NOT NULL,
    medium BLOB NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cover_art_thumbnails_updated ON cover_art_thumbnails(updated_at);

-- =====================
-- FULL TEXT SEARCH
-- =====================

CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
    song_id UNINDEXED,
    title,
    artist_name,
    album_name
);

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

CREATE VIRTUAL TABLE IF NOT EXISTS artists_fts USING fts5(
    artist_id UNINDEXED,
    name,
    sort_name
);

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

CREATE VIRTUAL TABLE IF NOT EXISTS albums_fts USING fts5(
    album_id UNINDEXED,
    name,
    artist_name
);

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

-- =====================
-- USER DATA
-- =====================

-- Starred items (favorites)
CREATE TABLE IF NOT EXISTS starred (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK(item_type IN ('song', 'album', 'artist')),
    item_id TEXT NOT NULL,
    starred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_starred_user ON starred(user_id);
CREATE INDEX IF NOT EXISTS idx_starred_item ON starred(item_type, item_id);

-- Ratings (1-5 scale)
CREATE TABLE IF NOT EXISTS ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK(item_type IN ('song', 'album', 'artist')),
    item_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    rated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_user ON ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_item ON ratings(item_type, item_id);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    accent_color TEXT NOT NULL DEFAULT 'rust',
    custom_accent_hue REAL,
    custom_accent_lightness REAL,
    custom_accent_chroma REAL,
    preferences_json TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User library access control
CREATE TABLE IF NOT EXISTS user_library_access (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    music_folder_id INTEGER NOT NULL REFERENCES music_folders(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, music_folder_id)
);

CREATE INDEX IF NOT EXISTS idx_user_library_access_user ON user_library_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_library_access_folder ON user_library_access(music_folder_id);

-- Shuffle excludes
CREATE TABLE IF NOT EXISTS shuffle_excludes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE(user_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_shuffle_excludes_user_song ON shuffle_excludes(user_id, song_id);

-- =====================
-- PLAYLISTS
-- =====================

CREATE TABLE IF NOT EXISTS playlist_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES playlist_folders(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playlist_folders_owner ON playlist_folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlist_folders_parent ON playlist_folders(parent_id);

CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    comment TEXT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL,
    is_public BOOLEAN NOT NULL DEFAULT 0,
    song_count INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_playlists_owner ON playlists(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlists_folder ON playlists(folder_id);

-- Playlist songs with proper foreign key behavior
CREATE TABLE IF NOT EXISTS playlist_songs (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,  -- SET NULL instead of CASCADE
    position INTEGER NOT NULL,
    missing_entry_data TEXT,
    missing_search_text TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    entry_id TEXT,
    PRIMARY KEY (playlist_id, position),
    CHECK (song_id IS NOT NULL OR missing_entry_data IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_playlist_songs_song ON playlist_songs(song_id);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_entry_id ON playlist_songs(playlist_id, entry_id);

CREATE TABLE IF NOT EXISTS playlist_shares (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    shared_with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_shares_playlist ON playlist_shares(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_shares_user ON playlist_shares(shared_with_user_id);

-- Smart playlists
CREATE TABLE IF NOT EXISTS smart_playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    comment TEXT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_public BOOLEAN NOT NULL DEFAULT 0,
    rules_json TEXT NOT NULL,
    sort_field TEXT,
    sort_direction TEXT DEFAULT 'desc',
    max_songs INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_smart_playlists_owner ON smart_playlists(owner_id);

-- =====================
-- PLAYBACK
-- =====================

-- Play queue (server-side) with lazy queue support
CREATE TABLE IF NOT EXISTS play_queues (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL DEFAULT 'other',
    source_id TEXT,
    source_name TEXT,
    current_index INTEGER NOT NULL DEFAULT 0,
    position_ms INTEGER NOT NULL DEFAULT 0,
    is_shuffled INTEGER NOT NULL DEFAULT 0,
    shuffle_seed INTEGER,
    shuffle_indices_json TEXT,
    repeat_mode TEXT NOT NULL DEFAULT 'off',
    filters_json TEXT,
    sort_json TEXT,
    total_count INTEGER DEFAULT NULL,
    is_lazy INTEGER NOT NULL DEFAULT 0,
    song_ids_json TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by TEXT NOT NULL DEFAULT 'ferrotune-web'
);

CREATE TABLE IF NOT EXISTS play_queue_entries (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    queue_position INTEGER NOT NULL,
    entry_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, queue_position)
);

CREATE INDEX IF NOT EXISTS idx_play_queue_entries_user ON play_queue_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_song ON play_queue_entries(song_id);
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_entry_id ON play_queue_entries(user_id, entry_id);

-- Scrobbles/play history
CREATE TABLE IF NOT EXISTS scrobbles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Nullable for imported entries
    submission BOOLEAN NOT NULL DEFAULT 1,
    play_count INTEGER NOT NULL DEFAULT 1,  -- For bulk imports
    description TEXT  -- For import labels
);

CREATE INDEX IF NOT EXISTS idx_scrobbles_user_time ON scrobbles(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrobbles_song ON scrobbles(song_id);

-- Listening sessions (for statistics)
CREATE TABLE IF NOT EXISTS listening_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    listened_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_listening_sessions_user_time ON listening_sessions(user_id, listened_at);
CREATE INDEX IF NOT EXISTS idx_listening_sessions_song ON listening_sessions(song_id);

-- =====================
-- TAGGER
-- =====================

-- Tagger sessions table - stores per-user tagger state
CREATE TABLE IF NOT EXISTS tagger_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    active_rename_script_id TEXT,
    active_tag_script_id TEXT,
    target_library_id TEXT,
    visible_columns TEXT NOT NULL DEFAULT '["TITLE","ARTIST","ALBUM","ALBUMARTIST","TRACKNUMBER","DISCNUMBER","YEAR","GENRE"]',
    column_widths TEXT NOT NULL DEFAULT '{}',
    file_column_width INTEGER NOT NULL DEFAULT 400,
    show_library_prefix INTEGER NOT NULL DEFAULT 0,
    show_computed_path INTEGER NOT NULL DEFAULT 1,
    details_panel_open INTEGER NOT NULL DEFAULT 1,
    dangerous_char_mode TEXT NOT NULL DEFAULT 'replace',
    dangerous_char_replacement TEXT NOT NULL DEFAULT '_',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Staged tracks currently loaded in the tagger
CREATE TABLE IF NOT EXISTS tagger_session_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES tagger_sessions(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    track_type TEXT NOT NULL DEFAULT 'library' CHECK(track_type IN ('library', 'staged')),
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(session_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_tagger_session_tracks_session ON tagger_session_tracks(session_id);

-- Pending edits for tracks in the tagger session
CREATE TABLE IF NOT EXISTS tagger_pending_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES tagger_sessions(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    track_type TEXT NOT NULL DEFAULT 'library' CHECK(track_type IN ('library', 'staged')),
    edited_tags TEXT NOT NULL DEFAULT '{}',
    computed_path TEXT,
    cover_art_removed INTEGER NOT NULL DEFAULT 0,
    cover_art_filename TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_tagger_pending_edits_session ON tagger_pending_edits(session_id);

-- User scripts table - stores rename and tag scripts per user
CREATE TABLE IF NOT EXISTS tagger_scripts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('rename', 'tags')),
    script TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tagger_scripts_user ON tagger_scripts(user_id);
