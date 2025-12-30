-- Tagger sessions table - stores per-user tagger state
-- This replaces the preferences-based tagger storage with a proper database schema
-- for better performance and more structured data

-- Main tagger session table - one per user
CREATE TABLE IF NOT EXISTS tagger_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    -- Active scripts
    active_rename_script_id TEXT,
    active_tag_script_id TEXT,
    -- Target library for saving uploaded files
    target_library_id TEXT,
    -- UI preferences
    visible_columns TEXT NOT NULL DEFAULT '["TITLE","ARTIST","ALBUM","ALBUMARTIST","TRACKNUMBER","DISCNUMBER","YEAR","GENRE"]',
    column_widths TEXT NOT NULL DEFAULT '{}',
    file_column_width INTEGER NOT NULL DEFAULT 400,
    show_library_prefix INTEGER NOT NULL DEFAULT 0,
    show_computed_path INTEGER NOT NULL DEFAULT 1,
    details_panel_open INTEGER NOT NULL DEFAULT 1,
    -- Dangerous character handling
    dangerous_char_mode TEXT NOT NULL DEFAULT 'replace',
    dangerous_char_replacement TEXT NOT NULL DEFAULT '_',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Staged tracks currently loaded in the tagger
CREATE TABLE IF NOT EXISTS tagger_session_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES tagger_sessions(id) ON DELETE CASCADE,
    -- Track identifier (staged file ID or song ID)
    track_id TEXT NOT NULL,
    -- Type of track: 'library' for library songs, 'staged' for uploaded files
    track_type TEXT NOT NULL DEFAULT 'library' CHECK(track_type IN ('library', 'staged')),
    -- Position in the list for ordering
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(session_id, track_id)
);

-- Create index on session_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_tagger_session_tracks_session
ON tagger_session_tracks(session_id);

-- Pending edits for tracks in the tagger session
CREATE TABLE IF NOT EXISTS tagger_pending_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES tagger_sessions(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    -- Type of track: 'library' for library songs, 'staged' for uploaded files
    track_type TEXT NOT NULL DEFAULT 'library' CHECK(track_type IN ('library', 'staged')),
    -- JSON object of edited tags: { "TITLE": "new title", ... }
    edited_tags TEXT NOT NULL DEFAULT '{}',
    -- Computed path from rename script
    computed_path TEXT,
    -- Cover art changes
    cover_art_removed INTEGER NOT NULL DEFAULT 0,
    -- Filename of uploaded cover art in staging directory (UUID.ext format)
    cover_art_filename TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, track_id)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_tagger_pending_edits_session
ON tagger_pending_edits(session_id);

-- User scripts table - stores rename and tag scripts per user
CREATE TABLE IF NOT EXISTS tagger_scripts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- 'rename' or 'tags'
    type TEXT NOT NULL CHECK(type IN ('rename', 'tags')),
    script TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create index for user script lookups
CREATE INDEX IF NOT EXISTS idx_tagger_scripts_user
ON tagger_scripts(user_id);

-- Note: Default scripts are seeded dynamically when a user's tagger session is first accessed.
-- See tagger_session.rs seed_default_scripts() for the script content.
-- Scripts are embedded from scripts/tagger/*.js files at compile time.
